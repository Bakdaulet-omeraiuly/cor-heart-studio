// Projections that combine the natural course with the active treatment buttons.
// A study's change is applied in proportion to elapsed time up to its follow-up and held after that: no extrapolation.
import { lvMassAse, projectBrain, wallsForMass, type BrainProjection, type LvhInputs, type LvhProjection, type Pace } from "../outlook/project";
import type { BrainTarget } from "../outlook/evidence";
import { entriesFor } from "./load";
import { activeEffects, pickEffect } from "./select";
import type { Effect } from "./types";

const share = (years: number, e: Effect) => Math.min(1, years / e.evidenceYears);

/**
 * LVH: the LV mass index change comes from the active blood-pressure regimen, or from the natural course when none is on
 * (with several, the one with the greatest regression: they are not summed).
 */
export function projectLvhTreated(inp: LvhInputs, active: string[], years: number, pace: Pace): LvhProjection & { heldBeyondEvidence: boolean } {
  const regimens = activeEffects(active).filter((e) => e.condition === "lvh");
  const entry = regimens.length
    ? regimens.reduce((a, b) => (b.effect!.likely < a.effect!.likely ? b : a))
    : entriesFor("lvh", "natural").find((e) => e.effect)!;
  const eff = entry.effect!;
  const f = share(years, eff);
  const lvm0 = lvMassAse(inp.ivsMm, inp.lvidMm, inp.pwMm);
  const solve = (dLvmi: number) => {
    const w = wallsForMass(inp.ivsMm, inp.lvidMm, inp.pwMm, lvm0 + dLvmi * inp.bsaM2);
    return { ...w, lvm: lvMassAse(w.ivsMm, inp.lvidMm, w.pwMm) };
  };
  const mid = solve(pickEffect(eff, pace) * f);
  const best = solve(eff.best * f);
  const worst = solve(eff.worst * f);
  return {
    years, ivsMm: mid.ivsMm, pwMm: mid.pwMm, lvmG: mid.lvm, lvmiGm2: mid.lvm / inp.bsaM2,
    lvmiChange: (mid.lvm - lvm0) / inp.bsaM2,
    lvmiRange: [(best.lvm - lvm0) / inp.bsaM2, (worst.lvm - lvm0) / inp.bsaM2],
    fractionOfFollowUp: f,
    heldBeyondEvidence: years > eff.evidenceYears,
  };
}

/**
 * Alzheimer's brain: the published natural rates, then each active hippocampal effect as a volume factor held after its
 * study duration. Only the hippocampus has a treatment effect with evidence in v1.
 */
export function projectBrainTreated(
  baseline: Record<BrainTarget, number>, active: string[], years: number, pace: Pace,
): { targets: Record<BrainTarget, BrainProjection>; heldBeyondEvidence: boolean } {
  const targets = projectBrain(baseline, "alzheimers", years, pace);
  const effects = activeEffects(active).filter((e) => e.effect!.quantity === "hippocampus_pct");
  const factor = (pick: (e: Effect) => number) => effects.reduce((acc, e) => acc * (1 + (pick(e.effect!) * share(years, e.effect!)) / 100), 1);
  const mid = factor((e) => pickEffect(e, pace));
  const h = targets.hippocampus;
  const projectedMl = h.projectedMl * mid;
  const lo = h.rangeMl[0] * factor((e) => Math.min(e.best, e.worst));
  const hi = h.rangeMl[1] * factor((e) => Math.max(e.best, e.worst));
  targets.hippocampus = { ...h, projectedMl, ratio: projectedMl / h.baselineMl, rangeMl: [Math.min(lo, hi), Math.max(lo, hi)] };
  return { targets, heldBeyondEvidence: effects.some((e) => years > e.effect!.evidenceYears) };
}
