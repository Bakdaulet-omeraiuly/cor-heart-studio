import { describe, expect, it } from "vitest";
import { projectBrain } from "@/domain/outlook/project";
import { activeEffects, pickEffect, toggleTreatment } from "@/domain/treatments/select";
import { projectAsReplacement, projectBrainTreated, projectLvhTreated } from "@/domain/treatments/project";
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
    expect(activeEffects(["as-statin", "ad-exercise"]).map((e) => e.id)).toEqual(["ad-exercise"]);
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

describe("projectLvhTreated: drug classes and weight loss", () => {
  const lvmi0 = (inp: typeof LVH) => (0.8 * 1.04 * ((inp.ivsMm / 10 + inp.lvidMm / 10 + inp.pwMm / 10) ** 3 - (inp.lvidMm / 10) ** 3) + 0.6) / inp.bsaM2;

  it("an ACE inhibitor lowers today's LV mass index by 10% after the study length and holds it", () => {
    const p = projectLvhTreated(LVH, ["lvh-ace"], 0.5, "mean");
    expect(p.lvmiChange).toBeCloseTo(-0.1 * lvmi0(LVH), 2);
    expect(projectLvhTreated(LVH, ["lvh-ace"], 5, "mean").lvmiChange).toBeCloseTo(p.lvmiChange, 6);
  });

  it("the classes rank as in Klingbeil 2003: calcium channel blocker > ACE inhibitor > diuretic", () => {
    const at = (id: string) => projectLvhTreated(LVH, [id], 1, "mean").lvmiChange;
    expect(at("lvh-ccb")).toBeLessThan(at("lvh-ace"));
    expect(at("lvh-ace")).toBeLessThan(at("lvh-diuretic"));
    expect(at("lvh-diuretic")).toBeLessThan(0);
  });

  it("weight loss lowers LV mass by 2.9 g, which is 2.9 / BSA in g/m² after a year", () => {
    const p = projectLvhTreated(LVH, ["lvh-weightloss"], 1, "mean");
    expect(p.lvmiChange).toBeCloseTo(-2.9 / LVH.bsaM2, 1);
    expect(p.lvmiGm2).toBeLessThan(projectLvhTreated(LVH, [], 1, "mean").lvmiGm2);
  });

  it("a drug and weight loss are not summed: the larger regression is shown", () => {
    const both = projectLvhTreated(LVH, ["lvh-ace", "lvh-weightloss"], 1, "mean");
    const drug = projectLvhTreated(LVH, ["lvh-ace"], 1, "mean");
    expect(both.lvmiChange).toBeCloseTo(drug.lvmiChange, 9);
  });

  it("the favourable end of a class is its upper confidence bound, 12% for an ACE inhibitor", () => {
    const slow = projectLvhTreated(LVH, ["lvh-ace"], 0.5, "slow");
    expect(slow.lvmiChange).toBeCloseTo(-0.12 * lvmi0(LVH), 2);
  });
});

