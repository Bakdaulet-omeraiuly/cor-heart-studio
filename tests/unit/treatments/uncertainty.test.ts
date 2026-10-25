import { describe, expect, it } from "vitest";
import { projectBrain } from "@/domain/outlook/project";
import { projectAsReplacement, projectBrainTreated, projectLvhTreated } from "@/domain/treatments/project";
import { interval, isBand, makeRng, normal, simulateAsReplacement, simulateBrain, simulateLvh } from "@/domain/treatments/uncertainty";

const LVH = { ivsMm: 14, pwMm: 13, lvidMm: 46, bsaM2: 1.9 };
const BRAIN = { hippocampus: 8, ventricles: 16, cortex: 500 };

describe("the generator", () => {
  it("is reproducible and standard normal", () => {
    const a = makeRng(7), b = makeRng(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    const r = makeRng(1);
    const xs = Array.from({ length: 20000 }, () => normal(r));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(0, 1);
    expect(sd).toBeCloseTo(1, 1);
  });
  it("interval takes the 2.5th, 50th and 97.5th percentiles", () => {
    const i = interval(Array.from({ length: 1001 }, (_, k) => k));
    expect([i.lo, i.mid, i.hi]).toEqual([25, 500, 975]);
  });
});

describe("LVH", () => {
  it("average effect: the 95 % interval of an ACE inhibitor matches its published CI (8 to 12 %) at the same LV mass index", () => {
    const lvmi0 = projectLvhTreated(LVH, [], 0, "mean").lvmiGm2;
    const i = simulateLvh(LVH, ["lvh-ace"], 1, "average")!;
    const det = projectLvhTreated(LVH, ["lvh-ace"], 1, "mean").lvmiGm2;
    expect(i.mid).toBeCloseTo(det, 0);
    // deterministic ends from the CI bounds, -12 % and -8 %
    expect(i.lo).toBeCloseTo(lvmi0 * 0.88, 0);
    expect(i.hi).toBeCloseTo(lvmi0 * 0.92, 0);
  });
  it("between patients is far wider than the uncertainty of the average (LIFE: SD 21.8 g/m², n = 457)", () => {
    const avg = simulateLvh(LVH, ["lvh-losartan"], 5, "average")!;
    const pat = simulateLvh(LVH, ["lvh-losartan"], 5, "patients")!;
    expect(pat.hi - pat.lo).toBeGreaterThan(20 * (avg.hi - avg.lo));
    expect(pat.hi - pat.lo).toBeCloseTo(2 * 1.96 * Math.hypot(1.02, 21.8), -1);
  });
  it("draws nothing it was not told: no spread reported for the patients, or no button on, gives no band", () => {
    expect(simulateLvh(LVH, ["lvh-ace"], 1, "patients")).toBeNull();
    expect(simulateLvh(LVH, [], 1, "average")).toBeNull();
  });
  it("is the same every time", () => {
    expect(simulateLvh(LVH, ["lvh-ccb"], 2, "average")).toEqual(simulateLvh(LVH, ["lvh-ccb"], 2, "average"));
  });
});

describe("aortic valve replacement", () => {
  it("only the spread between patients is reported: 1.72 ± 0.37 cm² gives about 1.0 to 2.4", () => {
    expect(simulateAsReplacement(["as-tavr"], 3, "average")).toBeNull();
    const i = simulateAsReplacement(["as-tavr"], 3, "patients")!;
    expect(i.lo).toBeCloseTo(1.72 - 1.96 * 0.37, 1);
    expect(i.hi).toBeCloseTo(1.72 + 1.96 * 0.37, 1);
    expect(projectAsReplacement(["as-tavr"], 3, "mean")!.avaCm2).toBe(1.72);
  });
});

describe("brain", () => {
  it("natural hippocampal rate: the average's 95 % interval reproduces the published CI of the cohort mean (Barnes 2009)", () => {
    const det = projectBrain(BRAIN, "alzheimers", 5, "mean").hippocampus;
    const i = simulateBrain(BRAIN, [], 5, "average").hippocampus;
    // the deterministic range is built from the CI ends, -3.92 and -5.40 %/y
    expect(i.lo / det.rangeMl[0]).toBeCloseTo(1, 2);
    expect(i.hi / det.rangeMl[1]).toBeCloseTo(1, 2);
  });
  it("anti-amyloid: the ventricles are larger than natural in nearly every draw, centred on +2.1 mL", () => {
    const nat = simulateBrain(BRAIN, [], 3, "average").ventricles;
    const on = simulateBrain(BRAIN, ["ad-antiamyloid"], 3, "average").ventricles;
    expect(on.mid - nat.mid).toBeCloseTo(2.1, 1);
    expect(on.lo).toBeGreaterThan(nat.lo);
    expect(isBand(nat)).toBe(false); // no spread reported for the ventricle rate: nothing is drawn
  });
  it("B vitamins: the cortex band is above the natural course and keeps the likely 29.6 % at its centre", () => {
    const nat = projectBrainTreated(BRAIN, [], 2, "mean").targets.cortex.projectedMl;
    const det = projectBrainTreated(BRAIN, ["ad-bvitamins"], 2, "mean").targets.cortex.projectedMl;
    const i = simulateBrain(BRAIN, ["ad-bvitamins"], 2, "average").cortex;
    expect(i.mid).toBeCloseTo(det, 1);
    expect(i.mid).toBeGreaterThan(nat);
  });
  it("the cortex rate varies only between patients (Sluimer, SD reported), the hippocampal rate only in the average", () => {
    expect(isBand(simulateBrain(BRAIN, [], 5, "patients").cortex)).toBe(true);
    expect(isBand(simulateBrain(BRAIN, [], 5, "average").cortex)).toBe(false);
    expect(isBand(simulateBrain(BRAIN, [], 5, "patients").hippocampus)).toBe(false);
  });
});
