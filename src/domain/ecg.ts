// ECG timing and a synthesized lead-II-like trace built from the record's intervals, coupled to the mechanical cycle.
// Pure and deterministic. The trace is a schematic of the reported intervals, never a recording.
//
// Sources
// - Morphology: sum of Gaussian P, Q, R, S, T events, the form used by McSharry et al. 2003 (IEEE Trans Biomed Eng
//   50:289-94, doi:10.1109/TBME.2003.808805). Event amplitudes and widths here are illustrative; event TIMES come from
//   the record's PR, QRS and QT when supplied.
// - Rate correction: Bazett QTc = QT/√RR; Fridericia QTc = QT/∛RR; Framingham QTLC = QT + 0.154(1 − RR)
//   (Sagie et al. 1992, Am J Cardiol 70:797-801, doi:10.1016/0002-9149(92)90562-d). RR in seconds.
// - Electromechanical coupling: pre-ejection period PEP = 131 − 0.4·HR ms and QS2 = 546 − 2.1·HR ms (men; Weissler et al.
//   1968, Circulation 37:149-59, doi:10.1161/01.cir.37.2.149), the same paper whose LVET regression sets the systole in
//   cycle.ts. QRS onset is placed one PEP before aortic valve opening.

import type { CyclePhases } from "./mapping/cycle";

export type IntervalEvidence = "reported" | "derived" | "population_default";

export interface Interval { ms: number; evidence: IntervalEvidence; note?: string }

export interface EcgInputs {
  heartRateBpm: number;
  prMs?: number | null;
  qrsMs?: number | null;
  qtMs?: number | null;
  qtcMs?: number | null;
  /** Correction method the reported QTc used, if any (e.g. "Bazett"). */
  qtcMethod?: string | null;
}

/** Population defaults used only when the record has no value (labelled as such). */
export const ECG_DEFAULTS = { prMs: 160, qrsMs: 90, pWaveMs: 100 } as const;
/** Framingham mean QT at RR 0.81 s was 0.35 s (men): QTLC ≈ 0.379 s, used to set a default QT for the record's RR. */
export const FRAMINGHAM_MEAN_QTLC_S = 0.35 + 0.154 * (1 - 0.81);

export const qtcBazett = (qtMs: number, rrS: number) => qtMs / Math.sqrt(rrS);
export const qtcFridericia = (qtMs: number, rrS: number) => qtMs / Math.cbrt(rrS);
export const qtcFramingham = (qtMs: number, rrS: number) => qtMs + 154 * (1 - rrS);
export const pepMs = (hr: number) => 131 - 0.4 * hr;
export const qs2Ms = (hr: number) => 546 - 2.1 * hr;

export interface EcgTiming {
  rrS: number;
  pr: Interval;
  qrs: Interval;
  qt: Interval;
  qtc: { bazett: number; fridericia: number; framingham: number; reported: { ms: number; method: string | null } | null };
  pep: number;
  qs2: number;
  /** Position of QRS onset in the mechanical cycle (fraction of RR, 0 = end-diastole / mitral closure). */
  qrsOnsetPhase: number;
  /** Gaussian events in seconds after QRS onset: centre, sigma, amplitude (mV, illustrative). */
  events: { name: "P" | "Q" | "R" | "S" | "T"; t: number; sigma: number; amp: number }[];
}

export function ecgTiming(inp: EcgInputs, phases: CyclePhases): EcgTiming {
  const rrS = 60 / inp.heartRateBpm;
  const rep = (v: number | null | undefined, fallback: number, note?: string): Interval =>
    v != null && Number.isFinite(v) ? { ms: v, evidence: "reported" } : { ms: fallback, evidence: "population_default", note };
  const pr = rep(inp.prMs, ECG_DEFAULTS.prMs, "Typical adult PR, not this patient");
  const qrs = rep(inp.qrsMs, ECG_DEFAULTS.qrsMs, "Typical adult QRS, not this patient");
  let qt: Interval;
  if (inp.qtMs != null) qt = { ms: inp.qtMs, evidence: "reported" };
  else if (inp.qtcMs != null) {
    // invert the reported correction (Bazett unless another method is named)
    const m = (inp.qtcMethod ?? "Bazett").toLowerCase();
    const ms = m.startsWith("frid") ? inp.qtcMs * Math.cbrt(rrS) : m.startsWith("fram") ? inp.qtcMs - 154 * (1 - rrS) : inp.qtcMs * Math.sqrt(rrS);
    qt = { ms, evidence: "derived", note: `From the reported QTc (${inp.qtcMethod ?? "Bazett assumed"}) at this RR` };
  } else {
    qt = { ms: 1000 * (FRAMINGHAM_MEAN_QTLC_S - 0.154 * (1 - rrS)), evidence: "population_default", note: "Framingham mean for this RR (Sagie 1992), not this patient" };
  }
  const pep = pepMs(inp.heartRateBpm);
  const s = (ms: number) => ms / 1000;
  const q = s(qrs.ms), t = s(qt.ms);
  const tSigma = Math.max(0.03, 0.18 * t * 0.5);
  const events: EcgTiming["events"] = [
    { name: "P", t: -s(pr.ms) + s(ECG_DEFAULTS.pWaveMs) / 2, sigma: s(ECG_DEFAULTS.pWaveMs) / 5, amp: 0.15 },
    { name: "Q", t: 0.15 * q, sigma: q / 10, amp: -0.12 },
    { name: "R", t: 0.42 * q, sigma: q / 9, amp: 1.1 },
    { name: "S", t: 0.72 * q, sigma: q / 10, amp: -0.28 },
    // T ends ~2.5 sigma after its peak; the QT ends there
    { name: "T", t: t - 2.5 * tSigma, sigma: tSigma, amp: 0.32 },
  ];
  // aortic valve opens at phases.ivcEnd; QRS onset precedes it by the PEP
  const qrsOnsetPhase = (((phases.ivcEnd * rrS - s(pep)) / rrS) % 1 + 1) % 1;
  return {
    rrS, pr, qrs, qt, pep, qs2: qs2Ms(inp.heartRateBpm), qrsOnsetPhase, events,
    qtc: {
      bazett: qtcBazett(qt.ms, rrS), fridericia: qtcFridericia(qt.ms, rrS), framingham: qtcFramingham(qt.ms, rrS),
      reported: inp.qtcMs != null ? { ms: inp.qtcMs, method: inp.qtcMethod ?? null } : null,
    },
  };
}

/** Synthesized voltage (mV, illustrative scale) at a cycle phase (0..1 of RR). Sums neighbouring beats so waves wrap. */
export function ecgAt(timing: EcgTiming, phase: number): number {
  const tq = (phase - timing.qrsOnsetPhase) * timing.rrS; // seconds after this beat's QRS onset
  let v = 0;
  for (const k of [-1, 0, 1]) {
    const t = tq + k * timing.rrS;
    for (const e of timing.events) v += e.amp * Math.exp(-((t - e.t) ** 2) / (2 * e.sigma ** 2));
  }
  return v;
}
