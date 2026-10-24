// Illustrative cardiac-cycle timing. Frequency comes from the supplied heart rate; the waveform shape is
// a fixed illustrative template. Ejection time follows the published LVET–HR regression (Weissler et al., 1968,
// LVET[s] ≈ 0.413 − 0.0017·HR, men) purely to keep systole plausible across heart rates.

export interface CyclePhases {
  rrSeconds: number;
  /** Phase boundaries as fractions of the RR interval (0 = end-diastole / onset of ventricular systole). */
  ivcEnd: number; // isovolumic contraction ends, semilunar valves open
  ejectionEnd: number; // end-systole, semilunar valves close
  ivrEnd: number; // isovolumic relaxation ends, AV valves open
  rapidFillEnd: number;
  atrialStart: number; // atrial contraction begins
}

export const PHASE_NAMES = {
  ivc: "Isovolumic contraction",
  ejection: "Ventricular ejection",
  ivr: "Isovolumic relaxation",
  rapidFill: "Rapid ventricular filling",
  diastasis: "Diastasis",
  atrial: "Atrial contraction",
} as const;
export type PhaseName = keyof typeof PHASE_NAMES;

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

export function cyclePhases(heartRateBpm: number): CyclePhases {
  const rr = 60 / heartRateBpm;
  const ivc = 0.05;
  const lvet = clamp(0.413 - 0.0017 * heartRateBpm, 0.16, 0.36);
  const ivr = 0.07;
  const atrial = Math.min(0.12, rr * 0.16);
  let rapid = 0.16;
  const used = ivc + lvet + ivr + atrial;
  let fill = rr - used; // rapid filling + diastasis
  if (fill < 0.06) fill = 0.06;
  rapid = Math.min(rapid, fill * 0.8);
  const total = ivc + lvet + ivr + fill + atrial;
  const k = rr / total; // compress uniformly only if the template does not fit (very high rates)
  const t1 = (ivc * k) / rr;
  const t2 = t1 + (lvet * k) / rr;
  const t3 = t2 + (ivr * k) / rr;
  const t4 = t3 + (rapid * k) / rr;
  const t5 = 1 - (atrial * k) / rr;
  return { rrSeconds: rr, ivcEnd: t1, ejectionEnd: t2, ivrEnd: t3, rapidFillEnd: Math.min(t4, t5), atrialStart: t5 };
}

export function phaseName(p: CyclePhases, phi: number): PhaseName {
  if (phi < p.ivcEnd) return "ivc";
  if (phi < p.ejectionEnd) return "ejection";
  if (phi < p.ivrEnd) return "ivr";
  if (phi < p.rapidFillEnd) return "rapidFill";
  if (phi < p.atrialStart) return "diastasis";
  return "atrial";
}

export interface CycleSample {
  /** Ventricular contraction 0 (end-diastole) .. 1 (end-systole). */
  ventricular: number;
  /** Atrial size offset: +1 largest (late ventricular systole), -1 smallest (end of atrial contraction). */
  atrial: number;
  semilunarOpen: number; // 0..1
  atrioventricularOpen: number; // 0..1
  phase: PhaseName;
}

export function sampleCycle(p: CyclePhases, phiIn: number): CycleSample {
  const phi = ((phiIn % 1) + 1) % 1;
  const phase = phaseName(p, phi);
  let v: number;
  if (phi < p.ivcEnd) v = 0;
  else if (phi < p.ejectionEnd) { const x = (phi - p.ivcEnd) / (p.ejectionEnd - p.ivcEnd); v = 1 - Math.pow(1 - x, 2.2); }
  else if (phi < p.ivrEnd) v = 1;
  else if (phi < p.rapidFillEnd) { const x = (phi - p.ivrEnd) / (p.rapidFillEnd - p.ivrEnd); v = 1 - 0.72 * (1 - Math.pow(1 - x, 2)); }
  else if (phi < p.atrialStart) { const x = (phi - p.rapidFillEnd) / Math.max(1e-6, p.atrialStart - p.rapidFillEnd); v = 0.28 - 0.08 * x; }
  else { const x = (phi - p.atrialStart) / (1 - p.atrialStart); v = 0.2 * (1 - smooth(x)); }

  // atria: fill (reservoir) during ventricular systole, empty passively (conduit) then actively
  let a: number;
  if (phi < p.ejectionEnd) a = -0.6 + 1.6 * smooth(phi / p.ejectionEnd);
  else if (phi < p.ivrEnd) a = 1;
  else if (phi < p.rapidFillEnd) a = 1 - 1.0 * smooth((phi - p.ivrEnd) / (p.rapidFillEnd - p.ivrEnd));
  else if (phi < p.atrialStart) a = 0.0 + 0.1 * smooth((phi - p.rapidFillEnd) / Math.max(1e-6, p.atrialStart - p.rapidFillEnd));
  else a = 0.1 - 0.7 * smooth((phi - p.atrialStart) / (1 - p.atrialStart));

  const ramp = 0.025;
  const sl = phi > p.ivcEnd && phi < p.ejectionEnd
    ? Math.min(smooth((phi - p.ivcEnd) / ramp), smooth((p.ejectionEnd - phi) / ramp)) : 0;
  let avo = 0;
  if (phi > p.ivrEnd) {
    const open = smooth((phi - p.ivrEnd) / ramp);
    // partial closure (mid-diastolic drift) during diastasis, reopening with atrial contraction
    let level = 1;
    if (phi > p.rapidFillEnd && phi < p.atrialStart) level = 1 - 0.45 * smooth((phi - p.rapidFillEnd) / Math.max(1e-6, (p.atrialStart - p.rapidFillEnd) * 0.6));
    if (phi >= p.atrialStart) level = 0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, (phi - p.atrialStart) / (1 - p.atrialStart) * 1.2));
    const close = smooth((1 - phi) / ramp);
    avo = open * level * close;
  }
  return { ventricular: clamp(v, 0, 1), atrial: clamp(a, -1, 1), semilunarOpen: sl, atrioventricularOpen: avo, phase };
}

/** End-systole phase fraction (useful for presets). */
export const endSystolePhase = (p: CyclePhases) => p.ejectionEnd;
