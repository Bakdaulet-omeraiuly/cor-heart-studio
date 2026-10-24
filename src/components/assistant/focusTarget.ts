// Cited id → 3D view (Requirements 11.1, 11.2, 11.3).
//
// `planFocus(ref)` is pure: it reads the ref's `organ` and `target` and decides which store actions to run.
// `focusTarget(ref)` runs that plan against the app store. Anything that cannot be shown in the heart view
// (a missing-data `M#` or red-flag `R#` ref, no target, unknown target, brain finding, no WebGL) yields `{ kind: "none" }`: the panel only highlights
// the ref, and nothing throws.
//
// Accepted `target` strings (the agreed `Finding.target` is a free string, docs/tasks/kerimku1.md):
//   - a heart `StructureId`, optionally with an AHA segment: "aortic_valve", "lv", "myocardium:7", "lv#12"
//   - a coronary vessel, optionally with a segment: "LAD", "LAD:mid", "rca_proximal", "coronary:LCx:distal",
//     "coronary_vessels:LAD"
import type { Ref } from "@/app/api/assistant/ids";
import { CORONARY_SEGMENTS, CORONARY_VESSELS, type CoronarySegment, type CoronaryVessel } from "@/domain/coronary";
import { STRUCTURE_IDS, type StructureId } from "@/domain/mapping/types";
import { useApp, type CameraPreset } from "@/state/store";
import { webglAvailable } from "@/scene/performance/quality";

/**
 * Camera preset that shows each vessel's course on the template (right-dominant pattern).
 * Local copy of `LESION_VIEW` in src/components/inspector/Inspector.tsx (not exported there); keep both in sync.
 */
export const LESION_VIEW: Record<"LM" | "LAD" | "LAD_DISTAL" | "LCx" | "RCA" | "PDA", CameraPreset> = {
  LM: "superior", LAD: "superior", LAD_DISTAL: "left_lateral", LCx: "left_lateral", RCA: "anterior", PDA: "inferior",
};

/** The preset the inspector's "View" button picks for a lesion: LAD beyond the proximal segment turns to the side. */
export function lesionView(vessel: CoronaryVessel, segment?: CoronarySegment): CameraPreset {
  return LESION_VIEW[vessel === "LAD" && segment !== "proximal" ? "LAD_DISTAL" : vessel];
}

export type FocusPlan =
  | { kind: "structure"; structure: StructureId; segment: number | null; camera: CameraPreset | null }
  | { kind: "coronary"; vessel: CoronaryVessel; segment: CoronarySegment | null; camera: CameraPreset }
  | { kind: "none" };

const VALVE_CAMERA: Partial<Record<StructureId, CameraPreset>> = {
  aortic_valve: "aortic_closeup",
  mitral_valve: "mitral_closeup",
};

const STRUCTURES = new Set<string>(STRUCTURE_IDS);
const VESSELS = new Map<string, CoronaryVessel>(CORONARY_VESSELS.map((v) => [v.toLowerCase(), v]));
const SEGMENTS = new Set<string>(CORONARY_SEGMENTS);
const CORONARY_PREFIX = /^(?:coronary_vessels|coronary)[\s:/#_-]+/i;
const NONE: FocusPlan = { kind: "none" };

function parseStructure(target: string): FocusPlan | null {
  const m = /^([a-z_]+?)(?:\s*[:#/]\s*(\d{1,2}))?$/.exec(target.toLowerCase());
  if (!m || !STRUCTURES.has(m[1])) return null;
  const structure = m[1] as StructureId;
  const n = m[2] === undefined ? null : Number(m[2]);
  // AHA 17-segment model; any other number is ignored rather than passed to the scene.
  const segment = n !== null && n >= 1 && n <= 17 ? n : null;
  return { kind: "structure", structure, segment, camera: VALVE_CAMERA[structure] ?? null };
}

function parseCoronary(target: string): FocusPlan | null {
  const [vesselPart, segmentPart, ...rest] = target.replace(CORONARY_PREFIX, "").split(/[\s:/#_-]+/);
  const vessel = VESSELS.get(vesselPart?.toLowerCase() ?? "");
  if (!vessel || rest.length > 0) return null;
  const seg = segmentPart?.toLowerCase();
  if (seg !== undefined && !SEGMENTS.has(seg)) return null;
  const segment = (seg as CoronarySegment | undefined) ?? null;
  return { kind: "coronary", vessel, segment, camera: lesionView(vessel, segment ?? undefined) };
}

/** Decide what the 3D view should do for a ref. Pure; never throws. */
export function planFocus(ref: Ref | null | undefined): FocusPlan {
  // A missing item (`M#`) or a red flag (`R#`) has nothing to show in 3D, whatever else the ref carries.
  if (!ref || ref.kind === "missing" || ref.kind === "redFlag" || ref.organ !== "heart" || typeof ref.target !== "string") return NONE;
  const target = ref.target.trim();
  if (!target) return NONE;
  return parseStructure(target) ?? parseCoronary(target) ?? NONE;
}

export interface FocusDeps {
  selectStructure: (s: StructureId | null, segment?: number | null) => void;
  requestCamera: (preset: CameraPreset) => void;
  webgl: () => boolean;
}

const storeDeps = (): FocusDeps => {
  const s = useApp.getState();
  return { selectStructure: s.selectStructure, requestCamera: s.requestCamera, webgl: webglAvailable };
};

/**
 * Move the 3D view to the ref's target. Returns the plan that was applied; `{ kind: "none" }` means the caller
 * should only highlight the ref in the panel. Store or scene failures are swallowed so the chat never breaks.
 */
export function focusTarget(ref: Ref | null | undefined, deps?: FocusDeps): FocusPlan {
  try {
    const plan = planFocus(ref);
    if (plan.kind === "none") return NONE;
    const d = deps ?? storeDeps();
    if (!d.webgl()) return NONE;
    if (plan.kind === "structure") {
      d.selectStructure(plan.structure, plan.segment);
      if (plan.camera) d.requestCamera(plan.camera);
    } else {
      d.selectStructure("coronary_vessels", null);
      d.requestCamera(plan.camera);
    }
    return plan;
  } catch {
    return NONE;
  }
}
