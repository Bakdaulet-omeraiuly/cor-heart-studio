import manifest from "@/scene/asset-adapters/procedural-heart-v1.manifest.json";
import type { AssetCapabilities, ReferenceProfile } from "../mapping/types";

/**
 * Reference profile = the anatomical asset's own baseline + illustrative defaults.
 * These are NOT normal ranges. No clinical classification thresholds are implemented
 * (see docs/data-to-visual-mapping.md, "Clinical thresholds").
 */
export const ASSET_BASELINE_PROFILE: ReferenceProfile = {
  id: "asset-baseline-v1",
  description: "Rest pose of the procedural COR heart asset v1; defaults are illustrative placeholders for absent data.",
  baseline: {
    lvEndDiastolicVolumeMl: manifest.baseline.lvEndDiastolicVolumeMl,
    lvEpicardialVolumeMl: manifest.baseline.lvEpicardialVolumeMl,
    lvEndDiastolicDiameterMm: manifest.baseline.lvEndDiastolicDiameterMm,
    ivsThicknessMm: manifest.baseline.ivsThicknessMm,
    lvPosteriorWallThicknessMm: manifest.baseline.lvPosteriorWallThicknessMm,
    laVolumeMl: manifest.baseline.laVolumeMl,
    rvBasalDiameterMm: manifest.baseline.rvBasalDiameterMm,
    raMinorDimensionMm: manifest.baseline.raMinorDimensionMm,
  },
  geometry: { lvMeanCavityRadiusCm: manifest.deformation.lv.meanCavityRadius, lvMeanWallCm: manifest.deformation.lv.meanWallThickness },
  defaults: { heartRateBpm: 70, lvEjectionFractionPercent: 55, rvEjectionFractionPercent: 50 },
  bounds: {
    lvRadial: [0.7, 1.6],
    lvLong: [0.8, 1.35],
    rvRadial: [0.7, 1.8],
    atrialScale: [0.75, 1.9],
    wallDeltaCm: [-0.6, 1.6],
  },
  classificationThresholds: null,
};

export const PROCEDURAL_ASSET_CAPABILITIES: AssetCapabilities = {
  assetId: manifest.assetId,
  assetVersion: manifest.assetVersion,
  structures: ["lv", "rv", "la", "ra", "myocardium", "aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins",
    "mitral_valve", "aortic_valve", "tricuspid_valve", "pulmonary_valve", "coronary_vessels"],
  segmentalLv: true,
  wallThickness: true,
  chamberScaling: ["lv", "rv", "la", "ra"],
  valveLeaflets: ["mitral_valve", "aortic_valve", "tricuspid_valve", "pulmonary_valve"],
  regurgitationCue: true,
  tissueOverlay: true,
};
