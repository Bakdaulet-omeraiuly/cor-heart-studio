// Guideline management options (Requirement 13, docs/research/diagnosis-engine.md §9).
// Clinician decision support only: each entry paraphrases a guideline recommendation and carries the guideline's own
// COR/LOE. Only entries whose COR and LOE were confirmed from the recommendation table (verified: true) are ever
// emitted. No doses, no drug chosen for the patient, no ranking beyond COR. Pure and deterministic.
import type { Ctx } from "./context";
import { RULES, type RuleId } from "./rules";
import { SRC } from "./sources";
import type { Evidence, ManagementOption } from "./types";

export type SymptomStatus = "symptomatic" | "asymptomatic" | "unknown";
type Applies = { evidence: Evidence[] } | { missing: { field: string; why: string }[] } | null;

export interface CatalogueEntry {
  id: RuleId;
  findingCondition: string;
  /** Finding grades the entry applies to (matched against Finding.grade). */
  grades: string[];
  label: string;
  cor: ManagementOption["cor"];
  loe: string;
  source: string;
  /** True only when COR and LOE were confirmed from the guideline's recommendation table (see verifiedBy). */
  verified: boolean;
  verifiedBy: string;
  outlookInterventionId?: string;
  applies(c: Ctx): Applies;
}

// ------------------------------------------------------------------ record readers
const CARDINAL = ["syncope", "angina", "dyspnoea", "heart_failure"] as const;
const CARDINAL_RE: Record<(typeof CARDINAL)[number], RegExp> = {
  syncope: /syncope|faint/i,
  angina: /angina|chest pain|chest tightness|chest pressure/i,
  dyspnoea: /dyspn|breathless|shortness of breath|orthopn/i,
  heart_failure: /oedema|edema|orthopn|paroxysmal nocturnal|heart failure/i,
};

function symptomEntries(c: Ctx) {
  return [...(c.p.record.symptoms ?? []), ...(c.p.record.symptomDetails ?? [])];
}

/** Symptomatic if a cardinal symptom is present; asymptomatic only if the record says so explicitly. */
export function symptomStatus(c: Ctx): { status: SymptomStatus; evidence: Evidence[] } {
  const present = CARDINAL.filter((k) => c.symptoms.has(k));
  if (present.length) return { status: "symptomatic", evidence: present.map((k) => evidenceFor(c, "symptoms", k.replace("_", " "))) };
  const entries = symptomEntries(c);
  const saysAsymptomatic = entries.some((s) => s.present !== false && /^\s*asymptomatic\b/i.test(s.symptom));
  const allDenied = CARDINAL.every((k) => entries.some((s) => s.present === false && CARDINAL_RE[k].test(s.symptom)));
  if (saysAsymptomatic || allDenied) return { status: "asymptomatic", evidence: [evidenceFor(c, "symptoms", "asymptomatic")] };
  return { status: "unknown", evidence: [] };
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4 };
/** NYHA class from structured symptoms (closed keyword match), or null when not stated. */
export function nyhaClass(c: Ctx): number | null {
  for (const s of symptomEntries(c)) {
    if (s.present === false) continue;
    const m = /\bNYHA\s*(?:class\s*)?(iv|i{1,3}|[1-4])\b/i.exec(s.symptom);
    if (m) return ROMAN[m[1].toLowerCase()] ?? Number(m[1]);
  }
  return null;
}

// evidence helpers: tagged with the option's own rule id once the option is built
const evidenceFor = (c: Ctx, field: string, value: number | string, unit?: string): Evidence => c.ev("R-DX-MGMT-READ", field, value, unit);

function findingOf(c: Ctx, condition: string, grades: string[]) {
  return c.findings.find((f) => f.condition === condition && (grades.length === 0 || grades.includes(f.grade ?? "")));
}

const SYMPTOMS_WHY = "symptom status (symptomatic or explicitly asymptomatic) decides which guideline recommendation applies";
const NYHA_WHY = "the recommendation applies to NYHA class II–III; the record does not state the NYHA class";

function needSymptomatic(c: Ctx, ev: Evidence[]): Applies {
  const s = symptomStatus(c);
  if (s.status === "unknown") return { missing: [{ field: "symptoms", why: SYMPTOMS_WHY }] };
  return s.status === "symptomatic" ? { evidence: [...ev, ...s.evidence] } : null;
}
function needAsymptomatic(c: Ctx, ev: Evidence[]): Applies {
  const s = symptomStatus(c);
  if (s.status === "unknown") return { missing: [{ field: "symptoms", why: SYMPTOMS_WHY }] };
  return s.status === "asymptomatic" ? { evidence: [...ev, ...s.evidence] } : null;
}
const efEvidence = (c: Ctx) => (c.facts.lvef ? [c.facts.lvef.evidence] : []);

