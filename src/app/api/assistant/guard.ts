// Output guard for the assistant's reply (Requirements 6.1, 6.7).
//
// The model may only restate clinical numbers and cite ids that the engine
// actually produced. The guard works on plain text, so its first job is to pull
// every numeric token out of a reply in a shape later steps can compare against
// the allowed values from the Assessment.
//
// This file is built up across subtasks 3.1–3.4:
//   - 3.1 (this one): `extractNumbers()` + the `NumberToken` type.
//   - 3.2: `allowedNumbers()`, `matchNumber()` (exact-value rule, unit aliases).
//   - 3.3: `checkCitations()`, `guard()`.
// The structure below (clearly sectioned, one exported piece per concern) is
// meant to let those additions land without churn.

import type { NormalizedPatient } from "@/domain/types";
import type { IdedAssessment } from "./ids";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One numeric token lifted out of the reply text.
 *
 * - `raw`      — the exact substring matched (useful for diagnostics/tests).
 * - `value`    — the parsed number (decimal comma normalized to a dot).
 * - `unit`     — a unit written directly after the number, if any (normalized
 *                only by trimming; alias mapping like `cm2`≡`cm²` happens later
 *                in `matchNumber`, not here).
 * - `rangeWith`— when the number is the low end of a range (`40–50`, `40 to 50`),
 *                the high end is captured here so both ends can be checked.
 */
export interface NumberToken {
  raw: string;
  value: number;
  unit?: string;
  rangeWith?: number;
}

// ---------------------------------------------------------------------------
// Number extraction (task 3.1)
// ---------------------------------------------------------------------------

// Units the engine emits, longest-first so the alternation is greedy where it
// matters (`mL/m²` must win over `mL`, `g/m²` over `g`, `cm²`/`cm2` over nothing
// shorter). These are matched verbatim; alias folding (`cm2`→`cm²`) is a concern
// of the later match step, so we keep both spellings here.
//
// NOTE: `%` is deliberately NOT in this list. A percentage sign binds tighter
// than a space-separated unit and is handled by a dedicated capture group below,
// so that `55%` yields unit `%` while `55 mmHg` yields unit `mmHg`.
const UNITS = [
  "mL/m\u00B2", // mL/m²
  "mL/m2",
  "g/m\u00B2", // g/m²
  "g/m2",
  "cm\u00B2", // cm²
  "cm2",
  "mmHg",
  "bpm",
  "m/s",
  "mm",
  "mL",
  "ms",
  "g",
];

// Build the unit alternation once. The parts are already regex-safe except for
// the slash and the superscript-2 (both literal in a RegExp), so no escaping is
// needed, but we keep them in a constant for readability.
const UNIT_ALT = UNITS.join("|");

