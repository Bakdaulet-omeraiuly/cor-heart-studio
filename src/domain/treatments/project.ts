// Projections that combine the natural course with the active treatment buttons.
// A study's change is applied in proportion to elapsed time up to its follow-up and held after that: no extrapolation.
import { compound, lvMassAse, projectBrain, wallsForMass, type BrainProjection, type LvhInputs, type LvhProjection, type Pace } from "../outlook/project";
import type { BrainTarget } from "../outlook/evidence";
import { entriesFor } from "./load";
import { activeEffects, pickEffect } from "./select";
import type { Effect, EvidenceEntry } from "./types";

/** Values drawn by the Monte Carlo in place of the published ones: a %/year rate per structure, and an effect's central value by entry id. */
export interface Draw {
  ratePct?: Partial<Record<BrainTarget, number>>;
  effect?: Record<string, number>;
}

const share = (years: number, e: Effect) => Math.min(1, years / e.evidenceYears);

/** An effect's value as a change in this patient's LV mass index (g/m²); percentages apply to today's LVMI, grams to today's body surface area. */
const toLvmi = (e: Effect, v: number, lvmi0: number, bsaM2: number) =>
  e.quantity === "lvmi_pct" ? (v / 100) * lvmi0 : e.quantity === "lvm_g" ? v / bsaM2 : v;

/**
 * LVH: the LV mass index change comes from the active treatment buttons, or from the natural course when none is on.
 * No trial combines them, so with several on the one with the greatest regression is shown, not their sum.
 */
export function projectLvhTreated(inp: LvhInputs, active: string[], years: number, pace: Pace, draw?: Draw): LvhProjection & { heldBeyondEvidence: boolean } {
  const lvm0 = lvMassAse(inp.ivsMm, inp.lvidMm, inp.pwMm);
  const lvmi0 = lvm0 / inp.bsaM2;
  const delta = (e: Effect, v: number) => toLvmi(e, v, lvmi0, inp.bsaM2);
  const regimens = activeEffects(active).filter((e) => e.condition === "lvh");
  const entry = regimens.length
    ? regimens.reduce((a, b) => (delta(b.effect!, b.effect!.likely) < delta(a.effect!, a.effect!.likely) ? b : a))
    : entriesFor("lvh", "natural").find((e) => e.effect)!;
  const eff = entry.effect!;
  const f = share(years, eff);
  const solve = (dLvmi: number) => {
    const w = wallsForMass(inp.ivsMm, inp.lvidMm, inp.pwMm, lvm0 + dLvmi * inp.bsaM2);
    return { ...w, lvm: lvMassAse(w.ivsMm, inp.lvidMm, w.pwMm) };
  };
  const mid = solve(delta(eff, draw?.effect?.[entry.id] ?? pickEffect(eff, pace)) * f);
  const best = solve(delta(eff, eff.best) * f);
  const worst = solve(delta(eff, eff.worst) * f);
  return {
    years, ivsMm: mid.ivsMm, pwMm: mid.pwMm, lvmG: mid.lvm, lvmiGm2: mid.lvm / inp.bsaM2,
    lvmiChange: (mid.lvm - lvm0) / inp.bsaM2,
    lvmiRange: [(best.lvm - lvm0) / inp.bsaM2, (worst.lvm - lvm0) / inp.bsaM2],
    fractionOfFollowUp: f,
    heldBeyondEvidence: years > eff.evidenceYears,
  };
}

/**
 * Alzheimer's brain: the published natural rates, then each active effect, held after its study duration (no extrapolation):
 * hippocampal volume as a factor, ventricles as extra millilitres, and the cortex as a share of the natural loss that is avoided.
 */
