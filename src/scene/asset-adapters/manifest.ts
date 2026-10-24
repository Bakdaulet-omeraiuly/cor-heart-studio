// Shape of a heart asset manifest (docs/asset-pipeline.md) — the fields the app reads. Written by
// scripts/heart-asset/build.ts (Tier A, procedural) and pipeline/cor_pipeline/asset.py (Tier B, CT).
import type { ValveId } from "@/domain/schema/record";

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
  knownLimitations: string[];
}