// A single number: an integer part with optional thousands groups, an optional
// decimal part introduced by a dot OR a comma. See `parseNumber` for how the
// comma ambiguity is resolved.
//   \d{1,3}(?:,\d{3})+       → 1,200 / 12,345 (comma as thousands separator)
//   \d+                      → plain run of digits
//   (?:[.,]\d+)?             → optional decimal with dot or comma (1.3 / 1,3)
const NUMBER = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?`;

// A range separator: en dash, em dash, hyphen/minus, or the word "to" (with
// surrounding spaces). Hyphen handling is conservative — see the stripping notes
// below for why a bare `-` between digits is treated as a range, not a minus.
const RANGE_SEP = String.raw`\s*(?:\u2013|\u2014|-)\s*|\s+to\s+`;

// An optional unit sitting directly after a number: at most one space, then the
// unit or a percent sign. The leading space lives INSIDE this optional group on
// purpose — otherwise a lone `\s?` after the number would eat the space in
// "40 to 50" and starve the `\s+to\s+` range separator, splitting the range into
// two separate numbers.
//
// The `(?![A-Za-z])` lookahead stops a unit from matching the first letters of
// an ordinary word: without it "2020 guideline" would read as 2020 with unit `g`,
// and "15 mmol" as 15 `mm`. When the lookahead fails the optional group is
// skipped, so the number is still captured, just without a unit.
const OPT_UNIT = String.raw`(?:\s?(${UNIT_ALT}|%)(?![A-Za-z]))?`;

// The master token regex, assembled from the parts above:
//   (number)(optional unit OR %)  possibly followed by  (range sep)(number)(optional unit OR %)
// The unit is only attached when it sits immediately after the number (at most a
// single space), matching the design's "a unit directly after the number".
const NUMBER_TOKEN = new RegExp(
  String.raw`(${NUMBER})${OPT_UNIT}(?:(?:${RANGE_SEP})(${NUMBER})${OPT_UNIT})?`,
  "gu",
);

// Id tokens the engine uses for citations. We strip them BEFORE extracting
// numbers so the digits inside `[F12]` or a bare `E3` are never mistaken for a
// clinical number. The bracketed form and the bare form are both covered; a
// word boundary keeps us from eating the `E` in, say, "ECG".
const ID_TOKEN = /\[(?:F|E)\d+\]|\b(?:F|E)\d+\b/g;

// Leading list markers on each line: "1.", "2)", "- ", "* ", "• ". These are
// document structure, not clinical numbers, so they are stripped per line before
// extraction. We only strip at the start of a (trimmed) line so an inline "1." in
// prose is left alone.
const LIST_MARKER = /^\s*(?:[-*\u2022]\s+|\d+[.)]\s+)/;

/**
 * Normalize a matched number substring to a JavaScript number.
 *
 * Comma handling — the one genuinely ambiguous case — is resolved as follows,
 * chosen for the guard's purpose (catching invented clinical numbers, not
 * perfect locale parsing):
 *
 *   - `1,200` / `12,345,678`  → thousands separators. A comma followed by
 *     exactly three digits, repeated, is stripped. Clinical values here are
 *     small (velocities, areas, pressures), so a thousands-grouped number is far
 *     more likely a count than a European decimal.
 *   - `1,3` / `0,85`          → European decimal comma. A single comma followed
 *     by one or two digits (not a group of three) is read as a decimal point, so
 *     `1,3` parses as `1.3`.
 *   - A comma used purely as a list separator ("4.3, 2.1 and 55") never reaches
 *     here as part of a number: the token regex stops the integer run at the
 *     comma unless it is immediately followed by digits, and the surrounding
 *     spaces in a list ("4.3, 2.1") break the `,\d` adjacency, so each value is
 *     matched on its own.
 */
function parseNumber(raw: string): number {
  // Thousands separators: comma(s) each followed by exactly three digits.
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(raw)) {
    return Number(raw.replace(/,/g, ""));
  }
  // European decimal comma: a single comma with one or two trailing digits.
  if (/^\d+,\d{1,2}$/.test(raw)) {
    return Number(raw.replace(",", "."));
  }
  // Everything else (plain integer, dot decimal) parses directly.
  return Number(raw);
}

/**
 * Pull every numeric token out of a reply.
 *
 * Steps:
 *   1. Remove id tokens so `[F12]`/`E3` digits are not counted.
 *   2. Remove leading list markers, line by line, so `1.`/`2)`/`- ` numbering is
 *      not counted.
 *   3. Scan the cleaned text with the master regex, emitting one `NumberToken`
 *      per number — ranges contribute a single token whose `rangeWith` holds the
 *      high end (with the low end's unit used if the high end omitted one).
 */
export function extractNumbers(text: string): NumberToken[] {
  // 1. Strip id tokens everywhere.
  const withoutIds = text.replace(ID_TOKEN, " ");

  // 2. Strip leading list markers per line.
  const cleaned = withoutIds
    .split("\n")
    .map((line) => line.replace(LIST_MARKER, ""))
    .join("\n");

  const tokens: NumberToken[] = [];

  for (const match of cleaned.matchAll(NUMBER_TOKEN)) {
    const [raw, lowRaw, lowUnit, highRaw, highUnit] = match;

    const token: NumberToken = {
      raw,
      value: parseNumber(lowRaw),
    };

    // A unit on either end describes the whole range; prefer an explicit unit
    // wherever it is written (low end first, then high end as a fallback).
    const unit = lowUnit ?? highUnit;
    if (unit !== undefined) {
      token.unit = unit;
    }

    if (highRaw !== undefined) {
      token.rangeWith = parseNumber(highRaw);
    }

    tokens.push(token);
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Allowed values + match rule (task 3.2)
// ---------------------------------------------------------------------------

/**
 * Unit alias folding.
 *
 * The engine, the record and the model all spell the same unit a few different
 * ways: the superscript-² forms (`cm²`, `mL/m²`, `g/m²`) and the ASCII `2`
 * forms (`cm2`, `mL/m2`, `g/m2`) mean the same thing. Before two units are
 * compared in `matchNumber`, each is run through this map so the spellings
 * collapse to a single canonical key. Units not in the map (`m/s`, `mmHg`, …)
 * pass through unchanged.
 */
const UNIT_ALIASES: Record<string, string> = {
  cm2: "cm\u00B2", // cm2  → cm²
  "cm\u00B2": "cm\u00B2",
  "mL/m2": "mL/m\u00B2", // mL/m2 → mL/m²
  "mL/m\u00B2": "mL/m\u00B2",
  "g/m2": "g/m\u00B2", // g/m2  → g/m²
  "g/m\u00B2": "g/m\u00B2",
};

/**
 * Fold a unit to its canonical spelling for comparison.
 *
 * Trims surrounding whitespace first so a stray space from either source does
 * not defeat the lookup, then maps through `UNIT_ALIASES`. Anything not in the
 * map (including the empty string) is returned as-is.
 */
function canonicalUnit(unit: string): string {
  const trimmed = unit.trim();
  return UNIT_ALIASES[trimmed] ?? trimmed;
}

/**
 * Collect every numeric value the model is permitted to restate, each paired
 * with the unit it was reported in (design.md "Allowed values").
 *
 * Sources, in order:
 *   1. Every numeric `Evidence.value` from the Assessment's findings and
 *      differential, with its `Evidence.unit`. (String evidence values — e.g.
 *      quoted clinician notes — carry no number and are skipped.)
 *   2. Every usable observation in the normalized record
 *      (`observations[path].value` when non-null), with its `.unit`.
 *   3. Derived values (`derived[].value`/`.unit`).
 *   4. Valve measurement numbers (`valveFindings[].measurements[]`, skipping
 *      null values) with their optional `.unit`.
 *   5. Coronary stenosis percentages (`coronaryFindings[].stenosisPercent`),
 *      which are percentages, so they carry the `%` unit.
 *   6. AHA segment numbers — unitless integers — from wall-motion and
 *      wall-thickness entries (`wallMotion[].segment`, `wallThickness[].region`
 *      and `.segments[]`).
 *   7. Every number written in an evidence item's `source` (e.g. the year in
 *      "ACC/AHA 2020") or `rule` id (e.g. the `01` in "R-VALVE-STEN-01"),
 *      pulled out with `extractNumbers` so a reply that quotes the citation is
 *      parsed exactly the same way. Range ends are both allowed; each carries
 *      whatever unit the extractor found (usually none).
 *
 * Null/undefined numeric values are skipped. Non-finite numbers (NaN) never
 * make it in. Deduplication is not required — a longer list only costs a few
 * comparisons in `matchNumber` — so values may repeat.
 */
export function allowedNumbers(
  a: IdedAssessment,
  p: NormalizedPatient,
): { value: number; unit?: string }[] {
  const allowed: { value: number; unit?: string }[] = [];

  // Small helper: push a value only when it is a real, finite number. Keeps the
  // null/undefined/NaN guard in one place.
  const push = (value: number | null | undefined, unit?: string): void => {
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return;
    }
    allowed.push(unit !== undefined ? { value, unit } : { value });
  };

  // 1. Evidence values from findings + differential. Evidence.value is
  //    `number | string`; only the numeric ones contribute.
  for (const finding of [...a.findings, ...a.differential]) {
    for (const evidence of finding.evidence) {
      if (typeof evidence.value === "number") {
        push(evidence.value, evidence.unit);
      }
    }
  }

  // 2. Observations: the canonical numeric value, null when unusable.
  for (const obs of Object.values(p.observations)) {
    push(obs.value, obs.unit);
  }

  // 3. Derived values: always numeric, always with a unit.
  for (const derived of p.derived) {
    push(derived.value, derived.unit);
  }

  // 4. Valve measurements: each measurement's number (may be null) with its
  //    optional unit.
  for (const valve of p.valveFindings) {
    for (const measurement of valve.measurements) {
      push(measurement.value, measurement.unit);
    }
  }

  // 5. Coronary findings: stenosis is a percentage, so it is allowed as a `%`.
  for (const coronary of p.coronaryFindings) {
    push(coronary.stenosisPercent, "%");
  }

  // 6. AHA segment numbers — unitless integers. Wall motion names a single
  //    segment; wall thickness names a region (which may itself be a segment
  //    number) plus the segments it spans.
  for (const wm of p.wallMotion) {
    push(wm.segment);
  }
  for (const wt of p.wallThickness) {
    if (typeof wt.region === "number") {
      push(wt.region);
    }
    for (const segment of wt.segments) {
      push(segment);
    }
  }

  // 7. Numbers quoted in the citation itself: guideline years, volume/page
  //    numbers in `source`, and the digits of `rule` ids.
  for (const finding of [...a.findings, ...a.differential]) {
    for (const evidence of finding.evidence) {
      for (const text of [evidence.source, evidence.rule]) {
        for (const token of extractNumbers(text)) {
          push(token.value, token.unit);
          if (token.rangeWith !== undefined) push(token.rangeWith, token.unit);
        }
      }
    }
  }

  return allowed;
}

/**
 * Does a single written number (value + optional unit) match any allowed value?
 *
 * Match rule — EXACT stored value:
 *   - The written value must equal a stored value. Trailing zeros carry no new
 *     information, so they are fine in either direction: `1.3` matches a stored
 *     `1.30`, `1.30` matches a stored `1.3`, `55` matches `55.0` (each pair parses
 *     to the same number).
 *   - Rounding is NOT allowed, in either direction. `4 m/s` does not match a
 *     stored `4.3 m/s`, and `0.9` does not match a stored `0.85`. A rounded value
 *     reads as a different measurement, or as a guideline threshold the model
 *     supplied on its own ("severe is Vmax of at least 4 m/s"), which is exactly
 *     the kind of number the guard exists to stop.
 *   - Units are compared after alias folding. A written number WITHOUT a unit
 *     matches an allowed value regardless of the allowed value's unit. A written
 *     number WITH a unit only matches an allowed value carrying the same
 *     (alias-folded) unit.
 *
 * This is stricter than the original design note in design.md ("rounding to
 * fewer decimals than stored is allowed"); the code is the source of truth.
 */
function matchOne(
  value: number,
  unit: string | undefined,
  allowed: { value: number; unit?: string }[],
): boolean {
  const writtenUnit = unit !== undefined ? canonicalUnit(unit) : undefined;

  return allowed.some((candidate) => {
    // Unit gate: a unit on the token must match the allowed unit (after folding);
    // a token with no unit ignores units entirely.
    if (writtenUnit !== undefined) {
      if (candidate.unit === undefined) return false;
      if (canonicalUnit(candidate.unit) !== writtenUnit) return false;
    }

    // Value gate: exact equality. Both sides come from decimal strings, so equal
    // decimals (`1.3` / `1.30`) are the same double and compare equal.
    return candidate.value === value;
  });
}

/**
 * Does a reply's numeric token match something the engine actually produced?
 *
 * A plain token matches when its value and unit equal some allowed value (see
 * `matchOne`). A range token (`rangeWith` set) is only accepted when BOTH ends
 * match some allowed value independently; both ends share the token's unit (the
 * extractor attaches one unit to the whole range).
 */
export function matchNumber(
  t: NumberToken,
  allowed: { value: number; unit?: string }[],
): boolean {
  if (!matchOne(t.value, t.unit, allowed)) return false;

  if (t.rangeWith !== undefined) {
    return matchOne(t.rangeWith, t.unit, allowed);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Citations + guard (task 3.3)
// ---------------------------------------------------------------------------

// Grade words that, on their own, make a sentence "clinical" (design.md
// "Citations"). These are the qualitative gradings the engine and the record
// use; a sentence that grades anything (even without a number) is a clinical
// claim and so must be cited. Matched case-insensitively as whole words so, for
// example, "normally" does not count as "normal" and a stray "mild" inside
// another word is not matched.
//
// `CAD-RADS` is listed on its own because it is written with a hyphen; a word
// boundary before `CAD` and after `RADS` keeps it intact.
const GRADE_WORDS = [
  "mild",
  "moderate",
  "severe",
  "normal",
  "reduced",
  "CAD-RADS",
];

// Whole-word, case-insensitive matcher for the grade words. `\b` on each side
// keeps "severe" from matching inside "severely"'s stem only partially — note
// "severely" DOES contain the whole word "severe" followed by a letter, so to be
// strict we require a word boundary after the word too; "severely" has no
// boundary between "severe" and "ly", so it will NOT match. That is the intended
// behaviour: an adverbially-qualified claim like "severely reduced" still trips
// the check via "reduced".
const GRADE_WORD_RE = new RegExp(
  String.raw`\b(?:${GRADE_WORDS.join("|")})\b`,
  "iu",
);

// Id-token recognition, mirroring `ID_TOKEN` above but WITHOUT the global flag so
// we can `.test()` / `.match()` per sentence without carrying `lastIndex` state
// between calls. Captures the id itself (dropping the optional brackets) so we
// can compare it against the known set. Covers both `[F2]`/`[E5]` and bare
// `F2`/`E5`; the word boundary keeps the `E` in "ECG" from matching.
const ID_TOKEN_CAPTURE = /\[((?:F|E)\d+)\]|\b((?:F|E)\d+)\b/gu;

/**
 * Collect the set of ids the Assessment actually produced.
 *
 * Every finding (and differential entry) carries an `F#` id and every evidence
 * item an `E#` id (stamped by `withIds`). Any id token in the reply that is not
 * in this set was invented by the model and is reported as unknown.
 */
