import { describe, expect, it } from "vitest";
import { projectBrain } from "@/domain/outlook/project";
import { activeEffects, pickEffect, toggleTreatment } from "@/domain/treatments/select";
import { projectBrainTreated, projectLvhTreated } from "@/domain/treatments/project";
import { EVIDENCE } from "@/domain/treatments/load";

const LVH = { ivsMm: 14, pwMm: 14, lvidMm: 50, bsaM2: 1.9 };
const BRAIN = { hippocampus: 8, ventricles: 16, cortex: 500 };

describe("toggleTreatment", () => {
  it("adds an id and removes it on the second toggle", () => {
    const on = toggleTreatment([], "lvh-losartan");
    expect(on).toEqual(["lvh-losartan"]);
    expect(toggleTreatment(on, "lvh-losartan")).toEqual([]);
  });

  it("two bp-regimen buttons: switching the second on removes the first", () => {
    expect(toggleTreatment(["lvh-losartan"], "lvh-atenolol")).toEqual(["lvh-atenolol"]);
  });

  it("buttons in different groups stay together", () => {
    expect(toggleTreatment(["ad-exercise"], "ad-antiamyloid")).toEqual(["ad-exercise", "ad-antiamyloid"]);
  });

  it("ignores an id that is not in the evidence file", () => {
    expect(toggleTreatment(["lvh-losartan"], "nope")).toEqual(["lvh-losartan"]);
  });
});

describe("activeEffects and pickEffect", () => {
  it("keeps only entries that carry an effect", () => {
    expect(activeEffects(["ad-antiamyloid", "ad-exercise"]).map((e) => e.id)).toEqual(["ad-exercise"]);
  });

  it("maps pace to likely, best and worst", () => {
    const eff = EVIDENCE.entries.find((e) => e.id === "lvh-losartan")!.effect!;
    expect(pickEffect(eff, "mean")).toBe(eff.likely);
    expect(pickEffect(eff, "slow")).toBe(eff.best);
    expect(pickEffect(eff, "fast")).toBe(eff.worst);
  });
});

describe("projectLvhTreated", () => {
  it("all buttons off equals the natural course: LVMI +1.97 g/m2 after the one-year placebo arm", () => {
    const p = projectLvhTreated(LVH, [], 1, "mean");
    expect(p.lvmiChange).toBeCloseTo(1.97, 1);
    expect(p.heldBeyondEvidence).toBe(false);
  });

  it("losartan at 4.8 years changes LVMI by -21.7 g/m2", () => {
    const p = projectLvhTreated(LVH, ["lvh-losartan"], 4.8, "mean");
    expect(p.lvmiChange).toBeCloseTo(-21.7, 1);
    expect(p.lvmiGm2).toBeLessThan(projectLvhTreated(LVH, [], 4.8, "mean").lvmiGm2);
  });

  it("the change is held after the evidence years and heldBeyondEvidence is true at 10 years", () => {
    const at5 = projectLvhTreated(LVH, ["lvh-losartan"], 4.8, "mean");
    const at10 = projectLvhTreated(LVH, ["lvh-losartan"], 10, "mean");
    expect(at10.lvmiChange).toBeCloseTo(at5.lvmiChange, 6);
    expect(at10.heldBeyondEvidence).toBe(true);
  });

  it("the range runs from the favourable to the unfavourable end", () => {
    const p = projectLvhTreated(LVH, ["lvh-losartan"], 4.8, "mean");
    expect(p.lvmiRange[0]).toBeLessThan(p.lvmiChange);
    expect(p.lvmiRange[1]).toBeGreaterThanOrEqual(p.lvmiChange);
  });

  it("two bp regimens are never summed: the selected one alone drives the change", () => {
    const only = projectLvhTreated(LVH, ["lvh-atenolol"], 4.8, "mean");
    const both = projectLvhTreated(LVH, ["lvh-losartan", "lvh-atenolol"], 4.8, "mean");
    expect(both.lvmiChange).toBeGreaterThanOrEqual(-21.7 - 0.05);
    expect(both.lvmiChange).toBeLessThan(only.lvmiChange + 0.001);
    expect(both.lvmiChange).toBeGreaterThan(-39);
  });
});

describe("projectBrainTreated", () => {
  it("with no buttons equals projectBrain for Alzheimer's", () => {
    const { targets } = projectBrainTreated(BRAIN, [], 5, "mean");
    const base = projectBrain(BRAIN, "alzheimers", 5, "mean");
    expect(targets.hippocampus.projectedMl).toBeCloseTo(base.hippocampus.projectedMl, 9);
    expect(targets.cortex.projectedMl).toBeCloseTo(base.cortex.projectedMl, 9);
  });

  it("exercise at the best pace raises the hippocampus above the natural value", () => {
    const natural = projectBrainTreated(BRAIN, [], 1, "slow").targets.hippocampus.projectedMl;
    const treated = projectBrainTreated(BRAIN, ["ad-exercise"], 1, "slow").targets.hippocampus.projectedMl;
    expect(treated / natural).toBeCloseTo(1.0346, 4);
  });

  it("exercise at the likely pace changes nothing (no robust effect)", () => {
    const natural = projectBrainTreated(BRAIN, [], 3, "mean").targets.hippocampus.projectedMl;
    const treated = projectBrainTreated(BRAIN, ["ad-exercise"], 3, "mean").targets.hippocampus.projectedMl;
    expect(treated).toBeCloseTo(natural, 9);
  });

  it("a button without an effect changes nothing", () => {
    const natural = projectBrainTreated(BRAIN, [], 5, "mean");
    const treated = projectBrainTreated(BRAIN, ["ad-antiamyloid"], 5, "mean");
    expect(treated.targets.hippocampus.projectedMl).toBeCloseTo(natural.targets.hippocampus.projectedMl, 9);
    expect(treated.heldBeyondEvidence).toBe(false);
  });

  it("the effect is held after one year and flagged beyond the evidence", () => {
    const y1 = projectBrainTreated(BRAIN, ["ad-exercise"], 1, "slow");
    const y5 = projectBrainTreated(BRAIN, ["ad-exercise"], 5, "slow");
    const nat5 = projectBrainTreated(BRAIN, [], 5, "slow");
    expect(y1.heldBeyondEvidence).toBe(false);
    expect(y5.heldBeyondEvidence).toBe(true);
    expect(y5.targets.hippocampus.projectedMl / nat5.targets.hippocampus.projectedMl).toBeCloseTo(1.0346, 4);
  });
});
