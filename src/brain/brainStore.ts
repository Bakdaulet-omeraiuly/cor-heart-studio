"use client";
// Brain module view state (session-only, like the heart store).
import { create } from "zustand";
import type { Vec3 } from "@/imaging/sliceGeometry";

export interface BrainState {
  /** Crosshair in voxel indices (shared by the three slice views and the 3D marker). */
  crosshair: Vec3 | null;
  selected: number; // structure index, 0 = none
  hover: number;
  hidden: Set<number>;
  cortexOpacity: number; // 0..1
  showPlanes: boolean;
  /** Turn the 3D camera toward a structure (set when it is chosen from the list). */
  focusRequest: { index: number; nonce: number } | null;
  overlay: "fill" | "outline" | "off";
  overlayOpacity: number;
  windowCenter: number;
  windowWidth: number;
  set: (patch: Partial<Omit<BrainState, "set" | "toggleHidden">>) => void;
  toggleHidden: (index: number) => void;
}

export const useBrain = create<BrainState>((set) => ({
  crosshair: null,
  selected: 0,
  hover: 0,
  hidden: new Set(),
  cortexOpacity: 1,
  showPlanes: true,
  focusRequest: null,
  overlay: "fill",
  overlayOpacity: 0.35,
  windowCenter: 128,
  windowWidth: 256,
  set: (patch) => set(patch),
  toggleHidden: (index) => set((s) => {
    const hidden = new Set(s.hidden);
    if (hidden.has(index)) hidden.delete(index); else hidden.add(index);
    return { hidden };
  }),
}));
