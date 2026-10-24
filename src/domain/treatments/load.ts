// Loads and validates the treatment evidence file once. A malformed file fails at import, so the app never shows unchecked numbers.
import raw from "./evidence.json";
import { EvidenceFileSchema } from "./schema";
import type { ConditionId, EvidenceEntry, EvidenceFile, EvidenceSource } from "./types";

export const EVIDENCE: EvidenceFile = EvidenceFileSchema.parse(raw);

export function entriesFor(condition: ConditionId, kind: "natural" | "treatment"): EvidenceEntry[] {
  return EVIDENCE.entries.filter((e) => e.condition === condition && e.kind === kind);
}

export function sourceById(id: string): EvidenceSource {
  const s = EVIDENCE.sources[id];
  if (!s) throw new Error(`unknown evidence source: ${id}`);
  return s;
}