function knownIds(a: IdedAssessment): Set<string> {
  const ids = new Set<string>();
  for (const finding of [...a.findings, ...a.differential]) {
    ids.add(finding.id);
    for (const evidence of finding.evidence) {
      ids.add(evidence.id);
    }
  }
  return ids;
}

/**
 * Pull every id token out of a string.
 *
 * Returns the bare ids (`F2`, `E5`) regardless of whether they were written
 * bracketed (`[F2]`) or bare. Uses a fresh match loop so callers can run it over
 * the whole reply or a single sentence without regex state leaking across calls.
 */
function idTokensIn(text: string): string[] {
  const ids: string[] = [];
  for (const m of text.matchAll(ID_TOKEN_CAPTURE)) {
    // One of the two capture groups is set depending on the bracketed/bare form.
    ids.push(m[1] ?? m[2]);
  }
  return ids;
}

/**
 * Split a reply into sentences.
 *
 * A sentence boundary is sentence-ending punctuation (`.`, `!`, `?`) followed by
 * whitespace. The one hazard is a period that is really a decimal point (`4.3`)
 * or part of a token like a version/grade string — we must not split there. Two
 * things protect us:
 *
 *   1. The boundary requires WHITESPACE after the punctuation. A decimal point in
 *      `4.3` has a digit after it, not a space, so it never looks like a
 *      boundary. `CAD-RADS 2` likewise has no period, and `CAD-RADS 2.` at the
 *      end of a sentence splits correctly (the `.` is followed by a space or end
 *      of string, and the digit is before the period, not after).
 *   2. A negative lookbehind `(?<!\d)` on the period guards the rare "digit, then
 *      period, then space" case (e.g. "area 2. Next" — unlikely in practice) from
 *      being treated as a decimal; combined with the whitespace requirement this
 *      keeps real decimals (`4.3`) intact while still ending a sentence that
 *      happens to finish on a bare integer.
 *
 * Trailing punctuation is kept on the sentence it closes (the split consumes only
 * the following whitespace), and empty fragments are dropped. Newlines count as
 * whitespace, so list items on their own lines each become a "sentence" even
 * without terminal punctuation — the final fragment after the last boundary is
 * always included.
 */
