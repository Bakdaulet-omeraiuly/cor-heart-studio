// Pure helpers for rendering assistant replies (Requirements 10.3, 10.4, 10.8).
//
// No React, no I/O, so they are unit-tested in the node Vitest environment. Types are imported from the
// server route as TYPES ONLY (erased at compile time); no server code reaches the client bundle.
import type { Ref } from "@/app/api/assistant/ids";

/** One piece of a reply: plain text, or a cited id (`F2`, `E5`, `M1`, `R1`) without brackets. */
export type ReplyPart = { kind: "text"; text: string } | { kind: "ref"; id: string };

/**
 * Citation brackets: `[F2]`, `[E5]`, `[M1]` or `[R1]` as in the design (`\[(?:F|E|M|R)\d+\]`), plus a grouped
 * `[F2, M1]`. The guard accepts the grouped form (it also recognises bare ids), so the panel renders each id in
 * it as its own button.
 */
const CITATION = /\[((?:F|E|M|R)\d+(?:\s*,\s*(?:F|E|M|R)\d+)*)\]/g;

/**
 * Remove Markdown the model slipped in despite the plain-text rule (Requirement 10.8): every `**` marker, and a
 * leading `- ` bullet (with any indentation before it) on each line. A hyphen not followed by a space at the start
 * of a line (`-2.5`) and hyphens inside text (`40-50`, `left - right`) are kept. Citations are untouched, so
 * `splitReply` still finds them afterwards.
 */
export function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, "").replace(/^[ \t]*- +/gm, "");
}

/**
 * Split reply text into text and id parts. Ids are only produced from bracketed citations; concatenating
 * the text parts with `[id]` for each ref part gives back the original text for single-id brackets.
 */
export function splitReply(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let last = 0;
  for (const m of text.matchAll(CITATION)) {
    const start = m.index;
    if (start > last) parts.push({ kind: "text", text: text.slice(last, start) });
    for (const id of m[1].split(",")) parts.push({ kind: "ref", id: id.trim() });
    last = start + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** `value unit` for an evidence ref, or null when the ref carries no value. */
export function refValue(ref: Ref): string | null {
  if (ref.value === undefined || ref.value === "") return null;
  return ref.unit ? `${ref.value} ${ref.unit}` : String(ref.value);
}

/**
 * Tooltip lines for a ref, in the order of the design: label · field = value unit · rule · source.
 * Empty parts are skipped, so a finding ref is usually just its label. A missing-data ref shows
 * label · field · why; a red-flag ref shows label · text.
 */
export function refDetails(ref: Ref): string[] {
  const lines = [ref.label];
  if (ref.kind === "missing") {
    if (ref.field) lines.push(ref.field);
    if (ref.why) lines.push(ref.why);
    return lines;
  }
  if (ref.kind === "redFlag") {
    if (ref.text) lines.push(ref.text);
    return lines;
  }
  if (ref.field) {
    const v = refValue(ref);
    lines.push(v ? `${ref.field} = ${v}` : ref.field);
  }
  if (ref.rule) lines.push(`Rule ${ref.rule}`);
  if (ref.source) lines.push(ref.source);
  return lines;
}

const KIND_NAME: Record<Ref["kind"], string> = {
  finding: "Finding",
  evidence: "Evidence",
  missing: "Missing data",
  redFlag: "Red flag",
};

/**
 * Short accessible name for an id button ("Evidence E1", "Missing data M1", "Red flag R1"); the details are
 * linked as its description.
 */
export function refAccessibleName(id: string, ref: Ref | undefined): string {
  if (!ref) return `Citation ${id}`;
  return `${KIND_NAME[ref.kind]} ${id}`;
}
