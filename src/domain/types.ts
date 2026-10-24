import type { CoronaryFinding } from "./coronary";
import type { FieldCategory, RenderingEligibility } from "./schema/fields";
import type { PatientRecord, Severity, ValveId, WallMotion } from "./schema/record";

export type EvidenceClass =
  | "reported_measurement"
  | "reported_assessment"
  | "derived"
  | "illustrative_inference"
  | "default_unknown";

export const EVIDENCE_LABEL: Record<EvidenceClass, string> = {
  reported_measurement: "Reported measurement",
  reported_assessment: "Reported assessment",
  derived: "Derived",
  illustrative_inference: "Illustrative inference",
  default_unknown: "Default / unknown",
};

export type IssueSeverity = "error" | "warning" | "info";
export interface Issue {
  severity: IssueSeverity;
  code: string;
  path: string;
  message: string;
  suggestion?: string;
}

export type ObservationStatus =
  | "ok"
  | "null"
  | "unit_missing"
  | "unit_unknown"
  | "impossible"
  | "context_mismatch"
  | "contradiction";

export interface NormalizedObservation {
  path: string;
  label: string;
  short: string;
  category: FieldCategory;
  rendering: RenderingEligibility;
  original: { value: unknown; unit?: string };
  value: number | null; // canonical unit; null when unknown or unusable
  unit: string;
  status: ObservationStatus;
  statusMessage?: string;
  source?: string;
  observedAt?: string;
  method?: string;
  phase?: string;
  location?: string;
  axis?: string;
  indexed?: boolean;
  note?: string;
  evidence: "reported_measurement";
}

export interface DerivedValue {
  id: string;
  label: string;
  value: number;
  unit: string;
  formula: string;
  inputs: string[];
  evidence: "derived";
  note?: string;
}

export interface NormalizedValveFinding {
  valve: ValveId;
  condition: string;
  severity: Severity | null;
  source?: string;
  method?: string;
  observedAt?: string;
  measurements: { label: string; value: number | null; unit?: string; status: ObservationStatus }[];
  note?: string;
  evidence: "reported_assessment";
}

export interface NormalizedWallMotion {
  segment: number;
  motion: WallMotion;
  source?: string;
  evidence: "reported_assessment";
}

export interface NormalizedWallThickness {
  region: number | string;
  segments: number[];
  valueMm: number | null;
  original: { value: number | null; unit?: string };
  status: ObservationStatus;
  phase?: string;
  method?: string;
  source?: string;
  evidence: "reported_measurement";
}

export interface NormalizedPatient {
  key: string; // `${patientId}::${studyId}`
  patientId: string;
  studyId: string;
  displayName?: string;
  synthetic: boolean;
  studyDate?: string;
  original: unknown; // exactly as submitted
  record: PatientRecord; // schema-validated (aliases expanded)
  observations: Record<string, NormalizedObservation>;
  derived: DerivedValue[];
  valveFindings: NormalizedValveFinding[];
  coronaryFindings: CoronaryFinding[];
  wallMotion: NormalizedWallMotion[];
  wallThickness: NormalizedWallThickness[];
  issues: Issue[];
  unrecognizedFields: string[];
}

export const recordKey = (patientId: string, studyId: string) => `${patientId}::${studyId}`;
