// Engine context: read-only access to the normalized record + collectors for the Assessment.
// Free text is never copied out: only numbers, schema enums and closed keyword matches leave this module.
import type { CadRadsCategory, CoronaryVessel } from "../coronary";
import type { ValveId } from "../schema/record";
import type { NormalizedPatient } from "../types";
import { ruleSource, type RuleId } from "./rules";
import type { Evidence, Finding } from "./types";

export interface Num { field: string; value: number; unit: string }

export type Sex = "male" | "female";
export type SymptomKey = "syncope" | "angina" | "dyspnoea" | "heart_failure" | "palpitations";
export type Territory = "LAD" | "RCA" | "LCx";
export type Grade4 = "none" | "mild" | "moderate" | "severe";

/** Grades and evidence other modules (and phase-2 differential) depend on. */
export interface Facts {
  as?: { grade: Grade4 | "discordant"; evidence: Evidence[]; gradientSevere: boolean };
  regurg: Partial<Record<ValveId, { grade: string; evidence: Evidence[]; atLeastModerate: boolean; severe: boolean }>>;
  mitralProlapse?: Evidence;
  lvef?: { value: number; evidence: Evidence };
  lvDilated?: Evidence[];
  lvMassIncreased?: Evidence[];
  concentricRemodelling?: Evidence[];
  wallThick?: Evidence[];
  maxWallMm?: Num;
  wma: Partial<Record<Territory, Evidence[]>>;
  cad?: { category: CadRadsCategory; evidence: Evidence[]; vessels: { vessel: CoronaryVessel; percent: number; evidence: Evidence }[] };
  laEnlarged?: Evidence[];
  rvAbnormal?: Evidence[];
  atrialFibrillation?: Evidence;
  qtcProlonged?: Evidence[];
  wideQrs?: Evidence;
}

const SYMPTOM_KEYWORDS: [SymptomKey, RegExp][] = [
  ["syncope", /syncope|fainting|faint\b/i],
  ["angina", /angina|chest pain|chest tightness|chest pressure/i],
  ["dyspnoea", /dyspn|breathless|shortness of breath|orthopn/i],
  ["heart_failure", /oedema|edema|orthopn|paroxysmal nocturnal|heart failure/i],
  ["palpitations", /palpitation/i],
];
const NEGATION = /\b(no|not|denies|denied|without|absent|negative)\b/i;

function readSex(v: string | undefined): Sex | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (["m", "male", "man"].includes(s)) return "male";
  if (["f", "female", "woman"].includes(s)) return "female";
  return null;
}

const STATUS_WHY: Record<string, string> = {
  null: "explicitly unknown in the record",
  unit_missing: "value has no unit, so it is not used",
  unit_unknown: "unit is not supported, so the value is not used",
  impossible: "value is outside physically possible bounds and was excluded",
  context_mismatch: "value is indexed or its phase contradicts the field, so it is not used as an absolute value",
  contradiction: "value contradicts another measurement (e.g. ESV ≥ EDV) and was excluded",
};

