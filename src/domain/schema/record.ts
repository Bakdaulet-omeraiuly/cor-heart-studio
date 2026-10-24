// Executable runtime schema for patient-study records (schemaVersion 1.x).
// Unknown values are absent or null — never zero. Every namespace below is optional.
import { CORONARY_SEGMENTS, CORONARY_VESSELS, PLAQUE_TYPES } from "../coronary";
import { z } from "zod";

export const SCHEMA_VERSION = "1.0.0";
export const SUPPORTED_SCHEMA_MAJOR = 1;

const str = z.string().trim().min(1);
const optStr = z.string().optional();
const dateish = z.string().optional(); // ISO 8601 date or date-time recommended; preserved as supplied

export const ObservationSchema = z.object({
  value: z.number().finite().nullable(),
  unit: optStr,
  source: optStr,
  observedAt: dateish,
  method: optStr,
  phase: optStr,
  location: optStr,
  axis: optStr,
  indexed: z.boolean().optional(),
  note: optStr,
});
export type Observation = z.infer<typeof ObservationSchema>;

/** Convenience: a bare number is accepted and treated as an observation without a unit. */
const ObservationInput = z.union([ObservationSchema, z.number().finite().transform((value) => ({ value }))]);

const normEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : v), z.enum(values));

export const VALVE_IDS = ["mitral_valve", "aortic_valve", "tricuspid_valve", "pulmonary_valve"] as const;
export type ValveId = (typeof VALVE_IDS)[number];
export const SEVERITIES = ["none", "trace", "mild", "mild_to_moderate", "moderate", "moderate_to_severe", "severe", "unspecified"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const VALVE_CONDITIONS = ["stenosis", "regurgitation", "prolapse", "calcification", "prosthetic", "other"] as const;
export const WALL_MOTION = ["normal", "hypokinetic", "akinetic", "dyskinetic", "aneurysmal", "unspecified"] as const;
export type WallMotion = (typeof WALL_MOTION)[number];

const valveAlias = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, string> = { mitral: "mitral_valve", mv: "mitral_valve", aortic: "aortic_valve", av: "aortic_valve",
    tricuspid: "tricuspid_valve", tv: "tricuspid_valve", pulmonary: "pulmonary_valve", pulmonic: "pulmonary_valve", pv: "pulmonary_valve" };
  return map[s] ?? s;
}, z.enum(VALVE_IDS));

export const ValveFindingSchema = z.object({
  valve: valveAlias,
  condition: normEnum(VALVE_CONDITIONS),
  severity: normEnum(SEVERITIES).optional(),
  valveArea: ObservationInput.optional(),
  peakGradient: ObservationInput.optional(),
  meanGradient: ObservationInput.optional(),
  peakVelocity: ObservationInput.optional(),
  source: optStr,
  method: optStr,
  observedAt: dateish,
  note: optStr,
});

const coronaryVessel = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const k = v.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const map: Record<string, string> = { lm: "LM", leftmain: "LM", lmca: "LM", lad: "LAD", leftanteriordescending: "LAD",
    lcx: "LCx", cx: "LCx", circumflex: "LCx", leftcircumflex: "LCx", rca: "RCA", rightcoronary: "RCA", rightcoronaryartery: "RCA",
    pda: "PDA", posteriordescending: "PDA" };
  return map[k] ?? v;
}, z.enum(CORONARY_VESSELS));

export const CoronaryFindingSchema = z.object({
  vessel: coronaryVessel,
  segment: normEnum(CORONARY_SEGMENTS).optional(),
  stenosisPercent: z.number().min(0).max(100),
  plaque: normEnum(PLAQUE_TYPES).optional(),
  source: optStr,
  method: optStr,
  note: optStr,
});

const DiagnosisObject = z.object({ text: str, source: optStr, code: optStr, system: optStr, kind: z.enum(["primary", "secondary"]).optional(), severity: optStr });
export const DiagnosisSchema = z.union([DiagnosisObject, str.transform((text): z.infer<typeof DiagnosisObject> => ({ text }))]);

