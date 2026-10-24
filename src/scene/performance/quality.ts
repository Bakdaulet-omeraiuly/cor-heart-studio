// Device tiering. Targets are documented in docs/verification.md; nothing here claims measured performance.
import type { Quality } from "@/state/store";

export interface Tier {
  name: "high" | "low";
  lod: "high" | "low";
  dpr: [number, number];
  shadows: boolean;
  maxCompareViews: number;
}

export function detectTier(pref: Quality): Tier {
  const high: Tier = { name: "high", lod: "high", dpr: [1, 2], shadows: true, maxCompareViews: 4 };
  const low: Tier = { name: "low", lod: "low", dpr: [1, 1.25], shadows: false, maxCompareViews: 2 };
  if (pref === "high") return high;
  if (pref === "low") return low;
  if (typeof navigator === "undefined") return low;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 4;
  const small = typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 700;
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  return mem >= 6 && cores >= 6 && !small && !coarse ? high : low;
}

let webglCache: boolean | null = null;
/** Probed once per page: creating a context on every call would exhaust the browser's context budget. */
export function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  if (webglCache !== null) return webglCache;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    webglCache = !!gl;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    webglCache = false;
  }
  return webglCache;
}
