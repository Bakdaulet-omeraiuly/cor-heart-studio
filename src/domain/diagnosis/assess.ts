// Diagnosis engine entry point: patient record -> Assessment. Pure, deterministic, no network, no LLM.
// Spec: .kiro/specs/diagnosis-engine/. Sources and thresholds: docs/research/diagnosis-engine.md.
import { normalizeRecord } from "../normalization/normalize";
import { assessBrain, hasBrainData } from "./brain";
import { assessChambers } from "./chambers";
import { Ctx } from "./context";
import { assessCoronary } from "./coronary";
import { assessDifferential } from "./differential";
import { assessEcg } from "./ecg";
import { assessLv } from "./lv";
import { assessManagement, evaluateCatalogue } from "./management";
import type { PatientRecord } from "../schema/record";
import type { Assess, Assessment } from "./types";
import { assessValves } from "./valves";

export const DISCLAIMER =
  "Not a diagnosis. Clinical decision support for clinicians on synthetic/demo data; every statement cites the rule and guideline it comes from. Not a medical device.";

function hasHeartData(c: Ctx): boolean {
  const r = c.p.record;
  return Object.values(c.p.observations).some((o) => o.category !== "demographics" && o.category !== "brain_imaging") || !!r.valveFindings?.length || !!r.coronaryFindings?.length ||
    !!r.ecg || !!r.echo || !!r.doppler?.length;
}

function run(record: PatientRecord, review: boolean): Assessment {
  const n = normalizeRecord(record);
  if (!n.ok) {
    return { findings: [], differential: [], missing: [{ field: "record", why: "the record does not pass schema validation, so nothing can be assessed" }],
      redFlags: [], disclaimer: DISCLAIMER, options: [] };
  }
  const c = new Ctx(n.patient);
  const heart = hasHeartData(c) || !hasBrainData(c);
  // phase 1 — fixed order
  assessValves(c);
  assessLv(c, heart);
  assessChambers(c);
  assessCoronary(c);
  assessEcg(c);
  assessBrain(c);
  // phase 2
  assessDifferential(c);
  // phase 3 — guideline management options (verified catalogue entries only)
  const options = review ? evaluateCatalogue(c, { includeUnverified: true }).options : assessManagement(c);
  return { findings: c.findings, differential: c.differential, missing: c.missing, redFlags: c.redFlags, disclaimer: DISCLAIMER, options };
}

export const assess: Assess = (record) => run(record, false);

/**
 * Review mode for tests and guideline reviewers ONLY: also returns options whose catalogue entry is not verified yet.
 * Never used by the app or the chat.
 */
export const assessIncludingUnverifiedOptions = (record: PatientRecord): Assessment => run(record, true);
