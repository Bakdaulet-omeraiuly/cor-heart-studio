// Field registry: the single source of truth for scalar observations.
// Drives normalization, CSV mapping, the inspector, and docs/medical-data-dictionary.md.
// Bounds below are *physical impossibility* guards for data entry, never clinical reference ranges.

export type FieldCategory =
  | "vitals"
  | "demographics"
  | "ecg"
  | "echo_dimensions"
  | "echo_function"
  | "hemodynamics"
  | "brain_imaging";

export type RenderingEligibility = "drives_timing" | "drives_geometry" | "display_only";
export type ContextKey = "phase" | "method" | "axis" | "location";

export interface UnitConversion {
  factor: number;
  offset?: number; // canonical = value * factor + offset
}

export interface FieldDef {
  /** Dotted path inside a patient record, e.g. "observations.heartRate". */
  path: string;
  label: string;
  short: string;
  category: FieldCategory;
  canonicalUnit: string;
  /** Accepted unit spellings -> conversion into the canonical unit. Matching is case-insensitive. */
  units: Record<string, UnitConversion>;
  impossible: { min?: number; max?: number; exclusiveMin?: boolean };
  csvColumn?: string;
  rendering: RenderingEligibility;
  /** Context that must be present before the value may drive geometry. */
  contextRequired?: ContextKey[];
  description: string;
}

const same = { factor: 1 };
const mmUnits = { mm: same, cm: { factor: 10 } };
const mlUnits = { ml: same, "cm3": same, "cm^3": same, l: { factor: 1000 } };
const pctUnits = { "%": same, percent: same };
const msUnits = { ms: same, s: { factor: 1000 } };
const ratePerYearUnits = { "%/year": same, "%/y": same, "%/yr": same, "%/a": same, "%peryear": same, "percent/year": same };

