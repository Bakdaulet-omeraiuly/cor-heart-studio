import { describe, expect, it } from "vitest";
import { refsFor, withIds } from "@/app/api/assistant/ids";
import type { Assessment } from "@/app/api/assistant/engine";

/** Read the stamped evidence ids off an ided finding/differential entry. */
const evidenceIds = (entry: { evidence: { id: string }[] }): string[] =>
  entry.evidence.map((e) => e.id);
import {
  AORTIC_STENOSIS,
  CONCENTRIC_WALL_THICKENING,
  EMPTY_WITH_MISSING,
  RED_FLAG,
} from "@/app/api/assistant/__fixtures__/assess";

describe("withIds — deterministic ids", () => {
  it("yields identical ids when called twice on the same Assessment", () => {
    const first = withIds(CONCENTRIC_WALL_THICKENING);
    const second = withIds(CONCENTRIC_WALL_THICKENING);
    expect(first).toEqual(second);
  });

  it("stamps F# across findings then differential as one shared sequence", () => {
    // CONCENTRIC_WALL_THICKENING has one finding and one differential.
    const ided = withIds(CONCENTRIC_WALL_THICKENING);
    expect(ided.findings.map((f) => f.id)).toEqual(["F1"]);
    expect(ided.differential.map((f) => f.id)).toEqual(["F2"]);
  });

  it("continues the F# sequence across multiple findings before differential", () => {
    const a: Assessment = {
      findings: [
        { condition: "c1", label: "L1", basis: "rule-defined", organ: "heart", evidence: [] },
        { condition: "c2", label: "L2", basis: "rule-defined", organ: "heart", evidence: [] },
      ],
      differential: [
        { condition: "c3", label: "L3", basis: "supported", organ: "heart", evidence: [] },
      ],
      missing: [],
      redFlags: [],
      disclaimer: "d",
    };
    const ided = withIds(a);
    expect(ided.findings.map((f) => f.id)).toEqual(["F1", "F2"]);
    expect(ided.differential.map((f) => f.id)).toEqual(["F3"]);
  });

  it("stamps E# across all evidence in reading order (findings then differential)", () => {
    // Finding: 2 evidence items (E1, E2); differential: 1 evidence item (E3).
    const ided = withIds(CONCENTRIC_WALL_THICKENING);
    expect(evidenceIds(ided.findings[0])).toEqual(["E1", "E2"]);
    expect(evidenceIds(ided.differential[0])).toEqual(["E3"]);
  });

  it("stamps M# across missing[] in order, independent of F#/E#", () => {
    expect(withIds(EMPTY_WITH_MISSING).missing.map((m) => m.id)).toEqual(["M1", "M2", "M3"]);
    // A record with findings still starts missing items at M1.
    expect(withIds(CONCENTRIC_WALL_THICKENING).missing.map((m) => m.id)).toEqual(["M1"]);
  });

  it("stamps R# across redFlags in order, wrapping each string as { id, text }", () => {
    const a: Assessment = { ...RED_FLAG, redFlags: ["first flag", "second flag"] };
    expect(withIds(a).redFlags).toEqual([
      { id: "R1", text: "first flag" },
      { id: "R2", text: "second flag" },
    ]);
    // Deterministic, and independent of F#/E#/M#.
    expect(withIds(RED_FLAG).redFlags).toEqual([{ id: "R1", text: RED_FLAG.redFlags[0] }]);
    expect(withIds(RED_FLAG)).toEqual(withIds(RED_FLAG));
    expect(withIds(AORTIC_STENOSIS).redFlags).toEqual([]);
  });

  it("keeps F# and E# sequences independent of each other", () => {
    // AORTIC_STENOSIS has one finding with three evidence items.
    const ided = withIds(AORTIC_STENOSIS);
    expect(ided.findings.map((f) => f.id)).toEqual(["F1"]);
    expect(evidenceIds(ided.findings[0])).toEqual(["E1", "E2", "E3"]);
  });
});

