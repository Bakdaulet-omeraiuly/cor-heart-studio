import { describe, expect, it } from "vitest";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { minimal, norm, obs, samplePatients } from "./helpers";

describe("normalizeRecord", () => {
  it("accepts every bundled synthetic sample without errors", () => {
    for (const raw of samplePatients()) {
      const r = normalizeRecord(raw);
      expect(r.ok, JSON.stringify(raw).slice(0, 60)).toBe(true);
      if (r.ok) expect(r.patient.issues.filter((i) => i.severity === "error")).toEqual([]);
    }
  });

  it("requires stable patientId and studyId and explains how to fix it", () => {
    const r = normalizeRecord({ patientId: "A" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const studyIssue = r.issues.find((i) => i.path === "studyId");
      expect(studyIssue?.severity).toBe("error");
      expect(studyIssue?.suggestion).toMatch(/study identifier/);
    }
  });

  it("converts units into canonical units while preserving the original", () => {
    const p = norm(minimal({ observations: { lvEndDiastolicDiameter: obs(5.6, "cm"), bodyTemperature: obs(98.6, "°F") } }));
    const edd = p.observations["observations.lvEndDiastolicDiameter"];
    expect(edd.value).toBeCloseTo(56);
    expect(edd.unit).toBe("mm");
    expect(edd.original).toEqual({ value: 5.6, unit: "cm" });
    expect(p.observations["observations.bodyTemperature"].value).toBeCloseTo(37, 1);
  });

  it("keeps values with missing or unknown units but excludes them from rendering", () => {
    const p = norm(minimal({ observations: { heartRate: obs(1.2, "Hz"), lvEndDiastolicDiameter: { value: 50 } } }));
    expect(p.observations["observations.heartRate"].status).toBe("unit_unknown");
    expect(p.observations["observations.heartRate"].original.value).toBe(1.2);
    expect(p.observations["observations.lvEndDiastolicDiameter"].status).toBe("unit_missing");
    expect(p.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["unit.unknown", "unit.missing"]));
  });

  it("distinguishes physically impossible inputs from unusual values", () => {
    const p = norm(minimal({ observations: { heartRate: obs(-5, "bpm"), lvEndDiastolicDiameter: obs(95, "mm") } }));
    expect(p.observations["observations.heartRate"].status).toBe("impossible");
    // 95 mm is clinically extreme but possible: accepted
    expect(p.observations["observations.lvEndDiastolicDiameter"].status).toBe("ok");
  });

  it("never substitutes zero for an explicitly unknown value", () => {
    const p = norm(minimal({ observations: { lvEjectionFraction: obs(null, "%") } }));
    expect(p.observations["observations.lvEjectionFraction"].value).toBeNull();
    expect(p.observations["observations.lvEjectionFraction"].status).toBe("null");
  });

  it("derives EF from volumes with formula and flags a conflicting reported EF", () => {
    const p = norm(minimal({ observations: { lvEndDiastolicVolume: obs(200, "mL"), lvEndSystolicVolume: obs(100, "mL"), lvEjectionFraction: obs(65, "%") } }));
    const ef = p.derived.find((d) => d.id === "lvEfFromVolumes")!;
    expect(ef.value).toBe(50);
    expect(ef.formula).toBe("EF = 100 × (EDV − ESV) / EDV");
    expect(ef.inputs).toEqual(["observations.lvEndDiastolicVolume", "observations.lvEndSystolicVolume"]);
    expect(p.issues.find((i) => i.code === "ef.conflict")).toBeTruthy();
    // the reported value is kept, not overwritten
    expect(p.observations["observations.lvEjectionFraction"].value).toBe(65);
  });

  it("marks contradictory volumes and excludes them", () => {
    const p = norm(minimal({ observations: { lvEndDiastolicVolume: obs(60, "mL"), lvEndSystolicVolume: obs(140, "mL") } }));
    expect(p.observations["observations.lvEndSystolicVolume"].status).toBe("contradiction");
    expect(p.issues.find((i) => i.code === "volumes.contradiction")?.severity).toBe("error");
  });

  it("rejects a phase that contradicts the field definition for geometry", () => {
    const p = norm(minimal({ observations: { lvEndDiastolicDiameter: obs(50, "mm", { phase: "end-systole" }) } }));
    expect(p.observations["observations.lvEndDiastolicDiameter"].status).toBe("context_mismatch");
  });

  it("expands valve aliases and preserves qualitative severity", () => {
    const p = norm(minimal({ valveFindings: [{ valve: "AV", condition: "Stenosis", severity: "Severe", valveArea: obs(0.8, "cm2") }] }));
    expect(p.valveFindings[0]).toMatchObject({ valve: "aortic_valve", condition: "stenosis", severity: "severe" });
    expect(p.valveFindings[0].measurements[0]).toMatchObject({ label: "Valve area", value: 0.8 });
  });

  it("maps wall thickness regions to AHA segments", () => {
    const p = norm(minimal({ echo: { wallThickness: [{ region: "septum", value: 1.4, unit: "cm" }] } }));
    expect(p.wallThickness[0].segments).toEqual([2, 3, 8, 9, 14]);
    expect(p.wallThickness[0].valueMm).toBe(14);
  });

  it("reports unrecognized fields instead of dropping them silently", () => {
    const p = norm(minimal({ favouriteColour: "blue", observations: { mysteryIndex: obs(3, "au") } }));
    expect(p.unrecognizedFields).toEqual(["favouriteColour"]);
    expect(p.issues.map((i) => i.code)).toEqual(expect.arrayContaining(["field.unrecognized", "observation.unsupported"]));
    expect((p.original as Record<string, unknown>).favouriteColour).toBe("blue");
  });
});
