"use client";
import { create } from "zustand";
import type { SliceState } from "./types";

/** A slice-view store (crosshair, selection, overlay, window/level) for one organ module. */
export const createSliceStore = () => create<SliceState>((set) => ({
  crosshair: null,
  selected: 0,
  hidden: new Set(),
  overlay: "fill",
  overlayOpacity: 0.3,
  windowCenter: 128,
  windowWidth: 256,
  set: (patch) => set(patch),
}));