describe("projectAsReplacement: TAVR and surgical valve replacement (PARTNER 3)", () => {
  it("is null with no valve button on, and still null today (years 0)", () => {
    expect(projectAsReplacement([], 5, "mean")).toBeNull();
    expect(projectAsReplacement(["as-statin"], 5, "mean")).toBeNull();
    expect(projectAsReplacement(["as-tavr"], 0, "mean")).toBeNull();
  });

  it("gives the trial's valve area at once, then holds it and flags it beyond the one-year evidence", () => {
    const early = projectAsReplacement(["as-tavr"], 0.5, "mean")!;
    const late = projectAsReplacement(["as-tavr"], 8, "mean")!;
    expect(early.avaCm2).toBe(1.72);
    expect(late.avaCm2).toBe(1.72);
    expect(early.heldBeyondEvidence).toBe(false);
    expect(late.heldBeyondEvidence).toBe(true);
  });

  it("pace picks the end of the spread between patients: slower = larger area, faster = smaller", () => {
    expect(projectAsReplacement(["as-savr"], 3, "slow")!.avaCm2).toBe(2.18);
    expect(projectAsReplacement(["as-savr"], 3, "fast")!.avaCm2).toBe(1.34);
    expect(projectAsReplacement(["as-savr"], 3, "mean")!.avaRangeCm2).toEqual([1.34, 2.18]);
  });

  it("TAVR and surgery are alternatives: the second switches the first off", () => {
    expect(toggleTreatment(["as-tavr"], "as-savr")).toEqual(["as-savr"]);
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
    const treated = projectBrainTreated(BRAIN, ["as-statin"], 5, "mean");
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

describe("anti-amyloid antibody: larger ventricles (Alves 2023)", () => {
  it("adds 2.1 mL to the ventricles after the 1.5 years and leaves the other structures alone", () => {
    const natural = projectBrainTreated(BRAIN, [], 3, "mean").targets;
    const treated = projectBrainTreated(BRAIN, ["ad-antiamyloid"], 3, "mean").targets;
    expect(treated.ventricles.projectedMl - natural.ventricles.projectedMl).toBeCloseTo(2.1, 9);
    expect(treated.hippocampus.projectedMl).toBeCloseTo(natural.hippocampus.projectedMl, 9);
    expect(treated.cortex.projectedMl).toBeCloseTo(natural.cortex.projectedMl, 9);
  });

  it("builds up in proportion to the trial length, then is held and flagged beyond the evidence", () => {
    const half = projectBrainTreated(BRAIN, ["ad-antiamyloid"], 0.75, "mean");
    const nat = projectBrainTreated(BRAIN, [], 0.75, "mean");
    expect(half.targets.ventricles.projectedMl - nat.targets.ventricles.projectedMl).toBeCloseTo(1.05, 9);
    expect(half.heldBeyondEvidence).toBe(false);
    expect(projectBrainTreated(BRAIN, ["ad-antiamyloid"], 5, "mean").heldBeyondEvidence).toBe(true);
  });

  it("the favourable end is 1.5 mL and the unfavourable end 2.8 mL", () => {
    const nat = (p: "slow" | "fast") => projectBrainTreated(BRAIN, [], 3, p).targets.ventricles.projectedMl;
    expect(projectBrainTreated(BRAIN, ["ad-antiamyloid"], 3, "slow").targets.ventricles.projectedMl - nat("slow")).toBeCloseTo(1.5, 9);
    expect(projectBrainTreated(BRAIN, ["ad-antiamyloid"], 3, "fast").targets.ventricles.projectedMl - nat("fast")).toBeCloseTo(2.8, 9);
  });
});

describe("B vitamins: slower whole-brain loss (VITACOG, Smith 2010)", () => {
  it("keeps 29.6% of the cortex volume the natural course loses over the 2 trial years", () => {
    const natural = projectBrainTreated(BRAIN, [], 2, "mean").targets.cortex;
    const treated = projectBrainTreated(BRAIN, ["ad-bvitamins"], 2, "mean").targets.cortex;
    const lost = natural.baselineMl - natural.projectedMl;
    expect(treated.projectedMl - natural.projectedMl).toBeCloseTo(0.296 * lost, 9);
    expect(treated.projectedMl).toBeGreaterThan(natural.projectedMl);
  });

  it("after the 2 years the saved volume is held, not extrapolated", () => {
    const at2 = projectBrainTreated(BRAIN, ["ad-bvitamins"], 2, "mean").targets.cortex;
    const nat2 = projectBrainTreated(BRAIN, [], 2, "mean").targets.cortex;
    const at6 = projectBrainTreated(BRAIN, ["ad-bvitamins"], 6, "mean");
    const nat6 = projectBrainTreated(BRAIN, [], 6, "mean").targets.cortex;
    expect(at6.targets.cortex.projectedMl - nat6.projectedMl).toBeCloseTo(at2.projectedMl - nat2.projectedMl, 9);
    expect(at6.heldBeyondEvidence).toBe(true);
  });

  it("the favourable end (high homocysteine) saves more than the likely value, the unfavourable end nothing", () => {
    const saved = (p: "slow" | "mean" | "fast") =>
      projectBrainTreated(BRAIN, ["ad-bvitamins"], 2, p).targets.cortex.projectedMl - projectBrainTreated(BRAIN, [], 2, p).targets.cortex.projectedMl;
    expect(saved("fast")).toBeCloseTo(0, 9);
    expect(saved("slow") / (BRAIN.cortex - projectBrainTreated(BRAIN, [], 2, "slow").targets.cortex.projectedMl)).toBeCloseTo(0.53, 9);
  });

  it("does not combine with the hippocampal effect of exercise: each moves its own structure", () => {
    const both = projectBrainTreated(BRAIN, ["ad-bvitamins", "ad-exercise"], 2, "slow").targets;
    const exercise = projectBrainTreated(BRAIN, ["ad-exercise"], 2, "slow").targets;
    expect(both.hippocampus.projectedMl).toBeCloseTo(exercise.hippocampus.projectedMl, 9);
  });
});

