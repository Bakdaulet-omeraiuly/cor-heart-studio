// Diagnosis engine entry point: patient record -> Assessment. Pure, deterministic, no network, no LLM.
// Spec: .kiro/specs/diagnosis-engine/. Sources and thresholds: docs/research/diagnosis-engine.md.
import { normalizeRecord } from "../normalization/normalize";
import { assessChambers } from "./chambers";
import { Ctx } from "./context";
import { assessLv } from "./lv";
import type { Assess, Assessment } from "./types";
import { assessValves } from "./valves";

export const DISCLAIMER =
  "Not a diagnosis. Clinical decision support for clinicians on synthetic/demo data; every statement cites the rule and guideline it comes from. Not a medical device.";

export const assess: Assess = (record): Assessment => {
  const n = normalizeRecord(record);
  if (!n.ok) {
    return { findings: [], differential: [], missing: [{ field: "record", why: "the record does not pass schema validation, so nothing can be assessed" }],
      redFlags: [], disclaimer: DISCLAIMER };
  }
  const c = new Ctx(n.patient);
  // phase 1 — fixed order
  assessValves(c);
  assessLv(c, true);
  assessChambers(c);
  return { findings: c.findings, differential: c.differential, missing: c.missing, redFlags: c.redFlags, disclaimer: DISCLAIMER };
};
