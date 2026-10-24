import { mapPatientToVisual } from "@/domain/mapping/mapPatientToVisual";
import type { PatientVisualState } from "@/domain/mapping/types";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { specForPatient } from "@/scene/asset-adapters/registry";
import type { NormalizedPatient } from "@/domain/types";

export type EntryOrigin = "sample" | "import" | "manual";

export interface PatientEntry {
  key: string;
  patient: NormalizedPatient;
  visual: PatientVisualState;
  /** Heart asset the record is rendered with (registry id): procedural unless it references a CT mesh. */
  assetId: string;
  origin: EntryOrigin;
  addedAt: number;
}

export function entryFromNormalized(patient: NormalizedPatient, origin: EntryOrigin, addedAt: number): PatientEntry {
  const spec = specForPatient(patient);
  return { key: patient.key, patient, visual: mapPatientToVisual(patient, spec.profile, spec.capabilities), assetId: spec.id, origin, addedAt };
}

export function entryFromRaw(raw: unknown, origin: EntryOrigin, addedAt: number): PatientEntry | { error: string } {
  const r = normalizeRecord(raw);
  if (!r.ok) return { error: r.issues.map((i) => `${i.path || "record"}: ${i.message}`).join("\n") };
  return entryFromNormalized(r.patient, origin, addedAt);
}

export function patientTitle(p: NormalizedPatient) {
  return p.displayName ?? p.patientId;
}
