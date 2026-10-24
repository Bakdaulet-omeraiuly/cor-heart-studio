import proceduralManifest from "@/scene/asset-adapters/procedural-heart-v1.manifest.json";
import type { HeartManifest } from "@/scene/asset-adapters/manifest";
import { STRUCTURE_IDS, type AssetCapabilities, type ReferenceProfile, type StructureId } from "../mapping/types";

/**
 * Reference profile = the anatomical asset's own baseline + illustrative defaults.
 * These are NOT normal ranges. No clinical classification thresholds are implemented
 * (see docs/data-to-visual-mapping.md, "Clinical thresholds").
 * Each asset (procedural or CT-derived) is its own baseline: the mapping scales from its rest pose.
 */
export function profileFromManifest(manifest: HeartManifest, id: string, description: string): ReferenceProfile {
  return {
    id,
    description,
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
}

/** What an asset can show: every structure its manifest does not mark absent. */
export function capabilitiesFromManifest(manifest: HeartManifest): AssetCapabilities {
  const absent = (id: StructureId) => manifest.structureToMesh[id]?.absent === true;
  return {
    assetId: manifest.assetId,
    assetVersion: manifest.assetVersion,
    structures: STRUCTURE_IDS.filter((id) => !absent(id)),
    segmentalLv: true,
    wallThickness: true,
    chamberScaling: ["lv", "rv", "la", "ra"],
    valveLeaflets: ["mitral_valve", "aortic_valve", "tricuspid_valve", "pulmonary_valve"],
    regurgitationCue: true,
    tissueOverlay: true,
    coronaryStenosis: manifest.coronary
      ? Object.fromEntries(Object.values(manifest.coronary.vessels).filter((v) => v.lengthMm).map((v) => [v.name, { lengthMm: v.lengthMm! }]))
      : null,
  };
}

const manifest: HeartManifest = proceduralManifest;

export const ASSET_BASELINE_PROFILE = profileFromManifest(manifest, "asset-baseline-v1",
  "Rest pose of the procedural COR heart asset v1; defaults are illustrative placeholders for absent data.");

export const PROCEDURAL_ASSET_CAPABILITIES = capabilitiesFromManifest(manifest);
