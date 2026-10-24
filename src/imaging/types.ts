// A source-image volume with its segmentation, as shown in the slice views (brain MRI, heart CT).
import type { StoreApi, UseBoundStore } from "zustand";
import type { Vec3 } from "./sliceGeometry";

export interface SliceStructure {
  /** 1..n: value in the label volume (0 = none). */
  index: number;
  name: string;
  colour: number[];
}

export interface SliceVolume {
  /** [ni, nj, nk]; raw byte order C (i slowest, k fastest). */
  dims: [number, number, number];
  spacingMm: [number, number, number];
  /** Voxel (i, j, k, 1) -> app frame (cm; +X patient left, +Y superior, +Z anterior). */
  voxelToApp: number[][];
  image: Uint8Array;
  labels: Uint8Array;
  structures: SliceStructure[];
  /** How 8-bit values map back to physical units (CT: HU). Absent = arbitrary MRI intensity. */
  intensity?: { unit: string; byte0: number; byte255: number };
}

export interface SliceState {
  crosshair: Vec3 | null;
  selected: number;
  hidden: Set<number>;
  overlay: "fill" | "outline" | "off";
  overlayOpacity: number;
  windowCenter: number;
  windowWidth: number;
  set: (patch: Partial<Omit<SliceState, "set">>) => void;
}

export type SliceStore = UseBoundStore<StoreApi<SliceState>>;