export function projectBrainTreated(
  baseline: Record<BrainTarget, number>, active: string[], years: number, pace: Pace, draw?: Draw,
): { targets: Record<BrainTarget, BrainProjection>; heldBeyondEvidence: boolean } {
  const targets = projectBrain(baseline, "alzheimers", years, pace, draw?.ratePct);
  const central = (x: EvidenceEntry) => draw?.effect?.[x.id] ?? pickEffect(x.effect!, pace);
  const all = activeEffects(active);
  const of = (q: Effect["quantity"]) => all.filter((e) => e.effect!.quantity === q);

  const hippocampus = of("hippocampus_pct");
  const factor = (pick: (x: EvidenceEntry) => number) => hippocampus.reduce((acc, x) => acc * (1 + (pick(x) * share(years, x.effect!)) / 100), 1);
  const mid = factor(central);
  const h = targets.hippocampus;
  const hippocampusMl = h.projectedMl * mid;
  const hLo = h.rangeMl[0] * factor((x) => Math.min(x.effect!.best, x.effect!.worst));
  const hHi = h.rangeMl[1] * factor((x) => Math.max(x.effect!.best, x.effect!.worst));
  targets.hippocampus = { ...h, projectedMl: hippocampusMl, ratio: hippocampusMl / h.baselineMl, rangeMl: [Math.min(hLo, hHi), Math.max(hLo, hHi)] };

  const ventricles = of("ventricles_ml");
  const addedMl = (pick: (x: EvidenceEntry) => number) => ventricles.reduce((acc, x) => acc + pick(x) * share(years, x.effect!), 0);
  const v = targets.ventricles;
  const ventriclesMl = v.projectedMl + addedMl(central);
  targets.ventricles = {
    ...v, projectedMl: ventriclesMl, ratio: ventriclesMl / v.baselineMl,
    rangeMl: [v.rangeMl[0] + addedMl((x) => Math.min(x.effect!.best, x.effect!.worst)), v.rangeMl[1] + addedMl((x) => Math.max(x.effect!.best, x.effect!.worst))],
  };

  const slowing = of("cortex_slowing_pct");
  const c = targets.cortex;
  // millilitres of natural loss avoided: the share of the loss over the study's years, then held
  const avoidedMl = (pctOf: (x: EvidenceEntry) => number, ratePct: number) =>
    slowing.reduce((acc, x) => acc + (pctOf(x) / 100) * (c.baselineMl - compound(c.baselineMl, ratePct, Math.min(years, x.effect!.evidenceYears))), 0);
  const cortexMl = c.projectedMl + avoidedMl(central, c.ratePct);
  const cLo = c.rangeMl[0] + avoidedMl((x) => Math.min(x.effect!.best, x.effect!.worst), c.rate.fast);
  const cHi = c.rangeMl[1] + avoidedMl((x) => Math.max(x.effect!.best, x.effect!.worst), c.rate.slow);
  targets.cortex = { ...c, projectedMl: cortexMl, ratio: cortexMl / c.baselineMl, rangeMl: [Math.min(cLo, cHi), Math.max(cLo, cHi)] };

  return { targets, heldBeyondEvidence: [...hippocampus, ...ventricles, ...slowing].some((e) => years > e.effect!.evidenceYears) };
}

export interface AsReplacement {
  id: string;
  label: string;
  years: number;
  /** Valve area after the procedure (cm²) at the chosen end of the spread, and its ±1 SD range between patients. */
  avaCm2: number;
  avaRangeCm2: [number, number];
  heldBeyondEvidence: boolean;
}

/**
 * Aortic stenosis: a valve replacement is immediate and stops the native progression, so from the first day after "today" the valve
 * has the area the randomised echo studies report. Pace picks the end of the spread between patients. Null when no replacement is on.
 */
export function projectAsReplacement(active: string[], years: number, pace: Pace, draw?: Draw): AsReplacement | null {
  if (years <= 0) return null;
  const entry = activeEffects(active).find((e) => e.effect!.quantity === "ava_cm2");
  if (!entry) return null;
  const eff = entry.effect!;
  return {
    id: entry.id, label: entry.label, years,
    avaCm2: draw?.effect?.[entry.id] ?? pickEffect(eff, pace),
    avaRangeCm2: [Math.min(eff.best, eff.worst), Math.max(eff.best, eff.worst)],
    heldBeyondEvidence: years > eff.evidenceYears,
  };
}
