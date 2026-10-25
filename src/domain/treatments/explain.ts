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

// ---------------------------------------------------------------- number guard

const NUMBER = /\d+(?:[.,]\d+)?/g;
const asNumbers = (text: string) => (text.match(NUMBER) ?? []).map((t) => Number(t.replace(",", ".")));

/** Numbers the reply may use: every number in this condition's evidence brief, and any the clinician typed in the question. */
export function allowedNumbers(condition: ConditionId, question: string): number[] {
  return [...asNumbers(evidenceBrief(condition)), ...asNumbers(question)];
}

/**
 * Numbers in the model's reply that appear nowhere in the evidence or the question. The exact-value rule, as for the record chat:
 * a rounded or derived number counts as invented, because the table, not the model, decides what a study found.
 * `[S:id]` markers are removed first (their digits are part of an id, not a claim).
 */
export function inventedNumbers(raw: unknown, condition: ConditionId, question: string): string[] {
  const text = (typeof raw === "string" ? raw : "").replace(/\[S:[A-Za-z0-9_-]+\]/g, " ");
  const allowed = allowedNumbers(condition, question);
  return (text.match(NUMBER) ?? []).filter((t) => !allowed.some((a) => Math.abs(a - Number(t.replace(",", "."))) < 1e-9));
}

/** What the clinician sees when a reply is withheld: a sentence written by code and the studies behind the condition. */
export function withheldAnswer(condition: ConditionId): { answer: string; sources: CitedSource[] } {
  const ids = [...new Set(allFor(condition).flatMap((e) => e.sources))].filter((id) => EVIDENCE.sources[id]);
  const sources = ids.map((id) => { const s = EVIDENCE.sources[id]; return { id, cite: s.cite, title: s.title, journal: s.journal, doi: s.doi, studyType: s.studyType }; });
  return { answer: "The assistant's reply was withheld because it contained a number that is not in the cited studies. The studies behind this condition are listed below; open the info icon of a treatment button to read what each one found.", sources };
}