const SymptomObject = z.object({ symptom: str, present: z.boolean().optional(), onset: optStr, duration: optStr, description: optStr, source: optStr });
const SymptomSchema = z.union([SymptomObject, str.transform((symptom): z.infer<typeof SymptomObject> => ({ symptom }))]);

const MedicationObject = z.object({ name: str, dose: optStr, frequency: optStr, route: optStr, since: optStr, source: optStr });
const MedicationSchema = z.union([MedicationObject, str.transform((name): z.infer<typeof MedicationObject> => ({ name }))]);

const WaveformSchema = z.object({
  leads: z.array(z.string()).min(1),
  samplingFrequencyHz: z.number().positive(),
  amplitudeUnit: z.string().min(1),
  calibration: optStr,
  startTime: optStr,
  samples: z.array(z.array(z.number().nullable())).optional(), // samples[leadIndex][i]; null = missing sample
  attachmentRef: optStr,
  format: optStr,
});

export const EcgSchema = z.object({
  rhythm: optStr,
  heartRate: ObservationInput.optional(),
  prInterval: ObservationInput.optional(),
  qrsDuration: ObservationInput.optional(),
  qtInterval: ObservationInput.optional(),
  qtc: ObservationInput.optional(),
  qtcCorrectionMethod: optStr,
  stChanges: z.array(z.object({ leads: z.array(z.string()).optional(), description: str, magnitude: ObservationInput.optional() })).optional(),
  tWaveAbnormalities: z.array(z.object({ leads: z.array(z.string()).optional(), description: str })).optional(),
  arrhythmias: z.array(z.string()).optional(),
  source: optStr,
  observedAt: dateish,
  waveforms: z.array(WaveformSchema).optional(),
});

export const WallMotionFindingSchema = z.object({
  segment: z.number().int().min(1).max(17),
  convention: z.literal("AHA17").default("AHA17"),
  motion: normEnum(WALL_MOTION),
  source: optStr,
  method: optStr,
  observedAt: dateish,
});

export const WallThicknessSchema = z.object({
  region: z.union([z.number().int().min(1).max(17), z.enum(["septum", "posterior", "anterior", "lateral", "inferior", "apex"])]),
  value: z.number().finite().nullable(),
  unit: optStr,
  phase: optStr,
  method: optStr,
  source: optStr,
  observedAt: dateish,
});

export const EchoSchema = z.object({
  regionalWallMotion: z.array(WallMotionFindingSchema).optional(),
  wallThickness: z.array(WallThicknessSchema).optional(),
  diastolicFunction: z.object({ grade: optStr, description: optStr, source: optStr }).optional(),
  rvFunction: z.object({ metric: optStr, value: z.number().nullable().optional(), unit: optStr, assessment: optStr, source: optStr }).optional(),
  source: optStr,
  observedAt: dateish,
});

const DopplerSchema = z.object({
  measurement: str, // e.g. "peak velocity", "E/A ratio", "mean gradient"
  value: z.number().finite().nullable(),
  unit: optStr,
  valve: valveAlias.optional(),
  sampleLocation: optStr,
  referenceDirection: optStr,
  phase: optStr,
  method: optStr,
  jet: z.object({ direction: optStr, width: ObservationInput.optional(), description: optStr }).optional(),
  source: optStr,
  observedAt: dateish,
});

const LabSchema = z.object({
  analyte: str,
  value: z.number().finite().nullable(),
  unit: optStr,
  assay: optStr,
  referenceInterval: z.object({ low: z.number().optional(), high: z.number().optional(), unit: optStr, source: optStr }).optional(),
  collectedAt: dateish,
  source: optStr,
  note: optStr,
});