export const FIELDS: FieldDef[] = [
  // ---- vital signs
  { path: "observations.heartRate", label: "Heart rate", short: "HR", category: "vitals", canonicalUnit: "bpm",
    units: { bpm: same, "beats/min": same, "/min": same, "min-1": same }, impossible: { min: 0, exclusiveMin: true, max: 400 },
    csvColumn: "heart_rate_bpm", rendering: "drives_timing", description: "Resting heart rate. Sets the real-time cardiac cycle frequency." },
  { path: "observations.systolicBP", label: "Systolic blood pressure", short: "SBP", category: "vitals", canonicalUnit: "mmHg",
    units: { mmhg: same, kpa: { factor: 7.50062 } }, impossible: { min: 0, exclusiveMin: true, max: 400 },
    csvColumn: "systolic_bp_mmhg", rendering: "display_only", description: "Displayed only. Blood pressure does not change geometry." },
  { path: "observations.diastolicBP", label: "Diastolic blood pressure", short: "DBP", category: "vitals", canonicalUnit: "mmHg",
    units: { mmhg: same, kpa: { factor: 7.50062 } }, impossible: { min: 0, max: 300 },
    csvColumn: "diastolic_bp_mmhg", rendering: "display_only", description: "Displayed only." },
  { path: "observations.spo2", label: "Oxygen saturation", short: "SpO₂", category: "vitals", canonicalUnit: "%",
    units: pctUnits, impossible: { min: 0, max: 100 }, csvColumn: "spo2_percent", rendering: "display_only",
    description: "Displayed only. Never changes blood or tissue colour." },
  { path: "observations.respiratoryRate", label: "Respiratory rate", short: "RR", category: "vitals", canonicalUnit: "breaths/min",
    units: { "breaths/min": same, "/min": same, "min-1": same, bpm: same }, impossible: { min: 0, max: 200 },
    csvColumn: "respiratory_rate_per_min", rendering: "display_only", description: "Displayed only." },
  { path: "observations.bodyTemperature", label: "Body temperature", short: "Temp", category: "vitals", canonicalUnit: "°C",
    units: { "°c": same, c: same, celsius: same, "°f": { factor: 5 / 9, offset: -32 * 5 / 9 }, f: { factor: 5 / 9, offset: -32 * 5 / 9 } },
    impossible: { min: 10, max: 50 }, csvColumn: "body_temperature_c", rendering: "display_only", description: "Displayed only." },

  // ---- demographics (context only)
  { path: "demographics.heightCm", label: "Height", short: "Height", category: "demographics", canonicalUnit: "cm",
    units: { cm: same, m: { factor: 100 }, in: { factor: 2.54 } }, impossible: { min: 20, max: 280 },
    csvColumn: "height_cm", rendering: "display_only", description: "Context; used only for derived body surface area." },
  { path: "demographics.weightKg", label: "Weight", short: "Weight", category: "demographics", canonicalUnit: "kg",
    units: { kg: same, lb: { factor: 0.453592 }, g: { factor: 0.001 } }, impossible: { min: 0.2, max: 700 },
    csvColumn: "weight_kg", rendering: "display_only", description: "Context; used only for derived body surface area." },

  // ---- ECG intervals
  { path: "ecg.heartRate", label: "ECG heart rate", short: "ECG HR", category: "ecg", canonicalUnit: "bpm",
    units: { bpm: same, "/min": same }, impossible: { min: 0, exclusiveMin: true, max: 400 }, csvColumn: "ecg_heart_rate_bpm",
    rendering: "display_only", description: "Acquisition-specific rate. Used for timing only if no vital-sign heart rate exists (labelled)." },
  { path: "ecg.prInterval", label: "PR interval", short: "PR", category: "ecg", canonicalUnit: "ms", units: msUnits,
    impossible: { min: 0, max: 1000 }, csvColumn: "ecg_pr_ms", rendering: "display_only", description: "Displayed only." },
  { path: "ecg.qrsDuration", label: "QRS duration", short: "QRS", category: "ecg", canonicalUnit: "ms", units: msUnits,
    impossible: { min: 0, max: 600 }, csvColumn: "ecg_qrs_ms", rendering: "display_only", description: "Displayed only; does not create an activation map." },
  { path: "ecg.qtInterval", label: "QT interval", short: "QT", category: "ecg", canonicalUnit: "ms", units: msUnits,
    impossible: { min: 0, max: 1500 }, csvColumn: "ecg_qt_ms", rendering: "display_only", description: "Displayed only." },
  { path: "ecg.qtc", label: "QTc", short: "QTc", category: "ecg", canonicalUnit: "ms", units: msUnits,
    impossible: { min: 0, max: 1500 }, csvColumn: "ecg_qtc_ms", rendering: "display_only",
    description: "Displayed with its correction method when supplied (e.g. Bazett, Fridericia)." },

  // ---- echo dimensions
  { path: "observations.lvEndDiastolicDiameter", label: "LV end-diastolic diameter", short: "LVEDD", category: "echo_dimensions",
    canonicalUnit: "mm", units: mmUnits, impossible: { min: 0, exclusiveMin: true, max: 150 }, csvColumn: "lv_edd_mm",
    rendering: "drives_geometry", description: "Scales the LV cavity in the short-axis plane relative to the asset baseline." },
  { path: "observations.lvEndSystolicDiameter", label: "LV end-systolic diameter", short: "LVESD", category: "echo_dimensions",
    canonicalUnit: "mm", units: mmUnits, impossible: { min: 0, exclusiveMin: true, max: 150 }, csvColumn: "lv_esd_mm",
    rendering: "display_only", description: "Displayed; used for a consistency check against LVEDD." },
  { path: "observations.lvEndDiastolicVolume", label: "LV end-diastolic volume", short: "LVEDV", category: "echo_dimensions",
    canonicalUnit: "mL", units: mlUnits, impossible: { min: 0, exclusiveMin: true, max: 1500 }, csvColumn: "lv_edv_ml",
    rendering: "drives_geometry", description: "Targets the rendered LV cavity volume at end-diastole." },
  { path: "observations.lvEndSystolicVolume", label: "LV end-systolic volume", short: "LVESV", category: "echo_dimensions",
    canonicalUnit: "mL", units: mlUnits, impossible: { min: 0, max: 1500 }, csvColumn: "lv_esv_ml",
    rendering: "drives_geometry", description: "Targets the rendered LV cavity volume at end-systole." },
  { path: "observations.laVolume", label: "Left atrial volume", short: "LAV", category: "echo_dimensions",
    canonicalUnit: "mL", units: mlUnits, impossible: { min: 0, exclusiveMin: true, max: 1000 }, csvColumn: "la_volume_ml",
    rendering: "drives_geometry", description: "Scales the LA (cube-root of the volume ratio, shape illustrative)." },
  { path: "observations.rvBasalDiameter", label: "RV basal diameter", short: "RVD1", category: "echo_dimensions",
    canonicalUnit: "mm", units: mmUnits, impossible: { min: 0, exclusiveMin: true, max: 150 }, csvColumn: "rv_basal_diameter_mm",
    rendering: "drives_geometry", description: "Scales the RV in the short-axis direction." },
  { path: "observations.raMinorDimension", label: "RA minor-axis dimension", short: "RA minor", category: "echo_dimensions",
    canonicalUnit: "mm", units: mmUnits, impossible: { min: 0, exclusiveMin: true, max: 150 }, csvColumn: "ra_minor_mm",
    rendering: "drives_geometry", description: "Scales the RA (shape illustrative)." },
  { path: "observations.ivsThickness", label: "Interventricular septum thickness (diastole)", short: "IVSd", category: "echo_dimensions",
    canonicalUnit: "mm", units: mmUnits, impossible: { min: 0, exclusiveMin: true, max: 80 }, csvColumn: "ivs_d_mm",
    rendering: "drives_geometry", description: "Thickens or thins the septal LV segments only." },
  { path: "observations.lvPosteriorWallThickness", label: "LV posterior wall thickness (diastole)", short: "LVPWd", category: "echo_dimensions",
    canonicalUnit: "mm", units: mmUnits, impossible: { min: 0, exclusiveMin: true, max: 80 }, csvColumn: "lvpw_d_mm",
    rendering: "drives_geometry", description: "Thickens or thins the inferolateral (posterior) LV segments only." },

  // ---- echo function
  { path: "observations.lvEjectionFraction", label: "LV ejection fraction", short: "LVEF", category: "echo_function",
    canonicalUnit: "%", units: pctUnits, impossible: { min: 0, max: 100 }, csvColumn: "lv_ef_percent",
    rendering: "drives_geometry", description: "Sets the LV cavity volume excursion between end-diastole and end-systole." },
  { path: "observations.rvEjectionFraction", label: "RV ejection fraction", short: "RVEF", category: "echo_function",
    canonicalUnit: "%", units: pctUnits, impossible: { min: 0, max: 100 }, csvColumn: "rv_ef_percent",
    rendering: "drives_geometry", description: "Sets the RV volume excursion." },
  { path: "observations.tapse", label: "TAPSE", short: "TAPSE", category: "echo_function", canonicalUnit: "mm", units: mmUnits,
    impossible: { min: 0, max: 80 }, csvColumn: "tapse_mm", rendering: "display_only", description: "Displayed; RV function context." },
  { path: "observations.strokeVolume", label: "Stroke volume", short: "SV", category: "echo_function", canonicalUnit: "mL",
    units: mlUnits, impossible: { min: 0, max: 1000 }, csvColumn: "stroke_volume_ml", rendering: "display_only", description: "Displayed." },
  { path: "observations.cardiacOutput", label: "Cardiac output", short: "CO", category: "echo_function", canonicalUnit: "L/min",
    units: { "l/min": same, "ml/min": { factor: 0.001 } }, impossible: { min: 0, max: 60 }, csvColumn: "cardiac_output_l_min",
    rendering: "display_only", description: "Displayed." },
  { path: "observations.globalLongitudinalStrain", label: "Global longitudinal strain", short: "GLS", category: "echo_function",
    canonicalUnit: "%", units: pctUnits, impossible: { min: -60, max: 60 }, csvColumn: "gls_percent", rendering: "display_only",
    description: "Displayed next to a labelled qualitative cue; never expanded into a strain field." },

  // ---- hemodynamics
  { path: "observations.pasp", label: "Pulmonary artery systolic pressure (estimated)", short: "PASP", category: "hemodynamics",
    canonicalUnit: "mmHg", units: { mmhg: same }, impossible: { min: 0, max: 250 }, csvColumn: "pasp_mmhg", rendering: "display_only",
    description: "Displayed with method and location." },

  // ---- brain MRI (serial volumetry; signed annual change, negative = loss)
  { path: "observations.hippocampalVolumeChangePerYear", label: "Hippocampal volume change per year", short: "Hippo Δ/y", category: "brain_imaging",
    canonicalUnit: "%/year", units: ratePerYearUnits, impossible: { min: -100, max: 200 }, rendering: "display_only",
    description: "Annualised change between two MRI scans (negative = atrophy). Compared with cohort ranges by the diagnosis engine; never an individual forecast." },
  { path: "observations.ventricularVolumeChangePerYear", label: "Ventricular volume change per year", short: "Vent Δ/y", category: "brain_imaging",
    canonicalUnit: "%/year", units: ratePerYearUnits, impossible: { min: -100, max: 200 }, rendering: "display_only",
    description: "Annualised lateral-ventricle volume change between two scans (positive = expansion). Compared with cohort means by the diagnosis engine." },
];

export const FIELD_BY_PATH = new Map(FIELDS.map((f) => [f.path, f]));
export const FIELD_BY_CSV = new Map(FIELDS.filter((f) => f.csvColumn).map((f) => [f.csvColumn!, f]));

export function convertUnit(field: FieldDef, value: number, unit: string | undefined): { value: number; ok: true } | { ok: false; reason: "missing" | "unknown" } {
  if (!unit || !unit.trim()) return { ok: false, reason: "missing" };
  const key = unit.trim().toLowerCase().replace(/\s+/g, "");
  const conv = field.units[key] ?? Object.entries(field.units).find(([u]) => u.replace(/\s+/g, "") === key)?.[1];
  if (!conv) return { ok: false, reason: "unknown" };
  return { ok: true, value: value * conv.factor + (conv.offset ?? 0) };
}
