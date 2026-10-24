import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { mapPatientToVisual } from "@/domain/mapping/mapPatientToVisual";
import { ASSET_BASELINE_PROFILE, PROCEDURAL_ASSET_CAPABILITIES } from "@/domain/references/asset-baseline";
import type { NormalizedPatient } from "@/domain/types";

export const ROOT = resolve(__dirname, "../..");
export const readText = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
export const samplePatients = () => JSON.parse(readText("public/samples/synthetic-patients.json")).patients as Record<string, unknown>[];

export function norm(raw: unknown): NormalizedPatient {
  const r = normalizeRecord(raw);
  if (!r.ok) throw new Error(`normalize failed: ${JSON.stringify(r.issues)}`);
  return r.patient;
}
export const map = (p: NormalizedPatient) => mapPatientToVisual(p, ASSET_BASELINE_PROFILE, PROCEDURAL_ASSET_CAPABILITIES);
export const minimal = (extra: Record<string, unknown> = {}) => ({ patientId: "T-1", studyId: "S-1", ...extra });
export const obs = (value: number | null, unit?: string, more: Record<string, unknown> = {}) => ({ value, unit, source: "test", ...more });
