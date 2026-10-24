"use client";
// Outlook view state (session-only): open/closed, time horizon, pace and per-organ scenario inputs.
import { create } from "zustand";
import type { BrainScenarioId } from "@/domain/outlook/evidence";
import type { Pace } from "@/domain/outlook/project";
import { toggleTreatment } from "@/domain/treatments/select";

export interface OutlookState {
  open: boolean;
  years: number;
  pace: Pace;
  brainScenario: BrainScenarioId;
  /** Heart: today's values typed by the user when the record has none (null = use the record). */
  avaOverride: number | null;
  vmaxOverride: number | null;
  heartScenario: HeartScenario;
  /** Treatment buttons that are on (ids from the treatment evidence file). Cleared when the scenario changes. */
  active: string[];
  /** LVH inputs typed by the user (mm, m²); missing keys fall back to the record. */
  lvhOverrides: Partial<Record<"ivsMm" | "pwMm" | "lvidMm" | "bsaM2", number>>;
  set: (patch: Partial<Omit<OutlookState, "set" | "toggle">>) => void;
  toggle: (id: string) => void;
}

export type HeartScenario = "as" | "lvh";

export const MAX_YEARS = 10;

export const useOutlook = create<OutlookState>((set) => ({
  open: false,
  years: 5,
  pace: "mean",
  brainScenario: "alzheimers",
  avaOverride: null,
  vmaxOverride: null,
  heartScenario: "as",
  active: [],
  lvhOverrides: {},
  set: (patch) =>
    set((s) => {
      const scenarioChanged =
        (patch.heartScenario !== undefined && patch.heartScenario !== s.heartScenario) ||
        (patch.brainScenario !== undefined && patch.brainScenario !== s.brainScenario);
      return scenarioChanged ? { ...patch, active: [] } : patch;
    }),
  toggle: (id) => set((s) => ({ active: toggleTreatment(s.active, id) })),
}));
