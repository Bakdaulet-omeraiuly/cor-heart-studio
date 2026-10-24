// Coronary stenosis: reported lesions -> CAD-RADS 2.0 category and the lumen narrowing the renderer draws.
// Pure and deterministic. CAD-RADS 2.0 (Cury et al., JACC Cardiovasc Imaging 2022;15:1974-2001,
// doi:10.1016/j.jcmg.2022.07.002) grades the most severe luminal (diameter) stenosis per patient.

export const CORONARY_VESSELS = ["LM", "LAD", "LCx", "RCA", "PDA"] as const;
export type CoronaryVessel = (typeof CORONARY_VESSELS)[number];
export const CORONARY_SEGMENTS = ["proximal", "mid", "distal"] as const;
export type CoronarySegment = (typeof CORONARY_SEGMENTS)[number];
export const PLAQUE_TYPES = ["noncalcified", "partially_calcified", "calcified"] as const;
export type PlaqueType = (typeof PLAQUE_TYPES)[number];

/** Vessel ids written into the template's `_CORO` attribute (pipeline/cor_pipeline/coronary.py VESSELS). */
export const VESSEL_ID: Record<CoronaryVessel, number> = { LM: 1, LAD: 2, LCx: 3, RCA: 4, PDA: 5 };

export const VESSEL_LABEL: Record<CoronaryVessel, string> = {
  LM: "Left main", LAD: "Left anterior descending", LCx: "Left circumflex", RCA: "Right coronary", PDA: "Posterior descending",
};

/** Every vessel id that can appear in `_CORO.x` (pipeline/cor_pipeline/coronary.py VESSELS), for naming a picked vessel. */
export const DISPLAY_NAME: Record<number, string> = {
  1: "Left main", 2: "Left anterior descending", 3: "Left circumflex", 4: "Right coronary", 5: "Posterior descending",
  6: "Diagonal branch (D1)", 7: "Diagonal branch (D2)", 14: "Diagonal branch (D3)", 15: "Diagonal branch (D4)",
  9: "Obtuse marginal", 10: "Conus branch", 11: "Sinoatrial nodal artery", 12: "Acute marginal", 13: "Posterolateral branch",
  20: "Great cardiac vein", 21: "Middle cardiac vein", 22: "Small cardiac vein", 24: "Coronary sinus",
  25: "Posterior vein of the left ventricle", 26: "Left marginal vein",
};

export interface CoronaryFinding {
  vessel: CoronaryVessel;
  segment?: CoronarySegment;
  /** Diameter stenosis, percent (0-100). */
  stenosisPercent: number;
  plaque?: PlaqueType;
  source?: string;
}

export type CadRadsCategory = "0" | "1" | "2" | "3" | "4A" | "4B" | "5";

/** Per-lesion stenosis grade (CAD-RADS 2.0 stenosis categories 0-5; 4B is a per-patient modifier, below). */
export function stenosisCategory(percent: number): Exclude<CadRadsCategory, "4B"> {
  if (percent <= 0) return "0";
  if (percent < 25) return "1";
  if (percent < 50) return "2";
  if (percent < 70) return "3";
  if (percent < 100) return "4A";
  return "5";
}

export const CAD_RADS_TEXT: Record<CadRadsCategory, string> = {
  "0": "No plaque or stenosis (0%)",
  "1": "Minimal stenosis (1-24%)",
  "2": "Mild stenosis (25-49%)",
  "3": "Moderate stenosis (50-69%)",
  "4A": "Severe stenosis (70-99%) in one or two vessels",
  "4B": "Left main ≥ 50% or three-vessel ≥ 70% disease",
  "5": "Total occlusion (100%)",
};

/** Patient-level CAD-RADS: the most severe lesion, with the 4B rule (left main ≥ 50 %, or ≥ 70 % in LAD, LCx and RCA territories). */
export function cadRads(findings: CoronaryFinding[]): { category: CadRadsCategory; driver: CoronaryFinding | null } {
  if (!findings.length) return { category: "0", driver: null };
  let worst = findings[0];
  for (const f of findings) if (f.stenosisPercent > worst.stenosisPercent) worst = f;
  let category: CadRadsCategory = stenosisCategory(worst.stenosisPercent);
  if (category !== "5") {
    const lm = findings.find((f) => f.vessel === "LM" && f.stenosisPercent >= 50);
    // territories: PDA belongs to the RCA in the right-dominant pattern drawn here
    const territory = (v: CoronaryVessel): string => (v === "PDA" ? "RCA" : v);
    const severe = new Set(findings.filter((f) => f.stenosisPercent >= 70).map((f) => territory(f.vessel)));
    const threeVessel = ["LAD", "LCx", "RCA"].every((t) => severe.has(t));
    if (lm || threeVessel) {
      category = "4B";
      worst = lm ?? worst;
    }
  }
  return { category, driver: worst };
}

/** Lesion position along the vessel (0 = ostium, 1 = distal end): segments are thirds of the modelled vessel. */
export function segmentCentre(vessel: CoronaryVessel, segment?: CoronarySegment): number {
  if (vessel === "LM" || !segment) return 0.5;
  return { proximal: 1 / 6, mid: 0.5, distal: 5 / 6 }[segment];
}

/** Illustrative lesion length (mm): CAD-RADS grades severity, not length, and the record does not give one. */
export const LESION_LENGTH_MM = 10;

export interface LesionVisual {
  vessel: CoronaryVessel;
  vesselId: number;
  segment?: CoronarySegment;
  /** Fraction of the lumen diameter removed at the lesion centre (0..1). */
  narrowing: number;
  tCentre: number;
  tHalfWidth: number;
  plaque: PlaqueType | "unspecified";
  category: Exclude<CadRadsCategory, "4B">;
  changeId: string;
}
