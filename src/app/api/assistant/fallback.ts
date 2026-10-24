// Deterministic, guard-safe fallback reply (Requirement 6.5).
//
// When the model is unavailable, times out, or its reply fails the output
// `guard()`, the route serves `fallbackText(a)` instead. The text is built ONLY
// from the (ided) Assessment, so it passes `guard()` by construction:
//
//   - Every number printed is an `Evidence.value` rendered verbatim with its
//     `Evidence.unit`. `allowedNumbers()` derives the allowed set from exactly
//     those evidence values, and we never add precision the stored value does not
//     have, so the guard's number check always matches.
//   - Every clinical sentence carries a real `F#`/`E#`/`R#` id. Each finding line
//     starts with its finding id and cites each evidence item's id inline, so the
//     guard's citation check always finds a known id next to the grade word,
//     finding label and numbers on that line.
//   - The `Missing:` line cites each item by its `M#` id (`Missing: M1 <field>,
//     M2 <field>.`). The guard strips id tokens before extracting numbers and
//     counts known `M#` ids as citations, so the line passes either way.
//   - Each red-flag line starts with the flag's own `R#` id (`R1 <text>`); the
//     guard counts known `R#` ids as citations.
//   - The disclaimer carries no number, grade word or finding label, so the guard
//     does not require a citation for it.
//
// Design choices that keep the text guard-safe:
//
//   - `Missing:` lines are rendered from the id and field name only, NOT the free-text
//     `why`. A `why` string can contain a grade word ("…confirms *severe*
//     grading…") with no finding it belongs to, which would read as an uncited
//     clinical claim. Field paths (`observations.aorticValveAreaIndexed`) carry no
//     grade word, number or finding label, so they stay non-clinical.
//   - String-valued evidence (e.g. a quoted clinician note) is rendered as its
//     field name only — its free text is never echoed. That avoids repeating
//     record prose (which may itself be adversarial) and keeps the line to known
//     ids plus the field label.
//   - A red-flag line is clinical (it may name a grade and a number), so it is
//     prefixed with the flag's own `R#` id, whether or not there are findings.
import type { IdedAssessment } from "./ids";

type IdedEvidence = IdedAssessment["findings"][number]["evidence"][number];
type IdedFinding = IdedAssessment["findings"][number];

/**
 * Humanize an evidence field path into a short, citation-free label.
 *
 * Takes the final path segment (dropping any `observations.`/`valveFindings[…].`
 * prefix) and splits a camelCase identifier into spaced lowercase words, so
 * `peakVelocity` → "peak velocity" and `observations.ivsThickness` → "ivs
 * thickness". The result never contains a digit, a grade word or a finding
 * label, so it does not make a line clinical on its own.
 */
function fieldLabel(field: string): string {
  // Last dotted segment, then strip any trailing `[…]` selector or leading one.
  const afterDot = field.slice(field.lastIndexOf(".") + 1);
  const leaf = afterDot.replace(/\[[^\]]*\]/g, "");
  return leaf
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase → camel Case
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Render one evidence item as `E# <label> <value> <unit>`.
 *
 * Numeric values are printed verbatim (`String(value)`) with their unit, so the
 * guard's precision rule always matches the stored value. String values (quoted
 * record text) are NOT printed — only the field label follows the id — so no
 * record free text reaches the reply.
 */
function renderEvidence(evidence: IdedEvidence): string {
  const label = fieldLabel(evidence.field);
  if (typeof evidence.value === "number") {
    const unit = evidence.unit ? ` ${evidence.unit}` : "";
    return `${evidence.id} ${label} ${evidence.value}${unit}`;
  }
  // String evidence: field label only, never the quoted value.
  return `${evidence.id} ${label}`;
}

/**
 * Render one finding (or differential entry) as a single self-contained line:
 *
 *   `F# <label> (<basis>) — E# <evidence> · E# <evidence>`
 *
 * The leading finding id and every inline evidence id keep the line cited no
 * matter how the guard splits sentences, so the grade word in the label and the
 * evidence numbers are always accompanied by a known id.
 */
function renderFinding(finding: IdedFinding): string {
  const head = `${finding.id} ${finding.label} (${finding.basis})`;
  if (finding.evidence.length === 0) {
    return head;
  }
  const evidence = finding.evidence.map(renderEvidence).join(" \u00B7 "); // " · "
  return `${head} \u2014 ${evidence}`; // " — "
}

/**
 * Build the deterministic fallback reply from an ided Assessment.
 *
 * Sections, in order (each omitted when empty): findings, differential, a single
 * `Missing:` line of `M#` ids with their field names, red-flag lines, and the
 * disclaimer. The result
 * passes `guard(text, a, patient)` for any patient whose allowed numbers include
 * the Assessment's evidence values (which `allowedNumbers` always does).
 */
export function fallbackText(a: IdedAssessment): string {
  const lines: string[] = [];

  for (const finding of a.findings) {
    lines.push(`${renderFinding(finding)}.`);
  }
  for (const finding of a.differential) {
    lines.push(`${renderFinding(finding)}.`);
  }

  if (a.missing.length > 0) {
    const fields = a.missing.map((m) => `${m.id} ${m.field}`).join(", ");
    lines.push(`Missing: ${fields}.`);
  }

  // A red flag is a clinical claim, so each line cites the flag's own `R#` id.
  for (const flag of a.redFlags) {
    lines.push(`${flag.id} ${flag.text}`);
  }

  if (a.disclaimer) {
    lines.push(a.disclaimer);
  }

  return lines.join("\n");
}
