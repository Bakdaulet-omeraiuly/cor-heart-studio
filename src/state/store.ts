"use client";
// Session-only application state. Patient data never touches URLs, analytics, console or persistent storage.
import { create } from "zustand";
import type { StructureId } from "@/domain/mapping/types";
import { entryFromNormalized, type PatientEntry } from "@/lib/patients";
import { getDefaultTemplate, setDefaultTemplate, type TemplateId } from "@/scene/asset-adapters/registry";

export type DisplayMode = "natural" | "clinical";
export type CutAxis = "coronal" | "sagittal" | "short_axis" | "four_chamber";
export type Quality = "auto" | "high" | "low";
export type InspectorTab = "observations" | "changes" | "evidence" | "warnings";
export type CameraPreset = "anterior" | "posterior" | "left_lateral" | "right_lateral" | "superior" | "inferior" | "four_chamber" | "short_axis" | "mitral_closeup" | "aortic_closeup";

export interface Layers {
  outer: boolean;
  chambers: boolean;
  vessels: boolean;
  coronary: boolean;
  valves: boolean;
  labels: boolean;
  highlights: boolean;
  flow: boolean;
}

export type Module = "heart" | "brain";

export interface AppState {
  /** Organ module shown in the workspace. */
  module: Module;
  /** Heart module: right-hand inspector panel shown (collapse to widen the 3D view). */
  inspectorOpen: boolean;
  /** Inspector width in px (drag its left edge). */
  inspectorWidth: number;
  entries: Record<string, PatientEntry>;
  order: string[];
  selectedKey: string | null;
  compareKeys: string[];
  workspace: "single" | "compare";
  // scene
  mode: DisplayMode;
  layers: Layers;
  hidden: Partial<Record<StructureId, boolean>>;
  isolate: StructureId | null;
  cutaway: { enabled: boolean; axis: CutAxis; offset: number };
  xray: boolean;
  quality: Quality;
  cameraRequest: { preset: CameraPreset; nonce: number } | null;
  // playback
  playing: boolean;
  slowMotion: number;
  scrubPhase: number;
  syncMode: "phase" | "realtime";
  // inspection
  selectedStructure: StructureId | null;
  selectedSegment: number | null;
  hoverStructure: StructureId | null;
  focusChangeId: string | null;
  inspectorTab: InspectorTab;
  theme: "dark" | "light";
  dialog: null | { kind: "import" } | { kind: "editor"; key: string | null };
  sharedScale: boolean;
  /** Anatomy template for records without their own mesh. */
  template: TemplateId;

  setTemplate: (id: TemplateId) => void;
  upsertEntries: (entries: PatientEntry[]) => void;
  removeEntry: (key: string) => void;
  select: (key: string | null) => void;
  toggleCompare: (key: string) => void;
  set: (patch: Partial<AppState>) => void;
  setLayer: (k: keyof Layers, v: boolean) => void;
  requestCamera: (preset: CameraPreset) => void;
  selectStructure: (s: StructureId | null, segment?: number | null) => void;
}

export const useApp = create<AppState>((set, get) => ({
  module: "heart",
  inspectorOpen: true,
  inspectorWidth: 360,
  entries: {},
  order: [],
  selectedKey: null,
  compareKeys: [],
  workspace: "single",
  mode: "natural",
  layers: { outer: true, chambers: true, vessels: true, coronary: true, valves: true, labels: false, highlights: true, flow: false },
  hidden: {},
  isolate: null,
  cutaway: { enabled: false, axis: "four_chamber", offset: 0 },
  xray: false,
  quality: "auto",
  cameraRequest: null,
  playing: true,
  slowMotion: 1,
  scrubPhase: 0,
  syncMode: "phase",
  selectedStructure: null,
  selectedSegment: null,
  hoverStructure: null,
  focusChangeId: null,
  inspectorTab: "observations",
  theme: "dark",
  dialog: null,
  sharedScale: false,
  template: getDefaultTemplate(),

  setTemplate: (id) => {
    setDefaultTemplate(id);
    // records drawn on a template are re-mapped onto the new one (their own CT meshes are kept)
    set((s) => ({
      template: id,
      entries: Object.fromEntries(Object.entries(s.entries).map(([k, e]) => [k, entryFromNormalized(e.patient, e.origin, e.addedAt)])),
      selectedStructure: null, selectedSegment: null,
    }));
  },
  upsertEntries: (list) => set((s) => {
    const entries = { ...s.entries };
    const order = [...s.order];
    for (const e of list) {
      if (!entries[e.key]) order.push(e.key);
      entries[e.key] = e;
    }
    return { entries, order, selectedKey: s.selectedKey && entries[s.selectedKey] ? s.selectedKey : list[0]?.key ?? s.selectedKey };
  }),
  removeEntry: (key) => set((s) => {
    const entries = { ...s.entries };
    delete entries[key];
    const order = s.order.filter((k) => k !== key);
    return { entries, order, selectedKey: s.selectedKey === key ? order[0] ?? null : s.selectedKey, compareKeys: s.compareKeys.filter((k) => k !== key) };
  }),
  select: (key) => set({ selectedKey: key, selectedStructure: null, selectedSegment: null, focusChangeId: null }),
  toggleCompare: (key) => {
    const cur = get().compareKeys;
    if (cur.includes(key)) set({ compareKeys: cur.filter((k) => k !== key) });
    else if (cur.length < 4) set({ compareKeys: [...cur, key] });
  },
  set: (patch) => set(patch),
  setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
  requestCamera: (preset) => set({ cameraRequest: { preset, nonce: Date.now() } }),
  selectStructure: (s, segment = null) => set({ selectedStructure: s, selectedSegment: segment, inspectorTab: s ? "changes" : get().inspectorTab }),
}));

// Development-only handle for local debugging and automated browser tests (never in production builds).
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __cor?: typeof useApp }).__cor = useApp;
}
