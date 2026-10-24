import { describe, expect, it } from "vitest";
import type { Ref } from "@/app/api/assistant/ids";
import type { StructureId } from "@/domain/mapping/types";
import type { CameraPreset } from "@/state/store";
import { focusTarget, lesionView, planFocus, type FocusDeps } from "@/components/assistant/focusTarget";

const ref = (patch: Partial<Ref>): Ref => ({ id: "F1", kind: "finding", label: "Test finding", organ: "heart", ...patch });

/** Records the store calls focusTarget makes, with a switchable WebGL probe. */
function recorder(webgl = true) {
  const calls: { select: [StructureId | null, number | null | undefined][]; camera: CameraPreset[] } = { select: [], camera: [] };
  const deps: FocusDeps = {
    selectStructure: (s, segment) => { calls.select.push([s, segment]); },
    requestCamera: (p) => { calls.camera.push(p); },
    webgl: () => webgl,
  };
  return { calls, deps };
}

describe("focusTarget — heart structures (Req 11.1)", () => {
  it("selects a plain structure without moving the camera", () => {
    const { calls, deps } = recorder();
    expect(focusTarget(ref({ target: "lv" }), deps)).toEqual({ kind: "structure", structure: "lv", segment: null, camera: null });
    expect(calls.select).toEqual([["lv", null]]);
    expect(calls.camera).toEqual([]);
  });

  it("passes an AHA segment through and ignores out-of-range numbers", () => {
    const { calls, deps } = recorder();
    focusTarget(ref({ target: "myocardium:7" }), deps);
    focusTarget(ref({ target: "lv#12" }), deps);
    focusTarget(ref({ target: "myocardium:42" }), deps);
    expect(calls.select).toEqual([["myocardium", 7], ["lv", 12], ["myocardium", null]]);
  });

  it.each([
    ["aortic_valve", "aortic_closeup"],
    ["mitral_valve", "mitral_closeup"],
  ] as const)("%s selects the valve and requests %s", (target, preset) => {
    const { calls, deps } = recorder();
    focusTarget(ref({ target }), deps);
    expect(calls.select).toEqual([[target, null]]);
    expect(calls.camera).toEqual([preset]);
  });

  it("works for an evidence ref that inherits its finding's target", () => {
    const { calls, deps } = recorder();
    focusTarget(ref({ id: "E1", kind: "evidence", field: "valves.aortic.peakVelocity", value: 4.3, unit: "m/s", target: "aortic_valve" }), deps);
    expect(calls.camera).toEqual(["aortic_closeup"]);
  });
});

describe("focusTarget — coronary vessels (Req 11.2)", () => {
  it("matches the inspector's LESION_VIEW choice", () => {
    expect(lesionView("LM")).toBe("superior");
    expect(lesionView("LAD", "proximal")).toBe("superior");
    expect(lesionView("LAD", "mid")).toBe("left_lateral");
    expect(lesionView("LAD")).toBe("left_lateral");
    expect(lesionView("LCx", "proximal")).toBe("left_lateral");
    expect(lesionView("RCA", "distal")).toBe("anterior");
    expect(lesionView("PDA")).toBe("inferior");
  });

  it.each([
    ["LAD:proximal", "LAD", "proximal", "superior"],
    ["LAD:mid", "LAD", "mid", "left_lateral"],
    ["rca_proximal", "RCA", "proximal", "anterior"],
    ["coronary:LCx:distal", "LCx", "distal", "left_lateral"],
    ["coronary_vessels:PDA", "PDA", null, "inferior"],
  ] as const)("%s → %s %s, camera %s", (target, vessel, segment, camera) => {
    const { calls, deps } = recorder();
    expect(focusTarget(ref({ target }), deps)).toEqual({ kind: "coronary", vessel, segment, camera });
    expect(calls.select).toEqual([["coronary_vessels", null]]);
    expect(calls.camera).toEqual([camera]);
  });

  it("selects the coronary tree without a camera move when no vessel is named", () => {
    const { calls, deps } = recorder();
    focusTarget(ref({ target: "coronary_vessels" }), deps);
    expect(calls.select).toEqual([["coronary_vessels", null]]);
    expect(calls.camera).toEqual([]);
  });
});

describe("focusTarget — safe no-op (Req 11.3)", () => {
  it.each([
    ["missing target", ref({})],
    ["empty target", ref({ target: "  " })],
    ["unknown target", ref({ target: "left_atrial_appendage" })],
    ["unknown coronary segment", ref({ target: "LAD:ostial" })],
    ["brain finding", ref({ organ: "brain", target: "hippocampus" })],
    ["brain finding with a heart-like id", ref({ organ: "brain", target: "lv" })],
    ["no organ", ref({ organ: undefined, target: "lv" })],
    ["missing-data ref (M#)", ref({ id: "M1", kind: "missing", label: "Missing data", field: "observations.lvMassIndex", why: "Indexed LV mass.", organ: undefined })],
    ["missing-data ref even with a heart target", ref({ id: "M1", kind: "missing", label: "Missing data", target: "lv" })],
    ["red-flag ref (R#)", ref({ id: "R1", kind: "redFlag", label: "Red flag", text: "Urgent specialist review.", organ: undefined })],
    ["red-flag ref even with a heart target", ref({ id: "R1", kind: "redFlag", label: "Red flag", target: "aortic_valve" })],
  ])("%s → none, no store calls", (_name, r) => {
    const { calls, deps } = recorder();
    expect(focusTarget(r, deps)).toEqual({ kind: "none" });
    expect(calls).toEqual({ select: [], camera: [] });
  });

  it("does nothing when WebGL is unavailable", () => {
    const { calls, deps } = recorder(false);
    expect(focusTarget(ref({ target: "aortic_valve" }), deps)).toEqual({ kind: "none" });
    expect(calls).toEqual({ select: [], camera: [] });
  });

  it("does not throw for null/undefined refs or failing store actions", () => {
    expect(focusTarget(null)).toEqual({ kind: "none" });
    expect(focusTarget(undefined)).toEqual({ kind: "none" });
    const throwing: FocusDeps = { selectStructure: () => { throw new Error("boom"); }, requestCamera: () => {}, webgl: () => true };
    expect(() => focusTarget(ref({ target: "lv" }), throwing)).not.toThrow();
    expect(focusTarget(ref({ target: "lv" }), throwing)).toEqual({ kind: "none" });
  });

  it("uses the real store and WebGL probe by default (no WebGL in node → none)", () => {
    expect(focusTarget(ref({ target: "aortic_valve" }))).toEqual({ kind: "none" });
  });

  it("planFocus is pure and independent of WebGL", () => {
    expect(planFocus(ref({ target: "aortic_valve" }))).toEqual({ kind: "structure", structure: "aortic_valve", segment: null, camera: "aortic_closeup" });
  });
});
