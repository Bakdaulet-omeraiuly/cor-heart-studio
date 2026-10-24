import { describe, expect, it } from "vitest";
import { BRAIN_SCENARIOS, SOURCES } from "@/domain/outlook/evidence";
import { compound, cortexShiftMm, gradeByArea, gradeByVelocity, lvMassAse, MIN_AVA_CM2, MIN_WALL_MM, projectAorticStenosis, projectBrain, projectLvh, wallsForMass } from "@/domain/outlook/project";
import { readAsBaseline, readLvhBaseline, withProjectedAorticStenosis, withProjectedWalls } from "@/domain/outlook/heart";
import { map, minimal, norm, samplePatients } from "./helpers";

const BASE = { hippocampus: 8, ventricles: 16, cortex: 500 };

describe("outlook evidence", () => {
  it("cites a known source with a DOI for every rate", () => {
    for (const s of Object.values(BRAIN_SCENARIOS)) {
      for (const r of Object.values(s.rates)) {
        expect(SOURCES[r.source]?.doi).toMatch(/^10\./);
        // slow..fast must bracket the mean, in the direction of change
        expect(Math.min(r.slow, r.fast)).toBeLessThanOrEqual(r.mean);
        expect(Math.max(r.slow, r.fast)).toBeGreaterThanOrEqual(r.mean);
      }
    }
  });

  it("keeps the published hippocampal rates (Barnes 2009 meta-analysis)", () => {
    expect(BRAIN_SCENARIOS.aging.rates.hippocampus.mean).toBe(-1.41);
    expect(BRAIN_SCENARIOS.alzheimers.rates.hippocampus.mean).toBe(-4.66);
  });
});

describe("brain projection", () => {
  it("is the baseline at year 0", () => {
    const p = projectBrain(BASE, "alzheimers", 0, "mean");
    expect(p.hippocampus.projectedMl).toBe(8);
    expect(p.cortex.ratio).toBe(1);
  });

  it("compounds the annual rate", () => {
    expect(compound(100, -10, 2)).toBeCloseTo(81);
    const p = projectBrain(BASE, "alzheimers", 5, "mean");
    expect(p.hippocampus.projectedMl).toBeCloseTo(8 * Math.pow(1 - 0.0466, 5));
    expect(p.ventricles.projectedMl).toBeCloseTo(16 * Math.pow(1.09, 5));
  });

  it("shrinks faster in Alzheimer's than in typical ageing, and the range contains the estimate", () => {
    const a = projectBrain(BASE, "aging", 10, "mean"), d = projectBrain(BASE, "alzheimers", 10, "mean");
    expect(d.hippocampus.projectedMl).toBeLessThan(a.hippocampus.projectedMl);
    expect(d.ventricles.projectedMl).toBeGreaterThan(a.ventricles.projectedMl);
    for (const x of Object.values(d)) {
      expect(x.rangeMl[0]).toBeLessThanOrEqual(x.projectedMl + 1e-9);
      expect(x.rangeMl[1]).toBeGreaterThanOrEqual(x.projectedMl - 1e-9);
    }
  });

  it("turns cortical volume loss into a sub-millimetre inward shift", () => {
    expect(cortexShiftMm(1)).toBe(0);
    const r = projectBrain(BASE, "alzheimers", 10, "fast").cortex.ratio;
    expect(cortexShiftMm(r)).toBeGreaterThan(0);
    expect(cortexShiftMm(r)).toBeLessThan(1);
  });
});

describe("aortic stenosis projection", () => {
  it("grades with the ACC/AHA 2020 thresholds", () => {
    expect(gradeByVelocity(4.0)).toBe("severe");
    expect(gradeByVelocity(3.5)).toBe("moderate");
    expect(gradeByVelocity(2.5)).toBe("mild");
    expect(gradeByArea(1.0)).toBe("severe");
    expect(gradeByArea(1.2)).toBe("moderate");
    expect(gradeByArea(1.8)).toBe("mild");
  });

  it("progresses at the Otto 1997 averages and moves a moderate valve to severe", () => {
    const p = projectAorticStenosis(1.3, 3.2, 5, "mean");
    expect(p.ava).toBeCloseTo(1.3 - 0.6);
    expect(p.vmax).toBeCloseTo(3.2 + 1.6);
    expect(projectAorticStenosis(1.3, 3.2, 0, "mean").grade).toBe("moderate");
    expect(p.grade).toBe("severe");
    expect(p.eventFree2y.percent).toBe(21);
  });

  it("never regresses on the slow end and never reaches a zero area", () => {
    const slow = projectAorticStenosis(1.3, 3.2, 10, "slow");
    expect(slow.ava).toBe(1.3);
    expect(slow.vmax).toBe(3.2);
    expect(projectAorticStenosis(0.8, 4.3, 30, "fast").ava).toBe(MIN_AVA_CM2);
  });
});