function splitSentences(text: string): string[] {
  // Split on: (a '.' not preceded by a digit, OR a '!'/'?') then whitespace.
  // The alternation keeps `!`/`?` unconditional while only the period carries the
  // decimal-point guard. Lookbehind is supported by the target runtime (Node).
  const parts = text.split(/(?<=(?<!\d)[.!?])\s+/u);
  return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Check a reply's citations against the Assessment (design.md "Citations").
 *
 * Two independent checks:
 *
 *   - unknownIds: every id token in the reply that is not one of the Assessment's
 *     known ids. Order of first appearance, de-duplicated.
 *   - uncitedSentences: every "clinical" sentence that contains no KNOWN id. A
 *     sentence is clinical if it contains a number, a grade word, or a finding
 *     label/condition from the Assessment (case-insensitive substring). Note a
 *     sentence whose only id is an unknown one is still uncited — the test is for
 *     a KNOWN id, so an invented citation does not satisfy it (and the unknown id
 *     is independently reported in `unknownIds`).
 *
 * Refusal and "what I can help with" sentences carry no number, grade word or
 * finding label, so they are not clinical and never require a citation — no
 * special-casing needed.
 */
export function checkCitations(
  text: string,
  a: IdedAssessment,
): { unknownIds: string[]; uncitedSentences: string[] } {
  const known = knownIds(a);

  // Lower-cased finding labels and conditions, for the "mentions a finding"
  // substring test. Collected once so each sentence is a cheap set of `includes`.
  const findingTerms: string[] = [];
  for (const finding of [...a.findings, ...a.differential]) {
    if (finding.label) findingTerms.push(finding.label.toLowerCase());
    if (finding.condition) findingTerms.push(finding.condition.toLowerCase());
  }

  // Unknown ids across the WHOLE reply, de-duplicated in first-seen order.
  const unknownIds: string[] = [];
  const seenUnknown = new Set<string>();
  for (const id of idTokensIn(text)) {
    if (!known.has(id) && !seenUnknown.has(id)) {
      seenUnknown.add(id);
      unknownIds.push(id);
    }
  }

  // Uncited clinical sentences.
  const uncitedSentences: string[] = [];
  for (const sentence of splitSentences(text)) {
    const lower = sentence.toLowerCase();

    const hasNumber = extractNumbers(sentence).length > 0;
    const hasGradeWord = GRADE_WORD_RE.test(sentence);
    const mentionsFinding = findingTerms.some((term) => lower.includes(term));

    const isClinical = hasNumber || hasGradeWord || mentionsFinding;
    if (!isClinical) {
      continue;
    }

    // Clinical: must carry at least one KNOWN id.
    const hasKnownId = idTokensIn(sentence).some((id) => known.has(id));
    if (!hasKnownId) {
      uncitedSentences.push(sentence);
    }
  }

  return { unknownIds, uncitedSentences };
}

/**
 * The full output guard: numbers + citations (design.md "Guard").
 *
 * Composes the three checks built across this file:
 *   - "number"      — some extracted number does not match an allowed value.
 *   - "unknown_id"  — the reply cites an id the Assessment never produced.
 *   - "uncited"     — a clinical sentence carries no known id.
 *
 * Reasons are reported at most once each, in the fixed order number →
 * unknown_id → uncited so the result is stable and easy to assert against.
 * Returns `{ ok: true }` only when none of the checks fire.
 */
export function guard(
  text: string,
  a: IdedAssessment,
  p: NormalizedPatient,
): { ok: true } | { ok: false; reasons: ("number" | "unknown_id" | "uncited")[] } {
  const reasons: ("number" | "unknown_id" | "uncited")[] = [];

  // Number check: any token that fails to match an allowed value is a violation.
  const allowed = allowedNumbers(a, p);
  const hasBadNumber = extractNumbers(text).some(
    (token) => !matchNumber(token, allowed),
  );
  if (hasBadNumber) {
    reasons.push("number");
  }

  // Citation checks.
  const { unknownIds, uncitedSentences } = checkCitations(text, a);
  if (unknownIds.length > 0) {
    reasons.push("unknown_id");
  }
  if (uncitedSentences.length > 0) {
    reasons.push("uncited");
  }

  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
