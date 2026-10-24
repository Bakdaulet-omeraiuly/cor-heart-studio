import type { FidelityOverall, FidelityRow } from "@/imaging/fidelity";

// Brain asset manifest written by pipeline/cor_pipeline/brain.py (public/brain/<subject>/brain-manifest.json).

export type Hemisphere = "left" | "right" | "midline";
export type BrainGroup = "cortex" | "deep_grey" | "ventricles" | "cerebellum_brainstem" | "white_matter";

export interface BrainStructure {
  /** 1..n: value in labels.u8 and in the meshes' _REGION attribute (0 = none). */
  index: number;
  key: string;
  name: string;
  /** FreeSurfer label numbers merged into this structure. */
  labels: number[];
  hemisphere: Hemisphere;
  group: BrainGroup;
  lobe: string | null;
  /** "manual" (DKT31 cortical protocol) or "automatic (FreeSurfer aseg)". */
  method: string;
  colour: [number, number, number];
  volumeMl: number;
}

export interface BrainManifest {
  assetId: string;
  subject: string;
  modality: string;
  units: "cm";
  bounds: { min: number[]; max: number[] };
  provenance: { cortex: string; subcortical: string; reviewedByClinician: boolean };
  dataset: { name: string; url: string; license: string; source: string };
  files: { low: { url: string; bytes: number } };
  volume: {
    mri: string;
    labels: string;
    /** [ni, nj, nk]; raw byte order is C (i slowest, k fastest). */
    dims: [number, number, number];
    spacingMm: [number, number, number];
    /** Voxel index (i, j, k, 1) -> app frame (cm; +X patient left, +Y superior, +Z anterior). */
    voxelToApp: number[][];
    orientation: string;
  };
  structures: BrainStructure[];
  totals: { brainMl: number; cortexLeftMl: number; cortexRightMl: number };
  /** COR-Fit agreement of each rendered surface with its labels (published LOD). */
  fidelity: {
    method: string;
    lod: string;
    toleranceMm: number;
    structures: (FidelityRow & { index: number; group: string })[];
    overall: FidelityOverall;
    cortex: FidelityOverall;
    deep: FidelityOverall;
  };
  knownLimitations: string[];
}

export type { ViewId } from "@/imaging/sliceGeometry";