describe("heart outlook record", () => {
  const as = samplePatients().find((p) => p.patientId === "SYN-004")!;

  it("reads valve area and peak velocity from a reported aortic stenosis", () => {
    expect(readAsBaseline(norm(as))).toEqual({ ava: 0.8, vmax: 4.3 });
    expect(readAsBaseline(norm(minimal()))).toEqual({ ava: null, vmax: null });
  });

  it("renders the projected grade through the ordinary mapping rules", () => {
    const p = norm(minimal());
    const today = withProjectedAorticStenosis(p, projectAorticStenosis(1.3, 3.2, 0, "mean"), "::t0");
    const later = withProjectedAorticStenosis(p, projectAorticStenosis(1.3, 3.2, 5, "mean"), "::t5");
    expect(today.key).not.toBe(later.key);
    const v0 = map(today).valves.aortic_valve, v5 = map(later).valves.aortic_valve;
    expect(v0.stenosis).toBe("moderate");
    expect(v5.stenosis).toBe("severe");
    expect(v5.maxOpening).toBeLessThan(v0.maxOpening);
  });
});

describe("hypertensive LVH on treatment", () => {
  const SYN3 = { ivsMm: 15, pwMm: 14, lvidMm: 44, bsaM2: 1.9 };

  it("computes LV mass with the ASE cube formula and the Devereux 1986 correction", () => {
    // 0.8 · 1.04 · [(1.5 + 4.4 + 1.4)³ − 4.4³] + 0.6
    expect(lvMassAse(15, 44, 14)).toBeCloseTo(0.8 * 1.04 * (7.3 ** 3 - 4.4 ** 3) + 0.6, 6);
  });

  it("finds walls that reproduce a target mass with the cavity held", () => {
    const w = wallsForMass(15, 44, 14, 200);
    expect(lvMassAse(w.ivsMm, 44, w.pwMm)).toBeCloseTo(200, 6);
    expect(w.ivsMm / w.pwMm).toBeCloseTo(15 / 14, 9);
  });

  it("applies the LIFE change in full at the 4.8-year follow-up and holds it after", () => {
    const at = projectLvh(SYN3, "losartan", 4.8, "mean"), later = projectLvh(SYN3, "losartan", 10, "mean");
    expect(at.lvmiChange).toBeCloseTo(-21.7, 6);
    expect(later.lvmiChange).toBeCloseTo(-21.7, 6);
    expect(projectLvh(SYN3, "losartan", 2.4, "mean").lvmiChange).toBeCloseTo(-21.7 / 2, 6);
    expect(at.ivsMm).toBeLessThan(15);
  });

  it("regresses more with losartan than atenolol, and never thickens on the slow end", () => {
    expect(projectLvh(SYN3, "losartan", 5, "mean").lvmiChange).toBeLessThan(projectLvh(SYN3, "atenolol", 5, "mean").lvmiChange);
    expect(projectLvh(SYN3, "losartan", 5, "slow").lvmiChange).toBeCloseTo(0, 9);
    const r = projectLvh(SYN3, "atenolol", 5, "mean");
    expect(r.lvmiRange[0]).toBeLessThanOrEqual(r.lvmiChange);
    expect(r.lvmiRange[1]).toBeGreaterThanOrEqual(r.lvmiChange);
  });

  it("does not thin a wall below the floor", () => {
    const p = projectLvh({ ivsMm: 9, pwMm: 9, lvidMm: 46, bsaM2: 2.4 }, "losartan", 5, "fast");
    expect(Math.min(p.ivsMm, p.pwMm)).toBeGreaterThanOrEqual(MIN_WALL_MM - 1e-9);
  });

  it("renders projected walls through the ordinary thickness rule", () => {
    const syn3 = norm(samplePatients().find((p) => p.patientId === "SYN-003")!);
    expect(readLvhBaseline(syn3)).toMatchObject({ ivsMm: 15, pwMm: 14, lvidMm: 44, bsaM2: null });
    const p = projectLvh(SYN3, "losartan", 5, "mean");
    const today = map(withProjectedWalls(syn3, 15, 14, "::t0", "today"));
    const later = map(withProjectedWalls(syn3, p.ivsMm, p.pwMm, "::t5", "+5 y"));
    const thick = (v: ReturnType<typeof map>) => v.changes.filter((c) => c.property.toLowerCase().includes("thick")).length;
    expect(thick(today)).toBeGreaterThan(0);
    expect(JSON.stringify(later.segments)).not.toBe(JSON.stringify(today.segments));
  });
});
