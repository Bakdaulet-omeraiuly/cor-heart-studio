// Pure projection of today's measurements forward in time with the published rates in ./evidence.
// Deterministic, no React. Same inputs => same output.
import type { Severity } from "../schema/record";
import { AS_EVENT_FREE_2Y, AS_PROGRESSION, BRAIN_SCENARIOS, LVH_FOLLOW_UP_YEARS, LVH_TREATMENT, type BrainScenarioId, type BrainTarget, type LvhArm, type Rate } from "./evidence";

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

// ---------------------------------------------------------------- hypertensive LVH on treatment

/**
 * LV mass (g) from end-diastolic linear dimensions (mm): ASE cube formula with the Devereux 1986 necropsy correction,
 * LVM = 0.8 · 1.04 · [(IVSd + LVIDd + PWd)³ − LVIDd³] + 0.6, dimensions in cm.
 */
export function lvMassAse(ivsMm: number, lvidMm: number, pwMm: number): number {
  const [s, d, p] = [ivsMm / 10, lvidMm / 10, pwMm / 10];
  return 0.8 * 1.04 * ((s + d + p) ** 3 - d ** 3) + 0.6;
}

/** Thinnest wall the projection may reach (mm): below the normal range, so it never clamps a plausible result. */
export const MIN_WALL_MM = 6;

/** Septal and posterior walls scaled by one factor so the ASE mass equals `targetG`, cavity diameter held. */
export function wallsForMass(ivsMm: number, lvidMm: number, pwMm: number, targetG: number): { ivsMm: number; pwMm: number } {
  const d = lvidMm / 10;
  const outer = Math.cbrt(Math.max(0, (targetG - 0.6) / 0.832) + d ** 3); // IVS + LVID + PW in cm
  // never thinner than MIN_WALL_MM, and never thicken a wall that is already below it
  const k = Math.max(((outer - d) * 10) / (ivsMm + pwMm), Math.min(1, MIN_WALL_MM / Math.min(ivsMm, pwMm)));
  return { ivsMm: ivsMm * k, pwMm: pwMm * k };
}

export interface LvhInputs { ivsMm: number; pwMm: number; lvidMm: number; bsaM2: number }

export interface LvhProjection {
  years: number;
  ivsMm: number;
  pwMm: number;
  lvmG: number;
  lvmiGm2: number;
  /** LVMI change applied (g/m²) and its range over ±1 SD (slower end clamped at no regression). */
  lvmiChange: number;
  lvmiRange: [number, number];
  /** Share of the LIFE follow-up reached (1 at and beyond 4.8 years). */
  fractionOfFollowUp: number;
}

/**
 * LIFE reports the change from baseline to the last study (mean 4.8 years). Between today and then the change is
 * interpolated linearly (an assumption); after that it is held, because LIFE has no data beyond its follow-up.
 */
export function projectLvh(inp: LvhInputs, arm: LvhArm, years: number, pace: Pace): LvhProjection {
  const t = LVH_TREATMENT[arm];
  const f = Math.min(1, years / LVH_FOLLOW_UP_YEARS);
  const k = pace === "mean" ? 0 : pace === "slow" ? -1 : 1;
  const at = (kk: number) => Math.min(0, t.lvmiChange - kk * t.sd) * f;
  const lvm0 = lvMassAse(inp.ivsMm, inp.lvidMm, inp.pwMm);
  const solve = (dLvmi: number) => {
    const w = wallsForMass(inp.ivsMm, inp.lvidMm, inp.pwMm, lvm0 + dLvmi * inp.bsaM2);
    const lvm = lvMassAse(w.ivsMm, inp.lvidMm, w.pwMm);
    return { ...w, lvm };
  };
  const mid = solve(at(k));
  const lo = solve(at(1)), hi = solve(at(-1));
  return {
    years, ivsMm: mid.ivsMm, pwMm: mid.pwMm, lvmG: mid.lvm, lvmiGm2: mid.lvm / inp.bsaM2,
    lvmiChange: (mid.lvm - lvm0) / inp.bsaM2,
    lvmiRange: [(lo.lvm - lvm0) / inp.bsaM2, (hi.lvm - lvm0) / inp.bsaM2],
    fractionOfFollowUp: f,
  };
}