const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** Same field + value + rule listed twice (e.g. via two facts) is shown once. */
function dedupeEvidence(f: Finding): Finding {
  const seen = new Set<string>();
  const evidence = f.evidence.filter((e) => {
    const k = `${e.field}|${e.value}|${e.rule}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { ...f, evidence };
}
export const round = r;

export class Ctx {
  readonly findings: Finding[] = [];
  readonly differential: Finding[] = [];
  readonly redFlags: string[] = [];
  readonly facts: Facts = { regurg: {}, wma: {} };
  private readonly missingMap = new Map<string, string>();
  readonly sex: Sex | null;
  readonly symptoms: Set<SymptomKey>;

  constructor(readonly p: NormalizedPatient) {
    this.sex = readSex(p.record.demographics?.biologicalSex);
    const symptoms = new Set<SymptomKey>();
    for (const s of [...(p.record.symptoms ?? []), ...(p.record.symptomDetails ?? [])]) {
      if (s.present === false || NEGATION.test(s.symptom)) continue;
      for (const [k, re] of SYMPTOM_KEYWORDS) if (re.test(s.symptom)) symptoms.add(k);
    }
    this.symptoms = symptoms;
  }

  get missing() { return [...this.missingMap].map(([field, why]) => ({ field, why })); }

  need(field: string, why: string) { if (!this.missingMap.has(field)) this.missingMap.set(field, why); }
  finding(f: Finding) { this.findings.push(dedupeEvidence(f)); }
  alt(f: Finding) { if (!this.differential.some((d) => d.condition === f.condition)) this.differential.push(dedupeEvidence(f)); }
  redFlag(text: string) { if (!this.redFlags.includes(text)) this.redFlags.push(text); }

  ev(rule: RuleId, field: string, value: number | string, unit?: string): Evidence {
    return unit === undefined ? { field, value, rule, source: ruleSource(rule) } : { field, value, unit, rule, source: ruleSource(rule) };
  }
  evNum(rule: RuleId, n: Num): Evidence { return this.ev(rule, n.field, n.value, n.unit); }

  /** A usable normalized observation (canonical unit). Unusable states are reported as missing with a fixed reason. */
  num(path: string, whyIfAbsent?: string): Num | null {
    const o = this.p.observations[path];
    if (!o) { if (whyIfAbsent) this.need(path, whyIfAbsent); return null; }
    if (o.status === "ok" && o.value !== null) return { field: path, value: o.value, unit: o.unit };
    this.need(path, STATUS_WHY[o.status] ?? "value not usable");
    return null;
  }

  /** A value derived by normalize (e.g. lvEfFromVolumes, bsaMosteller). */
  derived(id: string): Num | null {
    const d = this.p.derived.find((x) => x.id === id);
    return d ? { field: `derived.${id}`, value: d.value, unit: d.unit } : null;
  }

  /** BSA (Mosteller, from normalize); when absent, asks for height and weight. */
  bsa(why: string): Num | null {
    const b = this.derived("bsaMosteller");
    if (b) return b;
    for (const f of ["demographics.heightCm", "demographics.weightKg"]) {
      const o = this.p.observations[f];
      if (!o || o.status !== "ok") this.need(f, why);
    }
    return null;
  }

  needSex(why: string) { this.need("demographics.biologicalSex", why); }

  /**
   * Grade with a sex-specific function. With unknown sex, returns the grade only when both sexes agree;
   * otherwise asks for the sex and returns null.
   */
  bySex<T>(grade: (s: Sex) => T, why: string): T | null {
    if (this.sex) return grade(this.sex);
    const m = grade("male"), f = grade("female");
    if (JSON.stringify(m) === JSON.stringify(f)) return m;
    this.needSex(why);
    return null;
  }

  // ------------------------------------------------------------ valves
  valveFindings(valve: ValveId, condition?: string) {
    return this.p.valveFindings.filter((v) => v.valve === valve && (!condition || v.condition === condition));
  }

  /** Valve measurement in canonical unit: Vmax m/s, gradients mmHg, area cm². */
  valveNum(valve: ValveId, key: "peakVelocity" | "meanGradient" | "valveArea", prefer: string): Num | null {
    const label = { peakVelocity: "Peak velocity", meanGradient: "Mean gradient", valveArea: "Valve area" }[key];
    const all = this.valveFindings(valve);
    const ordered = [...all.filter((f) => f.condition === prefer), ...all.filter((f) => f.condition !== prefer)];
    for (const f of ordered) {
      const m = f.measurements.find((x) => x.label === label);
      if (!m) continue;
      const field = `valveFindings[${valve} ${f.condition}].${key}`;
      if (m.value === null) { this.need(field, STATUS_WHY.null); return null; }
      const conv = convertValveUnit(key, m.value, m.unit);
      if (conv === null) { this.need(field, m.unit ? STATUS_WHY.unit_unknown : STATUS_WHY.unit_missing); return null; }
      return { field, ...conv };
    }
    return null;
  }

  /** Quantitative Doppler parameter, matched by a closed keyword list on `doppler[].measurement`. */
  doppler(valve: ValveId, kind: DopplerKind): Num | null {
    const list = this.p.record.doppler ?? [];
    for (const d of list) {
      if (d.valve !== valve || !DOPPLER_KEYWORDS[kind].test(d.measurement)) continue;
      const field = `doppler[${valve}].${kind}`;
      if (d.value === null) { this.need(field, STATUS_WHY.null); return null; }
      const conv = convertDopplerUnit(kind, d.value, d.unit);
      if (conv === null) { this.need(field, d.unit ? STATUS_WHY.unit_unknown : STATUS_WHY.unit_missing); return null; }
      return { field, ...conv };
    }
    return null;
  }
}

export type DopplerKind = "peakVelocity" | "meanGradient" | "VC" | "RVol" | "RF" | "EROA";
const DOPPLER_KEYWORDS: Record<DopplerKind, RegExp> = {
  peakVelocity: /peak velocity|\bv ?max\b/i,
  meanGradient: /mean (pressure )?gradient/i,
  VC: /vena contracta/i,
  RVol: /regurgitant volume|\brvol\b/i,
  RF: /regurgitant fraction|\brf\b/i,
  EROA: /\beroa?\b|effective regurgitant orifice/i,
};

const unitKey = (u: string | undefined) => (u ?? "").trim().toLowerCase().replace(/\s+/g, "").replace("²", "2").replace("^2", "2");

function convertValveUnit(key: "peakVelocity" | "meanGradient" | "valveArea", v: number, unit?: string): { value: number; unit: string } | null {
  const u = unitKey(unit);
  if (key === "peakVelocity") return u === "m/s" ? { value: v, unit: "m/s" } : u === "cm/s" ? { value: r(v / 100, 3), unit: "m/s" } : null;
  if (key === "meanGradient") return u === "mmhg" ? { value: v, unit: "mmHg" } : u === "kpa" ? { value: r(v * 7.50062, 1), unit: "mmHg" } : null;
  return u === "cm2" ? { value: v, unit: "cm²" } : u === "mm2" ? { value: r(v / 100, 3), unit: "cm²" } : null;
}

function convertDopplerUnit(kind: DopplerKind, v: number, unit?: string): { value: number; unit: string } | null {
  const u = unitKey(unit);
  switch (kind) {
    case "peakVelocity":
    case "meanGradient": return convertValveUnit(kind, v, unit);
    case "VC": return u === "cm" ? { value: v, unit: "cm" } : u === "mm" ? { value: r(v / 10, 3), unit: "cm" } : null;
    case "RVol": return u === "ml" || u === "ml/beat" ? { value: v, unit: "mL" } : null;
    case "RF": return u === "%" || u === "percent" ? { value: v, unit: "%" } : null;
    case "EROA": return u === "cm2" ? { value: v, unit: "cm²" } : u === "mm2" ? { value: r(v / 100, 3), unit: "cm²" } : null;
  }
}