describe("refsFor — contents", () => {
  it("returns a Ref for every finding, evidence and missing id", () => {
    const ided = withIds(CONCENTRIC_WALL_THICKENING);
    const refs = refsFor(ided);
    expect(Object.keys(refs).sort()).toEqual(["E1", "E2", "E3", "F1", "F2", "M1"]);
  });

  it("populates missing refs with kind, label, field and why, and no target/organ", () => {
    const refs = refsFor(withIds(CONCENTRIC_WALL_THICKENING));
    expect(refs.M1).toEqual({
      id: "M1",
      kind: "missing",
      label: "Missing data",
      field: "observations.lvMassIndex",
      why: CONCENTRIC_WALL_THICKENING.missing[0].why,
    });
    expect(refs.M1).not.toHaveProperty("target");
    expect(refs.M1).not.toHaveProperty("organ");
  });

  it("populates red-flag refs with kind, label and text, and no target/organ", () => {
    const refs = refsFor(withIds(RED_FLAG));
    expect(Object.keys(refs).sort()).toEqual(["E1", "F1", "R1"]);
    expect(refs.R1).toEqual({
      id: "R1",
      kind: "redFlag",
      label: "Red flag",
      text: RED_FLAG.redFlags[0],
    });
    expect(refs.R1).not.toHaveProperty("target");
    expect(refs.R1).not.toHaveProperty("organ");
  });

  it("populates finding refs with label, target and organ", () => {
    const ided = withIds(AORTIC_STENOSIS);
    const refs = refsFor(ided);
    expect(refs.F1).toEqual({
      id: "F1",
      kind: "finding",
      label: "Aortic stenosis, severe",
      target: "aortic_valve",
      organ: "heart",
    });
  });

  it("populates evidence refs with field, value, unit, rule, source and inherited target/organ", () => {
    const ided = withIds(AORTIC_STENOSIS);
    const refs = refsFor(ided);
    const source = AORTIC_STENOSIS.findings[0].evidence[0].source;
    expect(refs.E1).toEqual({
      id: "E1",
      kind: "evidence",
      label: "Aortic stenosis, severe",
      field: "valveFindings[valve=aortic_valve].peakVelocity",
      value: 4.3,
      unit: "m/s",
      rule: "R-VALVE-STEN-01",
      source,
      target: "aortic_valve",
      organ: "heart",
    });
  });

  it("inherits the parent finding's target/organ onto differential evidence refs", () => {
    const ided = withIds(CONCENTRIC_WALL_THICKENING);
    const refs = refsFor(ided);
    // The differential finding (F2 → E3) has no `target`, so evidence inherits none.
    const differential = CONCENTRIC_WALL_THICKENING.differential[0];
    expect(differential.target).toBeUndefined();
    expect(refs.E3).toEqual({
      id: "E3",
      kind: "evidence",
      label: "Hypertensive heart disease",
      field: "observations.systolicBP",
      value: 162,
      unit: "mmHg",
      rule: "R-LV-WALL-01",
      source: differential.evidence[0].source,
      organ: "heart",
    });
    expect(refs.E3).not.toHaveProperty("target");
  });

  it("omits optional fields that are absent on the source", () => {
    const a: Assessment = {
      findings: [
        {
          condition: "c1",
          label: "No target finding",
          basis: "possible",
          organ: "brain",
          evidence: [
            { field: "f", value: "qualitative", rule: "R-X", source: "s" },
          ],
        },
      ],
      differential: [],
      missing: [],
      redFlags: [],
      disclaimer: "d",
    };
    const refs = refsFor(withIds(a));
    expect(refs.F1).not.toHaveProperty("target");
    expect(refs.E1).not.toHaveProperty("target");
    expect(refs.E1).not.toHaveProperty("unit");
    expect(refs.E1.value).toBe("qualitative");
  });
});

describe("empty Assessment", () => {
  it("yields only missing refs without throwing", () => {
    const ided = withIds(EMPTY_WITH_MISSING);
    expect(ided.findings).toEqual([]);
    expect(ided.differential).toEqual([]);
    const refs = refsFor(ided);
    expect(Object.keys(refs)).toEqual(["M1", "M2", "M3"]);
    expect(Object.values(refs).every((r) => r.kind === "missing")).toBe(true);
  });

  it("keeps missing field/why, yields no red flags and passes the disclaimer through unchanged", () => {
    const ided = withIds(EMPTY_WITH_MISSING);
    expect(ided.missing.map(({ field, why }) => ({ field, why }))).toEqual(EMPTY_WITH_MISSING.missing);
    expect(ided.redFlags).toEqual([]);
    expect(ided.disclaimer).toBe(EMPTY_WITH_MISSING.disclaimer);
  });
});
