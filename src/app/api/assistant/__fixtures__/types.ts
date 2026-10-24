// TEMPORARY — replaced by `src/domain/diagnosis/types.ts` (@HyorinmaruK, H3).
// Hand-copied from the shared interface agreed in `docs/tasks/kerimku1.md`. This file
// and `./assess` exist only until the real engine and its types land; at that point
// `engine.ts` switches its two re-export lines to the real module and this copy is deleted.
// Keep these shapes byte-for-byte identical to the agreed types so the switch is import-only.
import type { PatientRecord } from "@/domain/schema/record";

export interface Evidence {
  field: string; // record field, e.g. "valves.aortic.peakVelocity"
  value: number | string;
  unit?: string;
  rule: string; // "R-VALVE-STEN-01" or a new rule id
  source: string; // guideline + DOI
}

export interface Finding {
  condition: string; // "aortic-stenosis"
  label: string; // "Aortic stenosis, severe"
  grade?: string; // "severe"
  basis: "rule-defined" | "supported" | "possible";
  evidence: Evidence[];
  organ: "heart" | "brain";
  target?: string; // 3D structure id (valve, coronary segment, brain region)
}

export interface Assessment {
  findings: Finding[]; // rule-defined
  differential: Finding[]; // plausible alternative explanations
  missing: { field: string; why: string }[];
  redFlags: string[];
  disclaimer: string;
}

export type Assess = (record: PatientRecord) => Assessment; // pure, offline, deterministic