const HF = `${SRC.AHA22}`;
const VHD = `${SRC.ACC20}`;

// ------------------------------------------------------------------ catalogue (order = output order)
export const CATALOGUE: CatalogueEntry[] = [
  {
    id: "R-DX-MGMT-HF-ARNI", findingCondition: "lv-ef-category", grades: ["reduced"],
    label: "ARNi (angiotensin receptor–neprilysin inhibitor) to reduce morbidity and mortality in HFrEF",
    cor: "1", loe: "A", source: `${HF} — §7.3.1 RAS inhibition, recommendation for ARNi in HFrEF with NYHA II–III`,
    verified: true,
    verifiedBy: "ACC Key Perspectives (COR 1, LOE A) and the 2022 recommendation table reproduced by Guideline Central; research §9",
    applies: (c) => {
      const n = nyhaClass(c);
      if (n === null) return { missing: [{ field: "symptoms.nyhaClass", why: NYHA_WHY }] };
      return n === 2 || n === 3 ? { evidence: [...efEvidence(c), evidenceFor(c, "symptoms.nyhaClass", n === 2 ? "II" : "III")] } : null;
    },
  },
  {
    id: "R-DX-MGMT-HF-SGLT2I-REF", findingCondition: "lv-ef-category", grades: ["reduced"],
    label: "SGLT2 inhibitor to reduce HF hospitalization and cardiovascular mortality in symptomatic HFrEF",
    cor: "1", loe: "A", source: `${HF} — §7.3.4 SGLT2i`, verified: false, verifiedBy: "text confirmed; COR/LOE not seen in a table",
    outlookInterventionId: "sglt2_inhibitor", applies: (c) => needSymptomatic(c, efEvidence(c)),
  },
  {
    id: "R-DX-MGMT-HF-SGLT2I-MREF", findingCondition: "lv-ef-category", grades: ["mildly reduced"],
    label: "SGLT2 inhibitor can be beneficial in HFmrEF", cor: "2a", loe: "B-R", source: `${HF} — §7.7 HFmrEF`,
    verified: false, verifiedBy: "COR confirmed (AHA top things to know); LOE not", outlookInterventionId: "sglt2_inhibitor",
    applies: (c) => needSymptomatic(c, efEvidence(c)),
  },
  {
    id: "R-DX-MGMT-HF-GDMT-MREF", findingCondition: "lv-ef-category", grades: ["mildly reduced"],
    label: "Evidence-based beta blockers, ARNi, ACEi or ARB, and MRA may be considered in HFmrEF", cor: "2b", loe: "B-NR",
    source: `${HF} — §7.7 HFmrEF`, verified: false, verifiedBy: "COR confirmed; LOE not", applies: (c) => needSymptomatic(c, efEvidence(c)),
  },
  {
    id: "R-DX-MGMT-HF-SGLT2I-PEF", findingCondition: "lv-ef-category", grades: ["preserved"],
    label: "SGLT2 inhibitor can be beneficial in HFpEF", cor: "2a", loe: "B-R", source: `${HF} — §7.8 HFpEF`,
    verified: false, verifiedBy: "COR confirmed; LOE not", outlookInterventionId: "sglt2_inhibitor",
    applies: (c) => needSymptomatic(c, efEvidence(c)),
  },
  {
    id: "R-DX-MGMT-AS-AVR-D1", findingCondition: "aortic-stenosis", grades: ["severe"],
    label: "Aortic valve replacement (surgical or transcatheter, decided by the heart valve team) for symptomatic severe high-gradient AS",
    cor: "1", loe: "A", source: `${VHD} — §3.2.3 timing of intervention, stage D1`, verified: false, verifiedBy: "COR 1 confirmed (secondary); LOE not",
    applies: (c) => (c.facts.as?.gradientSevere ? needSymptomatic(c, c.facts.as.evidence) : null),
  },
  {
    id: "R-DX-MGMT-AS-AVR-C2", findingCondition: "aortic-stenosis", grades: ["severe"],
    label: "Aortic valve replacement for asymptomatic severe AS with LVEF below the guideline limit", cor: "1", loe: "B-NR",
    source: `${VHD} — §3.2.3 timing of intervention, stage C2`, verified: false, verifiedBy: "COR 1 confirmed (ACC guideline comparison); LOE not",
    applies: (c) => {
      if (!c.facts.as) return null;
      if (!c.facts.lvef) return { missing: [{ field: "observations.lvEjectionFraction", why: "LVEF below the limit makes AVR indicated in asymptomatic severe AS" }] };
      return c.facts.lvef.value < 50 ? needAsymptomatic(c, [...c.facts.as.evidence, c.facts.lvef.evidence]) : null;
    },
  },
  {
    id: "R-DX-MGMT-AR-AVR-D", findingCondition: "aortic-regurgitation", grades: ["severe"],
    label: "Aortic valve surgery for symptomatic severe AR", cor: "1", loe: "B-NR", source: `${VHD} — §4.3.3 AR intervention, stage D`,
    verified: false, verifiedBy: "only 2014 wording found", applies: (c) => needSymptomatic(c, c.facts.regurg.aortic_valve?.evidence ?? []),
  },
  {
    id: "R-DX-MGMT-AR-AVR-C2", findingCondition: "aortic-regurgitation", grades: ["severe"],
    label: "Aortic valve surgery for asymptomatic severe AR with LVEF at or below the guideline limit", cor: "1", loe: "B-NR",
    source: `${VHD} — §4.3.3 AR intervention, stage C2`, verified: false, verifiedBy: "LVEF limit confirmed (ACC what changed); COR/LOE not",
    applies: (c) => {
      if (!c.facts.lvef) return { missing: [{ field: "observations.lvEjectionFraction", why: "LVEF decides whether surgery is indicated in asymptomatic severe AR" }] };
      return c.facts.lvef.value <= 55 ? needAsymptomatic(c, [...(c.facts.regurg.aortic_valve?.evidence ?? []), c.facts.lvef.evidence]) : null;
    },
  },
  {
    id: "R-DX-MGMT-MR-SURG-D", findingCondition: "mitral-regurgitation", grades: ["severe"],
    label: "Mitral valve intervention for symptomatic severe primary MR", cor: "1", loe: "B-NR", source: `${VHD} — §7.3.3 primary MR intervention`,
    verified: false, verifiedBy: "not confirmed",
    applies: (c) => (c.facts.mitralProlapse ? needSymptomatic(c, [...(c.facts.regurg.mitral_valve?.evidence ?? []), c.facts.mitralProlapse]) : null),
  },
  {
    id: "R-DX-MGMT-CCD-STATIN", findingCondition: "coronary-stenosis", grades: ["1", "2", "3", "4A", "4B", "5"],
    label: "High-intensity statin therapy in chronic coronary disease", cor: "1", loe: "A", source: `${SRC.CCD23} — lipid management`,
    verified: false, verifiedBy: "not confirmed", outlookInterventionId: "statin",
    applies: (c) => (c.facts.cad ? { evidence: c.facts.cad.evidence } : null),
  },
];

