"use client";
// Source-CT evidence for Tier B hearts: the cropped CT and its segmentation (from the asset manifest).
import { useEffect, useState } from "react";
import { createSliceStore } from "@/imaging/createSliceStore";
import { fetchVolumeBytes } from "@/imaging/loadVolume";
import type { SliceVolume } from "@/imaging/types";
import type { HeartAssetSpec } from "./asset-adapters/registry";

/** Crosshair / overlay state of the heart's CT slice views (shared with the 3D marker). */
export const useCtSlices = createSliceStore();

const cache = new Map<string, Promise<SliceVolume>>();

export function loadCtVolume(spec: HeartAssetSpec): Promise<SliceVolume> | null {
  const im = spec.manifest.imaging;
  if (!im) return null;
  let p = cache.get(spec.id);
  if (!p) {
    const n = im.dims.reduce((a, b) => a * b, 1);
    p = Promise.all([fetchVolumeBytes(im.image, n), fetchVolumeBytes(im.labels, n)]).then(([image, labels]) => ({
      dims: im.dims as [number, number, number],
      spacingMm: im.spacingMm as [number, number, number],
      voxelToApp: im.voxelToApp,
      image,
      labels,
      structures: im.structures,
      intensity: im.intensity,
    }));
    p.catch(() => cache.delete(spec.id));
    cache.set(spec.id, p);
  }
  return p;
}

export function useCtVolume(spec: HeartAssetSpec) {
  const [state, setState] = useState<{ id: string; vol: SliceVolume | null; error: string | null }>({ id: spec.id, vol: null, error: null });
  useEffect(() => {
    let alive = true;
    useCtSlices.getState().set({ crosshair: null, selected: 0 });
    const p = loadCtVolume(spec);
    p?.then((vol) => alive && setState({ id: spec.id, vol, error: null })).catch((e: Error) => alive && setState({ id: spec.id, vol: null, error: e.message }));
    return () => { alive = false; };
  }, [spec]);
  return state.id === spec.id ? state : { id: spec.id, vol: null, error: null };
}
