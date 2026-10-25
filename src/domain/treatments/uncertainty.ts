// Monte Carlo around the projections. Two different questions, never mixed:
//   "average"  how sure are we of the cohort-average effect? Draws from the published confidence interval (SE).
//   "patients" how far can one patient differ? Adds the SD of the effect between patients, where a study reported it.
// The published central values are replaced by draws and the ordinary projections are called again (no formula is repeated).
// A quantity with no reported SE (or SD) is left at its published value, so nothing is drawn from a number nobody measured.
import { BRAIN_SCENARIOS, type BrainTarget } from "../outlook/evidence";
import type { LvhInputs } from "../outlook/project";
import { activeEffects } from "./select";
import { projectAsReplacement, projectBrainTreated, projectLvhTreated } from "./project";

export type Spread = "average" | "patients";

/** The 2.5th, 50th and 97.5th percentiles of the draws (a 95 % interval). */
export interface Interval { lo: number; mid: number; hi: number; draws: number }

export const DRAWS = 2000;
const SEED = 20261025;

/** Small seeded generator (mulberry32): the same inputs always give the same band, so the screen and the tests are reproducible. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draw (Box–Muller). */
export function normal(rand: () => number): number {
  const u = Math.max(rand(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const quantile = (sorted: number[], q: number) => {
  const pos = q * (sorted.length - 1), i = Math.floor(pos), f = pos - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
};
export function interval(values: number[]): Interval {
  const s = [...values].sort((a, b) => a - b);
  return { lo: quantile(s, 0.025), mid: quantile(s, 0.5), hi: quantile(s, 0.975), draws: s.length };
}

/** Standard deviation to draw an effect's central value with, or null when the study reported none for this question. */
const sdFor = (e: { se?: number; sd?: number }, spread: Spread): number | null =>
  spread === "average" ? (e.se ?? null) : e.sd != null ? Math.hypot(e.se ?? 0, e.sd) : null;

/** Draw one value per active effect that has a reported spread for this question. */
function drawEffects(active: string[], spread: Spread, rand: () => number, filter: (q: string) => boolean): { effect: Record<string, number>; any: boolean } {
  const effect: Record<string, number> = {};
  for (const entry of activeEffects(active)) {
    const eff = entry.effect!;
    const sd = filter(eff.quantity) ? sdFor(eff, spread) : null;
    if (sd != null) effect[entry.id] = eff.likely + sd * normal(rand);
  }
  return { effect, any: Object.keys(effect).length > 0 };
}

/** LV mass index (g/m²) at `years` with an LVH button on. Null when no active button has a reported spread for this question. */
export function simulateLvh(inp: LvhInputs, active: string[], years: number, spread: Spread, draws = DRAWS): Interval | null {
  const rand = makeRng(SEED);
  const out: number[] = [];
  for (let i = 0; i < draws; i++) {
    const d = drawEffects(active, spread, rand, (q) => q.startsWith("lv"));
    if (!d.any) return null;
    out.push(projectLvhTreated(inp, active, years, "mean", { effect: d.effect }).lvmiGm2);
  }
  return interval(out);
}

/** Valve area (cm²) after a valve replacement. Only the spread between patients is reported, so "average" gives null. */
export function simulateAsReplacement(active: string[], years: number, spread: Spread, draws = DRAWS): Interval | null {
  const rand = makeRng(SEED);
  const out: number[] = [];
  for (let i = 0; i < draws; i++) {
    const d = drawEffects(active, spread, rand, (q) => q === "ava_cm2");
    if (!d.any) return null;
    const r = projectAsReplacement(active, years, "mean", { effect: d.effect });
    if (!r) return null;
    out.push(r.avaCm2);
  }
  return interval(out);
}

/**
 * Natural annual rate draws: a rate reported with the 95 % CI of the cohort mean varies in "average"; one reported with the SD between
 * patients varies in "patients". The slow and fast ends are the CI bounds (SE = width / 3.92) or the mean ± 1 SD (SD = width / 2).
 */
function drawRates(spread: Spread, rand: () => number): Partial<Record<BrainTarget, number>> {
  const out: Partial<Record<BrainTarget, number>> = {};
  for (const [target, rate] of Object.entries(BRAIN_SCENARIOS.alzheimers.rates) as [BrainTarget, (typeof BRAIN_SCENARIOS.alzheimers.rates)[BrainTarget]][]) {
    const width = Math.abs(rate.fast - rate.slow);
    if (spread === "average" && rate.spread === "ci95_mean") out[target] = rate.mean + (width / 3.92) * normal(rand);
    if (spread === "patients" && rate.spread === "sd_patients") out[target] = rate.mean + (width / 2) * normal(rand);
  }
  return out;
}

/** Projected volume (mL) of each brain structure at `years`, with the natural rates and the active effects drawn. */
export function simulateBrain(baseline: Record<BrainTarget, number>, active: string[], years: number, spread: Spread, draws = DRAWS): Record<BrainTarget, Interval> {
  const rand = makeRng(SEED);
  const out: Record<BrainTarget, number[]> = { hippocampus: [], ventricles: [], cortex: [] };
  for (let i = 0; i < draws; i++) {
    const ratePct = drawRates(spread, rand);
    const { effect } = drawEffects(active, spread, rand, (q) => !q.startsWith("lv") && q !== "ava_cm2");
    const { targets } = projectBrainTreated(baseline, active, years, "mean", { ratePct, effect });
    for (const t of Object.keys(out) as BrainTarget[]) out[t].push(targets[t].projectedMl);
  }
  return { hippocampus: interval(out.hippocampus), ventricles: interval(out.ventricles), cortex: interval(out.cortex) };
}

/** True when the draws actually varied (something had a reported spread), so a band is worth showing. */
export const isBand = (i: Interval | null | undefined): i is Interval => !!i && i.hi - i.lo > 1e-9;
