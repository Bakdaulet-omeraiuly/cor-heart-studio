import { describe, expect, it } from "vitest";
import { BRAIN_SCENARIOS, SOURCES } from "@/domain/outlook/evidence";
import { compound, cortexShiftMm, gradeByArea, gradeByVelocity, MIN_AVA_CM2, projectAorticStenosis, projectBrain } from "@/domain/outlook/project";
import { readAsBaseline, withProjectedAorticStenosis } from "@/domain/outlook/heart";
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