const retag = (e: Evidence, entry: CatalogueEntry): Evidence => ({ ...e, rule: entry.id, source: entry.source });

/** Evaluates catalogue entries. `includeUnverified` exists for tests and reviewers only; assess() never sets it. */
export function evaluateCatalogue(c: Ctx, opts: { includeUnverified?: boolean } = {}) {
  const options: ManagementOption[] = [];
  const missing: { field: string; why: string }[] = [];
  for (const entry of CATALOGUE) {
    if (!entry.verified && !opts.includeUnverified) continue;
    if (!findingOf(c, entry.findingCondition, entry.grades)) continue;
    const r = entry.applies(c);
    if (!r) continue;
    if ("missing" in r) { missing.push(...r.missing); continue; }
    const o: ManagementOption = { findingCondition: entry.findingCondition, label: entry.label, cor: entry.cor, loe: entry.loe,
      appliesBecause: r.evidence.map((e) => retag(e, entry)), source: entry.source };
    if (entry.outlookInterventionId) o.outlookInterventionId = entry.outlookInterventionId;
    options.push(o);
  }
  return { options, missing };
}

/** Phase 3: verified options only; missing facts of verified entries go to missing[]. */
export function assessManagement(c: Ctx): ManagementOption[] {
  const { options, missing } = evaluateCatalogue(c);
  for (const m of missing) c.need(m.field, m.why);
  return options;
}

// every catalogue id must be a registered rule (checked at module load, fails fast in tests)
for (const e of CATALOGUE) if (!RULES[e.id]) throw new Error(`unregistered rule ${e.id}`);
