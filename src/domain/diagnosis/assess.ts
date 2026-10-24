// Diagnosis engine entry point: patient record -> Assessment. Pure, deterministic, no network, no LLM.
// H3 stub: returns no findings yet so the assistant chat can integrate against the real signature.
import type { Assess, Assessment } from "./types";

export const DISCLAIMER =
  "Not a diagnosis. Clinical decision support for clinicians on synthetic/demo data; every statement cites the rule and guideline it comes from. Not a medical device.";

export const assess: Assess = (): Assessment => ({
  findings: [],
  differential: [],
  missing: [],
  redFlags: [],
  disclaimer: DISCLAIMER,
});
