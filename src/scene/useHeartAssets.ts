"use client";
import { useEffect, useState } from "react";
import { loadHeartAsset, type HeartAsset } from "./asset-adapters/heartAsset";
import type { HeartAssetSpec } from "./asset-adapters/registry";

export interface AssetState {
  low: HeartAsset | null;
  high: HeartAsset | null;
  error: string | null;
  loadedMs: number | null;
}

const EMPTY: AssetState = { low: null, high: null, error: null, loadedMs: null };

/** Progressive loading: the low LOD renders first; the high LOD replaces it when ready (if the tier allows). */
export function useHeartAssets(spec: HeartAssetSpec, wantHigh: boolean): AssetState {
  const [state, setState] = useState<AssetState & { specId: string }>({ ...EMPTY, specId: spec.id });
  useEffect(() => {
    let alive = true;
    const t0 = performance.now();
    loadHeartAsset(spec, "low")
      .then((low) => {
        if (!alive) return;
        setState({ ...EMPTY, specId: spec.id, low, loadedMs: Math.round(performance.now() - t0) });
        if (wantHigh) return loadHeartAsset(spec, "high").then((high) => { if (alive) setState((s) => ({ ...s, high })); });
      })
      .catch((e: Error) => alive && setState({ ...EMPTY, specId: spec.id, error: e.message }));
    return () => { alive = false; };
  }, [spec, wantHigh]);
  // never hand out another asset's meshes while the new one loads
  return state.specId === spec.id ? state : EMPTY;
}

/** Low LOD for several specs at once (comparison view). Keyed by spec id. */
export function useLowAssets(specs: HeartAssetSpec[]): { assets: Record<string, HeartAsset>; error: string | null } {
  const [state, setState] = useState<{ assets: Record<string, HeartAsset>; error: string | null }>({ assets: {}, error: null });
  const ids = [...new Set(specs.map((s) => s.id))].sort().join("|");
  useEffect(() => {
    let alive = true;
    const unique = [...new Map(specs.map((s) => [s.id, s])).values()];
    Promise.all(unique.map((s) => loadHeartAsset(s, "low")))
      .then((list) => alive && setState({ assets: Object.fromEntries(list.map((a) => [a.specId, a])), error: null }))
      .catch((e: Error) => alive && setState({ assets: {}, error: e.message }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the set of ids, not array identity
  }, [ids]);
  return state;
}
