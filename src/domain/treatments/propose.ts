// The chat may only propose buttons that exist in the evidence file. The model proposes; the table decides what is possible.
import { entriesFor } from "./load";
import type { ConditionId } from "./types";

export interface Proposal { id: string; reason: string }

const MAX_PROPOSALS = 5;

export function allowedIds(condition: ConditionId): string[] {
  return entriesFor(condition, "treatment").map((e) => e.id);
}

/**
 * Keep only known ids of this condition (once each, at most five). A reason with a digit might be an invented number,
 * so it is replaced by the table's own sentence: numbers come from the evidence file, never from the model.
 */
export function sanitizeProposals(raw: unknown, condition: ConditionId): Proposal[] {
  if (!Array.isArray(raw)) return [];
  const entries = new Map(entriesFor(condition, "treatment").map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: Proposal[] = [];
  for (const item of raw) {
    if (out.length >= MAX_PROPOSALS) break;
    if (typeof item !== "object" || item === null) continue;
    const { id, reason } = item as { id?: unknown; reason?: unknown };
    if (typeof id !== "string" || seen.has(id)) continue;
    const entry = entries.get(id);
    if (!entry) continue;
    seen.add(id);
    const clean = typeof reason === "string" && reason.trim() && !/\d/.test(reason);
    out.push({ id, reason: clean ? (reason as string).trim() : entry.why });
  }
  return out;
}
