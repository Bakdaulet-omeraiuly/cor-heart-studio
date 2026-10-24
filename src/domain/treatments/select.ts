// Which treatment buttons are on, and which effect of an entry applies at a given pace.
import type { Pace } from "../outlook/project";
import { EVIDENCE } from "./load";
import type { Effect, EvidenceEntry } from "./types";

const entryById = (id: string): EvidenceEntry | undefined => EVIDENCE.entries.find((e) => e.id === id);

/** Turn one button on or off. Switching one on switches off the others in its group (same condition): effects in a group are never summed. */
export function toggleTreatment(active: string[], id: string): string[] {
  const entry = entryById(id);
  if (!entry || entry.kind !== "treatment") return active;
  if (active.includes(id)) return active.filter((a) => a !== id);
  const kept = active.filter((a) => {
    const other = entryById(a);
    return !(entry.group && other && other.condition === entry.condition && other.group === entry.group);
  });
  return [...kept, id];
}

/** The active entries that carry an effect on a model (a listed button without an effect changes nothing). */
export function activeEffects(active: string[]): EvidenceEntry[] {
  return active.flatMap((id) => {
    const e = entryById(id);
    return e && e.kind === "treatment" && e.effect ? [e] : [];
  });
}

/** Pace picks the end of the range: average = likely, slower = best case, faster = worst case. */
export function pickEffect(e: Effect, pace: Pace): number {
  return pace === "mean" ? e.likely : pace === "slow" ? e.best : e.worst;
}
