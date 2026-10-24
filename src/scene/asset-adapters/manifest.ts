// Shape of a heart asset manifest (docs/asset-pipeline.md) — the fields the app reads. Written by
// scripts/heart-asset/build.ts (Tier A, procedural) and pipeline/cor_pipeline/asset.py (Tier B, CT).
import type { ValveId } from "@/domain/schema/record";
import type { FidelityOverall, FidelityRow } from "@/imaging/fidelity";

type V3 = number[];
interface Pap { base: V3; tip: V3 }

export interface HeartManifest {
  assetId: string;
  assetVersion: string;
  provenanceTier: string;
  license: string;
  attribution: string;
  /** Heart centre in asset space; the procedural manifest predates the field (see registry). */
  center?: V3;
  files: Record<"high" | "low", { url: string; bytes: number; triangles: number[] }>;
  structureToMesh: Record<string, { absent?: boolean; [key: string]: unknown }>;
  /** Coronary arteries modelled on a template (pipeline/cor_pipeline/coronary.py). */
  coronary?: { vessels: Record<string, { name: string; lengthMm: number | null }>; diameterSource?: string };
  deformation: {
    lv: {
      base: V3; axis: V3; septalDir: V3; anteriorDir: V3;
      cavityBaseAlong: number; cavityApexAlong: number; epiApexAlong: number;
      meanCavityRadius: number; meanWallThickness: number;
    };
    rv: { center: V3; axis: V3; septalDir: V3; wall: number };
    la: { center: V3 };
    ra: { center: V3 };
  };
  valves: Record<ValveId, { center: V3; normal: V3; radius: number; fromImaging?: boolean }>;
  papillary: { anterolateral: Pap; posteromedial: Pap; rvAnterior: Pap };
  anchors: Record<string, V3>;
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
  provenance?: { geometry: string; reviewedByClinician: boolean; motion: string };
  /** Tier B: the source CT (cropped, 8 bit) and its label volume, for the slice views. */
  imaging?: {
    modality: string;
    image: string;
    labels: string;
    dims: number[];
    spacingMm: number[];
    voxelToApp: number[][];
    intensity: { unit: string; byte0: number; byte255: number };
    structures: { index: number; key: string; name: string; colour: number[]; volumeMl: number }[];
  };
  knownLimitations: string[];
  /** Tier B: COR-Fit agreement of the rendered mesh with its source labels, per LOD. */
  fidelity?: {
    method: string;
    lods: Partial<Record<"high" | "low", { toleranceMm: number; overall: FidelityOverall; structures: (FidelityRow & { key: string; name: string; source: string })[] }>>;
    volume: { lvCavityMeshMl: number; lvCavityLabelMl: number; errorPercent: number };
  };
}
