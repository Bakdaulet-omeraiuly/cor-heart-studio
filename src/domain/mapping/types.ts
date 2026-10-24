import type { CadRadsCategory, CoronaryVessel, LesionVisual } from "../coronary";
import type { Severity, ValveId } from "../schema/record";
import type { EvidenceClass, Issue } from "../types";
import type { CyclePhases } from "./cycle";

export const MAPPING_VERSION = "1.0.0";

export const STRUCTURE_IDS = [
  "lv", "rv", "la", "ra", "myocardium", "aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins",
  "mitral_valve", "aortic_valve", "tricuspid_valve", "pulmonary_valve", "coronary_vessels",
] as const;
export type StructureId = (typeof STRUCTURE_IDS)[number];

export const STRUCTURE_LABEL: Record<StructureId, string> = {
  lv: "Left ventricle", rv: "Right ventricle", la: "Left atrium", ra: "Right atrium", myocardium: "Myocardium",
  aorta: "Aorta", pulmonary_artery: "Pulmonary artery", vena_cava: "Venae cavae", pulmonary_veins: "Pulmonary veins",
  mitral_valve: "Mitral valve", aortic_valve: "Aortic valve", tricuspid_valve: "Tricuspid valve",
  pulmonary_valve: "Pulmonary valve", coronary_vessels: "Coronary vessels",
};

export type Nature = "quantitative" | "qualitative" | "illustrative";

export interface SourceRef {
  path: string;
  originalValue: unknown;
  originalUnit?: string;
  normalizedValue?: number | string | null;
  normalizedUnit?: string;
}

export interface VisualChange {
  id: string;
  ruleId: string;
  ruleVersion: string;
  target: StructureId;
  segments?: number[];
  property: string;
  summary: string; // what the viewer sees, in plain words
  sources: SourceRef[];
  evidence: EvidenceClass;
  nature: Nature;
  formula?: string;
  displayAdjustment?: string; // clamping / exaggeration for display
  limitations: string[];
  conflicts: string[];
}

export interface ChamberParams {
  /** Static end-diastolic scale of the endocardial surface relative to the asset baseline. */
  edRadial: number;
  edLong: number;
  /** Static epicardial radial scale (keeps wall thickness unless thickness is supplied). */
  edRadialEpi: number;
  /** End-systolic scale relative to end-diastole. */
  esRadialEndo: number;
  esRadialEpi: number;
  esLong: number;
}
export interface LvParams extends ChamberParams {
  twistRad: number;
}
export interface AtriumParams {
  edScale: number;
  /** Fractional linear size swing over the cycle (illustrative). */
  swing: number;
}

export interface ValveVisual {
  maxOpening: number; // 0..1 fraction of the illustrative full opening
  stenosis: Severity | null;
  regurgitation: Severity | null;
  prolapse: boolean;
  reported: boolean;
}

export type SegmentStatus = "measured" | "interpolated" | "reported" | "default";

export interface Highlight {
  structure: StructureId;
  segments?: number[];
  label: string;
  changeId?: string;
  kind: "geometry" | "finding" | "flow_cue";
}

export interface UnsupportedFinding {
  path: string;
  label: string;
  reason: string;
}

export interface UnknownItem {
  structure: StructureId;
  property: string;
  message: string;
}

export type StructureStatus = "measured_driven" | "assessment_driven" | "derived" | "default_unknown" | "display_only";

export interface PatientVisualState {
  mappingVersion: string;
  assetId: string;
  assetVersion: string;
  referenceProfileId: string;
  patientKey: string;
  inputHash: string;
  timing: {
    heartRateBpm: number;
    evidence: EvidenceClass;
    sourcePath?: string;
    phases: CyclePhases;
  };
  lv: LvParams;
  rv: ChamberParams;
  la: AtriumParams;
  ra: AtriumParams;
  segments: {
    motion: number[]; // index 0..16 -> AHA segment 1..17; 1 = baseline motion
    thicknessDeltaCm: number[];
    status: SegmentStatus[];
  };
  valves: Record<ValveId, ValveVisual>;
  highlights: Highlight[];
  changes: VisualChange[];
  issues: Issue[];
  unsupported: UnsupportedFinding[];
  unknowns: UnknownItem[];
  structureStatus: Record<StructureId, { status: StructureStatus; changeIds: string[] }>;
  coronary: { cadRads: CadRadsCategory | null; driver: string | null; lesions: LesionVisual[] };
  /** Rendered LV cavity volume targets in the asset frame (mL) — used by verification tests. */
  lvTargets: { edvMl: number; esvMl: number; edvEvidence: EvidenceClass; esvEvidence: EvidenceClass };
}

export interface ReferenceProfile {
  id: string;
  description: string;
  /** Baseline of the anatomical asset (not a clinical reference range). */
  baseline: {
    lvEndDiastolicVolumeMl: number;
    lvEpicardialVolumeMl: number;
    lvEndDiastolicDiameterMm: number;
    ivsThicknessMm: number;
    lvPosteriorWallThicknessMm: number;
    laVolumeMl: number;
    rvBasalDiameterMm: number;
    raMinorDimensionMm: number;
  };
  /** Asset geometry needed to keep wall thickness when the cavity is scaled. */
  geometry: { lvMeanCavityRadiusCm: number; lvMeanWallCm: number };
  defaults: {
    heartRateBpm: number;
    lvEjectionFractionPercent: number;
    rvEjectionFractionPercent: number;
  };
  /** Geometry safety bounds (display only; never rewrite clinical values). */
  bounds: {
    lvRadial: [number, number];
    lvLong: [number, number];
    rvRadial: [number, number];
    atrialScale: [number, number];
    wallDeltaCm: [number, number];
  };
  /** Clinical classification thresholds. Intentionally empty: none implemented without sourced guidelines. */
  classificationThresholds: null;
}

export interface AssetCapabilities {
  assetId: string;
  assetVersion: string;
  structures: StructureId[];
  segmentalLv: boolean;
  wallThickness: boolean;
  chamberScaling: StructureId[];
  valveLeaflets: ValveId[];
  regurgitationCue: boolean;
  tissueOverlay: boolean;
  /** Coronary arteries that can draw a lumen narrowing (template `_CORO` attribute), with modelled lengths. */
  coronaryStenosis: Partial<Record<CoronaryVessel, { lengthMm: number }>> | null;
}
