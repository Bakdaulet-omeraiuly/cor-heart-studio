"use client";
// Outlook view state (session-only): open/closed, time horizon, pace and per-organ scenario inputs.
import { create } from "zustand";
import type { BrainScenarioId } from "@/domain/outlook/evidence";
import type { Pace } from "@/domain/outlook/project";

export interface OutlookState {
  open: boolean;
  years: number;
  pace: Pace;
  brainScenario: BrainScenarioId;
  /** Heart: today's values typed by the user when the record has none (null = use the record). */
  avaOverride: number | null;
  vmaxOverride: number | null;
  set: (patch: Partial<Omit<OutlookState, "set">>) => void;
}

export const MAX_YEARS = 10;

export const useOutlook = create<OutlookState>((set) => ({
  open: false,
  years: 5,
  pace: "mean",
  brainScenario: "alzheimers",
  avaOverride: null,
  vmaxOverride: null,
  set: (patch) => set(patch),
}));
