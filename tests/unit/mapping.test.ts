import { describe, expect, it } from "vitest";
import { ASSET_BASELINE_PROFILE as REF } from "@/domain/references/asset-baseline";
import { map, minimal, norm, obs, samplePatients } from "./helpers";

const B = REF.baseline;

describe("mapPatientToVisual", () => {
  it("is deterministic: identical inputs yield identical output", () => {
    for (const raw of samplePatients()) {
      const a = map(norm(raw)), b = map(norm(structuredClone(raw)));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it("uses heart rate only for timing — not geometry", () => {
    const slow = map(norm(minimal({ observations: { heartRate: obs(50, "bpm") } })));
    const fast = map(norm(minimal({ observations: { heartRate: obs(120, "bpm") } })));
    expect(slow.timing.phases.rrSeconds).toBeCloseTo(1.2);
    expect(fast.timing.phases.rrSeconds).toBeCloseTo(0.5);
    expect(slow.lv).toEqual(fast.lv);
  });

  it("does not change geometry from blood pressure alone", () => {
    const base = map(norm(minimal()));
    const hyper = map(norm(minimal({ observations: { systolicBP: obs(210, "mmHg"), diastolicBP: obs(120, "mmHg") } })));
    expect(hyper.lv).toEqual(base.lv);
    expect(hyper.segments).toEqual(base.segments);
    expect(hyper.changes).toHaveLength(0);
  });

  it("marks missing observations as unknown, not normal", () => {
    const v = map(norm(minimal()));
    expect(v.lv.edRadial).toBe(1);
    expect(v.timing.evidence).toBe("default_unknown");
    expect(v.lvTargets.esvEvidence).toBe("default_unknown");
    expect(v.unknowns.map((u) => u.structure)).toEqual(expect.arrayContaining(["lv", "rv", "la", "ra", "myocardium"]));
    expect(v.structureStatus.lv.status).toBe("default_unknown");
  });

  it("applies the cube-root rule for a volume-only LV change", () => {
    const v = map(norm(minimal({ observations: { lvEndDiastolicVolume: obs(B.lvEndDiastolicVolumeMl * 1.331, "mL") } })));
    expect(v.lv.edRadial).toBeCloseTo(1.1, 3);
    expect(v.lv.edLong).toBeCloseTo(1.1, 3);
    expect(v.lv.edRadial ** 2 * v.lv.edLong).toBeCloseTo(1.331, 3); // not 1.331 per axis
  });

  it("combines a diameter and a volume without treating them as interchangeable", () => {
    const v = map(norm(minimal({ observations: { lvEndDiastolicDiameter: obs(B.lvEndDiastolicDiameterMm * 1.2, "mm"), lvEndDiastolicVolume: obs(B.lvEndDiastolicVolumeMl * 1.44, "mL") } })));
    expect(v.lv.edRadial).toBeCloseTo(1.2, 3);
    expect(v.lv.edLong).toBeCloseTo(1.0, 3);
  });

  it("drives systolic excursion from EF — never heart rate or overall scale", () => {
    const v = map(norm(minimal({ observations: { lvEjectionFraction: obs(30, "%") } })));
    expect(v.lv.edRadial).toBe(1);
    const rho = v.lv.esRadialEndo ** 2 * v.lv.esLong;
    expect(rho).toBeCloseTo(0.7, 3); // ESV/EDV = 1 − EF
    expect(v.changes.find((c) => c.ruleId === "R-LV-EF-01")?.sources[0].path).toBe("observations.lvEjectionFraction");
  });

  it("animates between EDV and ESV targets and explains a conflicting EF", () => {
    const v = map(norm(minimal({ observations: { lvEndDiastolicVolume: obs(180, "mL"), lvEndSystolicVolume: obs(126, "mL"), lvEjectionFraction: obs(50, "%") } })));
    expect(v.lvTargets.edvMl).toBe(180);
    expect(v.lvTargets.esvMl).toBeCloseTo(126, 6);
    const c = v.changes.find((x) => x.ruleId === "R-LV-EF-02")!;
    expect(c.evidence).toBe("derived");
    expect(c.conflicts[0]).toMatch(/Reported LVEF 50%/);
  });

  it("thickens only the measured septal segments and tapers neighbours as illustrative", () => {
    const v = map(norm(minimal({ observations: { ivsThickness: obs(B.ivsThicknessMm + 6, "mm") } })));
    for (const s of [2, 3, 8, 9, 14]) {
      expect(v.segments.thicknessDeltaCm[s - 1]).toBeCloseTo(0.6, 3);
      expect(v.segments.status[s - 1]).toBe("measured");
    }
    expect(v.segments.thicknessDeltaCm[5 - 1]).toBe(v.segments.status[4] === "interpolated" ? v.segments.thicknessDeltaCm[4] : 0);
    expect(v.segments.thicknessDeltaCm[16 - 1]).toBe(0); // apical lateral untouched
    expect(v.lv.edRadial).toBe(1); // not a whole-heart enlargement
  });

  it("keeps regional wall-motion effects on the named segments", () => {
    const v = map(norm(minimal({ echo: { regionalWallMotion: [{ segment: 7, motion: "akinetic" }] } })));
    expect(v.segments.motion[6]).toBe(0);
    expect(v.segments.motion.filter((m, i) => i !== 6).every((m) => m === 1)).toBe(true);
    expect(v.highlights[0]).toMatchObject({ structure: "lv", segments: [7] });
  });

  it("clamps geometry for display without rewriting the clinical value", () => {
    const p = norm(minimal({ observations: { lvEndDiastolicDiameter: obs(120, "mm") } }));
    const v = map(p);
    expect(v.lv.edRadial).toBe(REF.bounds.lvRadial[1]);
    expect(p.observations["observations.lvEndDiastolicDiameter"].value).toBe(120);
    expect(v.issues.find((i) => i.code === "display.clamped")).toBeTruthy();
    expect(v.changes[0].displayAdjustment).toMatch(/limited/);
  });

  it("depicts stenosis and regurgitation on the named valve only", () => {
    const v = map(norm(minimal({ valveFindings: [{ valve: "aortic", condition: "stenosis", severity: "severe" }, { valve: "mitral", condition: "regurgitation", severity: "moderate" }] })));
    expect(v.valves.aortic_valve.maxOpening).toBeLessThan(0.5);
    expect(v.valves.mitral_valve.regurgitation).toBe("moderate");
    expect(v.valves.pulmonary_valve).toMatchObject({ maxOpening: 1, stenosis: null, regurgitation: null });
    const regurg = v.changes.find((c) => c.ruleId === "R-VALVE-REGURG-01")!;
    expect(regurg.nature).toBe("illustrative");
    expect(regurg.limitations.join(" ")).toMatch(/not measured flow/);
  });

  it("every visual change carries traceable provenance", () => {
    for (const raw of samplePatients()) {
      for (const c of map(norm(raw)).changes) {
        expect(c.ruleId).toMatch(/^R-/);
        expect(c.ruleVersion).toBeTruthy();
        expect(c.sources.length).toBeGreaterThan(0);
        expect(["quantitative", "qualitative", "illustrative"]).toContain(c.nature);
        expect(c.summary.length).toBeGreaterThan(10);
      }
    }
  });

  it("sample cases produce their intended differences", () => {
    const by = Object.fromEntries(samplePatients().map((r) => [r.patientId as string, map(norm(r))]));
    expect(by["SYN-002"].lv.edRadial).toBeGreaterThan(by["SYN-001"].lv.edRadial);
    expect(by["SYN-002"].lv.esRadialEndo).toBeGreaterThan(by["SYN-001"].lv.esRadialEndo); // less contraction
    expect(Math.max(...by["SYN-003"].segments.thicknessDeltaCm)).toBeGreaterThan(0.3);
    expect(by["SYN-004"].valves.aortic_valve.stenosis).toBe("severe");
    expect(by["SYN-005"].valves.mitral_valve).toMatchObject({ regurgitation: "severe", prolapse: true });
    expect(by["SYN-006"].unknowns.length).toBeGreaterThanOrEqual(5);
    expect(by["SYN-007"].segments.motion[13]).toBeLessThan(0); // dyskinetic apical septal
  });
});