const ImagingFindingSchema = z.object({
  modality: z.string().min(1), // CT, MRI, CCTA, echo ...
  category: z.enum(["chamber_geometry", "myocardial_thickness", "ventricular_volume", "coronary_anatomy", "tissue_characterization", "fibrosis_scar", "congenital", "other"]).default("other"),
  finding: str,
  location: optStr,
  segment: z.number().int().min(1).max(17).optional(),
  value: z.number().nullable().optional(),
  unit: optStr,
  source: optStr,
  observedAt: dateish,
});

const ImagingAssetSchema = z.object({
  kind: z.enum(["dicom_series", "segmentation_mask", "mesh"]),
  reference: str, // opaque identifier; never a credentialed URL
  format: optStr,
  deidentified: z.boolean().optional(),
  units: optStr,
  orientation: optStr,
  structureLabels: z.array(z.string()).optional(),
  license: optStr,
});

const InvestigationSchema = z.object({
  type: z.enum(["holter", "exercise_stress_test", "coronary_ct_angiography", "coronary_angiography", "catheterization", "other"]),
  summary: str,
  date: dateish,
  findings: z.array(z.string()).optional(),
  pressures: z.array(z.object({ location: str, value: z.number().nullable(), unit: optStr, phase: optStr, method: optStr, observedAt: dateish })).optional(),
  source: optStr,
});

const ConclusionSchema = z.object({
  primaryDiagnoses: z.array(z.string()).optional(),
  secondaryDiagnoses: z.array(z.string()).optional(),
  severity: optStr,
  structuralFindings: z.array(z.string()).optional(),
  functionalFindings: z.array(z.string()).optional(),
  interpretation: optStr,
  recommendedFollowUp: optStr,
  author: optStr,
  date: dateish,
});

export const ObservationsSchema = z.record(z.string(), ObservationInput);

export const PatientRecordSchema = z.object({
  patientId: str,
  studyId: str,
  displayName: optStr,
  synthetic: z.boolean().optional(),
  studyDate: dateish,
  diagnoses: z.array(DiagnosisSchema).optional(),
  observations: ObservationsSchema.optional(),
  valveFindings: z.array(ValveFindingSchema).optional(),
  coronaryFindings: z.array(CoronaryFindingSchema).optional(),
  symptoms: z.array(SymptomSchema).optional(),
  clinicianNotes: optStr,
  demographics: z.object({
    age: z.object({ value: z.number().nullable(), unit: z.enum(["years", "months", "days"]).default("years"), referenceDate: dateish }).optional(),
    biologicalSex: optStr,
    heightCm: ObservationInput.optional(),
    weightKg: ObservationInput.optional(),
  }).optional(),
  history: z.object({ medical: z.array(z.string()).optional(), familyCardiac: z.array(z.string()).optional() }).optional(),
  medications: z.array(MedicationSchema).optional(),
  symptomDetails: z.array(SymptomSchema).optional(),
  ecg: EcgSchema.optional(),
  echo: EchoSchema.optional(),
  doppler: z.array(DopplerSchema).optional(),
  labs: z.array(LabSchema).optional(),
  imaging: z.object({ findings: z.array(ImagingFindingSchema).optional(), assets: z.array(ImagingAssetSchema).optional() }).optional(),
  additionalInvestigations: z.array(InvestigationSchema).optional(),
  clinicalConclusion: ConclusionSchema.optional(),
}).loose();
export type PatientRecord = z.infer<typeof PatientRecordSchema>;
export type PatientRecordInput = z.input<typeof PatientRecordSchema>;

export const EnvelopeSchema = z.object({
  schemaVersion: z.string(),
  patients: z.array(z.unknown()),
});

export const KNOWN_TOP_LEVEL_KEYS = new Set(Object.keys(PatientRecordSchema.shape));

/** JSON Schema publication (generated from the runtime schema). */
export function patientJsonSchema() {
  return z.toJSONSchema(z.object({ schemaVersion: z.string(), patients: z.array(PatientRecordSchema) }), { io: "input", unrepresentable: "any" });
}
