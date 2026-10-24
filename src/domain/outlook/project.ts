// Pure projection of today's measurements forward in time with the published rates in ./evidence.
// Deterministic, no React. Same inputs => same output.
import type { Severity } from "../schema/record";
import { AS_EVENT_FREE_2Y, AS_PROGRESSION, BRAIN_SCENARIOS, type BrainScenarioId, type BrainTarget, type Rate } from "./evidence";

export type Pace = "slow" | "mean" | "fast";

export const PACE_LABEL: Record<Pace, string> = { slow: "Slower", mean: "Average", fast: "Faster" };

/** Compound a signed %/year rate over `years`: V(t) = V0 · (1 + r/100)^t. */
export function compound(v0: number, ratePctPerYear: number, years: number): number {
  return v0 * Math.pow(1 + ratePctPerYear / 100, years);
}

export const rateAt = (r: Rate, pace: Pace) => (pace === "mean" ? r.mean : pace === "slow" ? r.slow : r.fast);

export interface BrainProjection {
  target: BrainTarget;
  baselineMl: number;
  projectedMl: number;
  /** projected / baseline volume */
  ratio: number;
  /** Range over the slower..faster ends of the reported spread. */
  rangeMl: [number, number];
  rate: Rate;
  ratePct: number;
}

export function projectBrain(
  baseline: Record<BrainTarget, number>, scenario: BrainScenarioId, years: number, pace: Pace,
): Record<BrainTarget, BrainProjection> {
  const s = BRAIN_SCENARIOS[scenario];
  const out = {} as Record<BrainTarget, BrainProjection>;
  for (const target of Object.keys(s.rates) as BrainTarget[]) {
    const rate = s.rates[target];
    const v0 = baseline[target];
    const ratePct = rateAt(rate, pace);
    const v = compound(v0, ratePct, years);
    const a = compound(v0, rate.slow, years), b = compound(v0, rate.fast, years);
    out[target] = { target, baselineMl: v0, projectedMl: v, ratio: v / v0, rangeMl: [Math.min(a, b), Math.max(a, b)], rate, ratePct };
  }
  return out;
}

/** Mean cortical thickness used to turn a cortical volume ratio into an inward surface shift (mm). */
export const CORTEX_THICKNESS_MM = 2.5;

/** Inward cortical surface shift (mm) for a volume ratio, assuming volume loss is thinning at constant area. */
export const cortexShiftMm = (ratio: number) => CORTEX_THICKNESS_MM * (1 - ratio);

// ---------------------------------------------------------------- aortic stenosis

export type AsGrade = "none" | "mild" | "moderate" | "severe";

/** ACC/AHA 2020 haemodynamic thresholds. */
export function gradeByVelocity(vmax: number): AsGrade {
  if (vmax >= 4) return "severe";
  if (vmax >= 3) return "moderate";
  if (vmax >= 2) return "mild";
  return "none";
}
export function gradeByArea(ava: number): AsGrade {
  if (ava <= 1) return "severe";
  if (ava <= 1.5) return "moderate";
  return "mild";
}
const ORDER: AsGrade[] = ["none", "mild", "moderate", "severe"];
export const worse = (a: AsGrade, b: AsGrade): AsGrade => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

export const gradeToSeverity = (g: AsGrade): Severity => (g === "none" ? "none" : g);

/** Physiological floor for a stenotic aortic valve area, so a long projection never reaches zero. */
export const MIN_AVA_CM2 = 0.3;

export interface AsProjection {
  years: number;
  ava: number;
  vmax: number;
  avaRange: [number, number];
  vmaxRange: [number, number];
  gradeArea: AsGrade;
  gradeVelocity: AsGrade;
  /** Worse of the two: the guideline grades severe when either criterion is met. */
  grade: AsGrade;
  eventFree2y: (typeof AS_EVENT_FREE_2Y)[number];
}

/**
 * Linear progression (Otto 1997 reports per-year changes). Pace uses mean ± 1 SD between patients;
 * the slower end is clamped to "no progression" because stenosis does not regress without intervention.
 */
export function projectAorticStenosis(ava0: number, vmax0: number, years: number, pace: Pace): AsProjection {
  const { areaCm2PerYear: a, velocityMsPerYear: v } = AS_PROGRESSION;
  const k = pace === "mean" ? 0 : pace === "slow" ? -1 : 1;
  const dA = Math.min(0, a.mean - k * a.sd); // area falls: faster = more negative
  const dV = Math.max(0, v.mean + k * v.sd);
  const areaAt = (d: number) => Math.max(MIN_AVA_CM2, ava0 + d * years);
  const ava = areaAt(dA);
  const vmax = vmax0 + dV * years;
  const avaRange: [number, number] = [areaAt(Math.min(0, a.mean - a.sd)), areaAt(Math.min(0, a.mean + a.sd))];
  const vmaxRange: [number, number] = [vmax0 + Math.max(0, v.mean - v.sd) * years, vmax0 + (v.mean + v.sd) * years];
  const gradeArea = gradeByArea(ava);
  const gradeVelocity = gradeByVelocity(vmax);
  const eventFree2y = AS_EVENT_FREE_2Y.find((b) => vmax < b.maxVelocity || b.maxVelocity === Infinity)!;
  return { years, ava, vmax, avaRange, vmaxRange, gradeArea, gradeVelocity, grade: worse(gradeArea, gradeVelocity), eventFree2y };
}
