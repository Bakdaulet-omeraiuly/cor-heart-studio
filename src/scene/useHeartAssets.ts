"use client";
import { useEffect, useState } from "react";
import { loadHeartAsset, type HeartAsset } from "./asset-adapters/heartAsset";

export interface AssetState {
  low: HeartAsset | null;
  high: HeartAsset | null;
  error: string | null;
  loadedMs: number | null;
}

/** Progressive loading: the low LOD renders first; the high LOD replaces it when ready (if the tier allows). */
export function useHeartAssets(wantHigh: boolean): AssetState {
  const [state, setState] = useState<AssetState>({ low: null, high: null, error: null, loadedMs: null });
  useEffect(() => {
    let alive = true;
    const t0 = performance.now();
    loadHeartAsset("low")
      .then((low) => {
        if (!alive) return;
        setState((s) => ({ ...s, low, loadedMs: Math.round(performance.now() - t0) }));
        if (wantHigh) return loadHeartAsset("high").then((high) => { if (alive) setState((s) => ({ ...s, high })); });
      })
      .catch((e: Error) => alive && setState((s) => ({ ...s, error: e.message })));
    return () => { alive = false; };
  }, [wantHigh]);
  return state;
}
