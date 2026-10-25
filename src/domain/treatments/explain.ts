// The explain chat may only cite studies that exist in the evidence file. The model writes, the table decides what can be cited.
import { EVIDENCE, entriesFor } from "./load";
import type { ConditionId, EvidenceSource } from "./types";

const allFor = (c: ConditionId) => [...entriesFor(c, "natural"), ...entriesFor(c, "treatment")];

export interface CitedSource { id: string; cite: string; title: string; journal: string; doi: string; studyType: string }

/** The condition's evidence as plain text for the model: every option, its caveat, and the studies behind it. */
export function evidenceBrief(condition: ConditionId): string {
  return allFor(condition).map((e) => {
    const src = e.sources.map((id) => EVIDENCE.sources[id]).filter((s): s is EvidenceSource => !!s)
      .map((s) => `[S:${s.id}] ${s.cite}, ${s.studyType}, n=${s.n}${s.durationMonths ? `, ${s.durationMonths} months` : ""}, ${s.population}`).join("\n    ");
    const effect = e.effect ? `effect over ${e.effect.evidenceYears} y: likely ${e.effect.likely}, best ${e.effect.best}, worst ${e.effect.worst} (${e.effect.quantity})` : "no measured effect on the organ";
    return `- ${e.label} (${e.kind}): ${e.why} Caveat: ${e.caveat} ${effect}.\n    ${src}`;
  }).join("\n");
}

/** Keep only `[S:id]` markers that name a source of this condition; the rest is removed. Returns the cleaned text and the sources cited, in order. */
export function sanitizeAnswer(raw: unknown, condition: ConditionId): { answer: string; sources: CitedSource[] } {
  const text = typeof raw === "string" ? raw : "";
  const allowed = new Set(allFor(condition).flatMap((e) => e.sources));
  const cited: string[] = [];
  const answer = text.replace(/\s*\[S:([A-Za-z0-9_-]+)\]/g, (_m, id: string) => {
    if (!allowed.has(id) || !EVIDENCE.sources[id]) return "";
    if (!cited.includes(id)) cited.push(id);
    return ` [${cited.indexOf(id) + 1}]`;
  }).trim();
  const sources = cited.map((id) => { const s = EVIDENCE.sources[id]; return { id, cite: s.cite, title: s.title, journal: s.journal, doi: s.doi, studyType: s.studyType }; });
  return { answer, sources };
}
