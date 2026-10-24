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
// prompt.ts only imports types from ids.ts, so this adds no import cycle.
import { SCOPE_TOPICS, SCOPE_TOPIC_ALIASES } from "./prompt";

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
  "%/year", // signed annual rates (brain volume change), engine canonical unit
  "cm\u00B2/m\u00B2", // cm²/m² (indexed valve area) — must win over cm²
  "cm2/m2",
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

// Id tokens the engine uses for citations: findings `F#`, evidence `E#`,
// missing items `M#` and red flags `R#`. We strip them BEFORE extracting numbers
// so the digits inside `[F12]`, `[M2]`, `[R1]` or a bare `E3` are never mistaken
// for a clinical number. The bracketed form and the bare form are both covered; a
// word boundary keeps us from eating the `E` in, say, "ECG".
const ID_TOKEN = /\[(?:F|E|M|R)\d+\]|\b(?:F|E|M|R)\d+\b/g;

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

    // A minus sign directly before the number, itself at the start or after
    // whitespace / an opening bracket / a colon, is a sign ("-4.8 %/year"), not a
    // range separator (ranges have a digit before the hyphen: "40-50").
    const at = match.index ?? 0;
    const prev = cleaned[at - 1];
    const beforePrev = at >= 2 ? cleaned[at - 2] : undefined;
    const negative = (prev === "-" || prev === "\u2212") && (beforePrev === undefined || /[\s([:=]/u.test(beforePrev));

    const token: NumberToken = {
      raw: negative ? `-${raw}` : raw,
      value: negative ? -parseNumber(lowRaw) : parseNumber(lowRaw),
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
  "cm2/m2": "cm\u00B2/m\u00B2", // cm2/m2 → cm²/m²
  "cm\u00B2/m\u00B2": "cm\u00B2/m\u00B2",
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

  // 8. Digits inside the engine's own string values and grades: the CAD-RADS
  //    category ("4A" → 4, "4B" → 4, "3" → 3) and the ACC/AHA stage ("D2" → 2).
  //    They are engine output, not invented numbers, so restating them is fine.
  for (const finding of [...a.findings, ...a.differential]) {
    const strings = [finding.grade, ...finding.evidence.map((e) => (typeof e.value === "string" ? e.value : undefined))];
    for (const text of strings) {
      if (text === undefined) continue;
      for (const m of text.matchAll(/\d+(?:\.\d+)?/gu)) push(Number(m[0]));
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

// Clinical terms (Requirement 6.4, glossary "Clinical term"): cardiac and brain
// measurement or structure terms. A sentence that names one of these is a
// clinical statement, even without a number or grade word, so it must be cited
// ("Low oxygen saturation can lengthen the QT interval." is a claim).
//
// Two groups, because short abbreviations are easy to hit by accident:
//   - `CLINICAL_ABBREVIATIONS` are matched CASE-SENSITIVELY as whole tokens, so
//     "PR" / "EF" / "QT" only match the upper-case abbreviation, never "pr" in
//     "prior", "ef" in "effect" or a lower-case word that happens to be spelled
//     the same.
//   - `CLINICAL_TERMS` are ordinary words/phrases, matched CASE-INSENSITIVELY as
//     whole words. Each entry is a regex fragment covering its sensible
//     singular / plural / adjective forms; multi-word terms allow any run of
//     whitespace between the words.
//
// "Whole" means no letter or digit directly before or after (a lookaround, not
// `\b`, so the `c` in `QTc` and the `/` in `QT/QTc` behave as expected).
const CLINICAL_ABBREVIATIONS = ["QTc", "QTC", "QT", "PR", "QRS", "LVEF", "EF"];

export const CLINICAL_TERMS = [
  String.raw`ejection\s+fractions?`,
  String.raw`ventricles?`,
  String.raw`ventricular`,
  String.raw`atri(?:um|a)`,
  String.raw`atrial`,
  String.raw`valves?`,
  String.raw`valvular`,
  String.raw`stenos[ie]s`,
  String.raw`stenotic`,
  String.raw`regurgitations?`,
  String.raw`regurgitant`,
  String.raw`hypertroph(?:y|ies)`,
  String.raw`hypertrophic`,
  String.raw`coronary`,
  String.raw`coronaries`,
  String.raw`oxygen\s+saturations?`,
  String.raw`blood\s+pressures?`,
  String.raw`heart\s+rates?`,
  String.raw`hippocamp(?:us|i|al)`,
  String.raw`atroph(?:y|ies)`,
  String.raw`atrophic`,
  // Referral terms (task 15.2, Requirements 5.5, 6.4): a red-flag sentence such
  // as "Urgent specialist referral is advised." is a clinical claim and must cite
  // its `[R#]`. Whole words only: refer, refers, referred, referring, referral,
  // referrals — the lookarounds keep "reference", "preference", "referee" out.
  String.raw`refer(?:s|red|ring|rals?)?`,
];

const CLINICAL_ABBREVIATION_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:${CLINICAL_ABBREVIATIONS.join("|")})(?![A-Za-z0-9])`,
  "u",
);
const CLINICAL_TERM_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9])(?:${CLINICAL_TERMS.join("|")})(?![A-Za-z0-9])`,
  "iu",
);

/** Does the sentence name a clinical term (abbreviation or word)? */
export function hasClinicalTerm(sentence: string): boolean {
  return CLINICAL_ABBREVIATION_RE.test(sentence) || CLINICAL_TERM_RE.test(sentence);
}

// --- Refusal / "what I can help with" exception ----------------------------
//
// A refusal that only names a topic and says it is not assessed ("Oxygen
// saturation is not something I assess.") and a sentence listing what the
// assistant covers ("I can help with aortic stenosis, LV function and QTc.")
// mention clinical terms without making a claim, so they do not trip the
// clinical-term check. The exception is deliberately narrow: the WHOLE sentence
// must fit one of the templates below, and the topic / list items must be short
// noun phrases with no verb, modal or clause word. So "Low oxygen saturation can
// strain the heart and lengthen the QT interval." (no template) and "Low oxygen
// saturation lengthens QT, which is not something I assess." (clause word in the
// topic) are still clinical. The exception never overrides a number, a grade
// word or a finding label in an ordinary item: those keep a sentence clinical.
//
// Scope topics (task 15.1, Requirements 5.6, 6.2, 6.4): a list item that IS one
// of our own scope topics (`SCOPE_TOPICS` or a `SCOPE_TOPIC_ALIASES` short form,
// case-insensitive, whitespace collapsed) is accepted as is, even though
// "coronary stenosis graded by CAD-RADS 2.0" holds a grade word and a number and
// "QTc" / "aortic stenosis" may equal a finding's condition or label. Such items
// are cut out of the sentence (`refusalOrHelpResidual`) before the number, grade
// word and finding checks run, so they neither make the sentence clinical nor
// have their "2.0" checked as a record number. Every other item still has to be
// a short noun phrase, and whatever is left keeps all the usual checks.

// Words that turn a would-be topic or list item into a claim: modals, auxiliaries,
// common causal/effect verbs and clause words.
const CLAIM_WORDS = new Set([
  "is", "are", "was", "were", "be", "been", "being", "has", "have", "had",
  "can", "could", "may", "might", "will", "would", "should", "must", "does", "do", "did",
  "cause", "causes", "caused", "causing", "lead", "leads", "leading",
  "lengthen", "lengthens", "lengthening", "shorten", "shortens", "shortening",
  "prolong", "prolongs", "prolonging", "increase", "increases", "increasing",
  "decrease", "decreases", "decreasing", "raise", "raises", "raising",
  "lower", "lowers", "lowering", "strain", "strains", "straining",
  "indicate", "indicates", "indicating", "suggest", "suggests", "suggesting",
  "show", "shows", "showing", "mean", "means", "affect", "affects", "affecting",
  "worsen", "worsens", "worsening", "improve", "improves", "improving",
  "because", "which", "that", "who", "if", "when", "while", "so", "but", "since",
]);

// Up to this many words per topic / list item: enough for "left ventricular
// function" or "questions about aortic stenosis", too few for a full claim.
const MAX_TOPIC_WORDS = 6;

/** Is `phrase` a short noun phrase (no claim word, at most MAX_TOPIC_WORDS words)? */
function isTopicPhrase(phrase: string): boolean {
  const words = phrase.trim().split(/\s+/u).filter((w) => w.length > 0);
  if (words.length === 0 || words.length > MAX_TOPIC_WORDS) return false;
  return words.every(
    (w) => /^[\p{L}\p{N}'’/-]+$/u.test(w) && !CLAIM_WORDS.has(w.toLowerCase()),
  );
}

/** Escape a literal for a RegExp; runs of whitespace match any whitespace run. */
/**
 * With `caseless`, each ASCII letter becomes a `[xX]` class, for use inside a
 * regex that is itself case-sensitive.
 */
function phrasePattern(phrase: string, caseless = false): string {
  return phrase
    .trim()
    .split(/\s+/u)
    .map((word) => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return caseless
        ? escaped.replace(/[A-Za-z]/gu, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`)
        : escaped;
    })
    .join(String.raw`\s+`);
}

// Every phrase that counts as a scope topic, longest first so the alternation
// prefers "coronary stenosis graded by CAD-RADS 2.0" over "coronary stenosis".
const SCOPE_PHRASES = [...new Set([...SCOPE_TOPICS, ...SCOPE_TOPIC_ALIASES])].sort(
  (x, y) => y.length - x.length,
);
const SCOPE_ALT = SCOPE_PHRASES.map((t) => phrasePattern(t)).join("|");

// Item separators in a topic list: ", ", ", and ", " and ", " or ".
const ITEM_SEP = String.raw`\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+`;

// One list item at the current position: a whole scope topic (only when an
// item boundary follows it, so "aortic stenosis severity" is an ordinary item),
// otherwise the text up to the next separator. Sticky, so it is anchored at
// `lastIndex`.
const LIST_ITEM_RE = new RegExp(String.raw`(?:(${SCOPE_ALT})|(.+?))(?=${ITEM_SEP}|$)`, "iuy");
const ITEM_SEP_RE = new RegExp(String.raw`(?:${ITEM_SEP})`, "iuy");

/**
 * Parse a comma / "and" / "or" separated topic list. Returns the items that are
 * NOT scope topics, or null when the list is empty or one of those items is not
 * a short noun phrase. Scope-topic items are accepted as is.
 */
function nonScopeItems(list: string): string[] | null {
  const others: string[] = [];
  let count = 0;
  let at = 0;
  while (at < list.length) {
    LIST_ITEM_RE.lastIndex = at;
    const item = LIST_ITEM_RE.exec(list);
    if (!item) return null;
    count += 1;
    if (item[1] === undefined) {
      if (!isTopicPhrase(item[2])) return null;
      others.push(item[2].trim());
    }
    at = LIST_ITEM_RE.lastIndex;
    ITEM_SEP_RE.lastIndex = at;
    if (ITEM_SEP_RE.exec(list)) at = ITEM_SEP_RE.lastIndex;
    else if (at < list.length) return null;
  }
  return count > 0 ? others : null;
}

const NEG = String.raw`(?:do\s+not|don['’]t|cannot|can['’]t|can\s+not|am\s+not\s+able\s+to|am\s+unable\s+to|won['’]t)`;
const ASSESS_VERB = String.raw`(?:assess|evaluate|interpret|cover|grade|comment\s+on|answer\s+questions\s+(?:about|on))`;
// Optional "here" / "in this app" / "from this record"-style tail.
const TAIL = String.raw`(?:\s+(?:here|in\s+this\s+(?:app|tool|chat|assessment)|from\s+(?:this|the)\s+(?:record|data)|for\s+this\s+patient))?`;
const LEAD = String.raw`(?:(?:sorry|unfortunately|however)\s*,?\s+)?`;

// "<topic> is/are not something I (can) assess", "<topic> is not assessed",
// "<topic> is not part of this assessment", "<topic> is outside what I assess", …
const REFUSAL_TOPIC_FIRST = new RegExp(
  String.raw`^${LEAD}(.+?)\s+(?:is|are)(?:\s+not|n['’]t)\s+(?:something|anything|a\s+topic|one)\s+(?:that\s+)?I\s+(?:can\s+)?${ASSESS_VERB}${TAIL}$`
  + "|"
  + String.raw`^${LEAD}(.+?)\s+(?:is|are)(?:\s+not|n['’]t)\s+(?:assessed|evaluated|covered|graded|part\s+of\s+(?:this|the|my)\s+assessment)${TAIL}$`
  + "|"
  + String.raw`^${LEAD}(.+?)\s+(?:is|are)\s+(?:outside|beyond)\s+(?:the\s+scope\s+of\s+)?(?:what\s+I\s+(?:can\s+)?${ASSESS_VERB}|this\s+assessment|my\s+scope)${TAIL}$`,
  "iud",
);

// "I don't assess <topic>", "I cannot comment on <topic> here", …
const REFUSAL_I_FIRST = new RegExp(
  String.raw`^${LEAD}I\s+${NEG}\s+${ASSESS_VERB}\s+(.+?)${TAIL}$`,
  "iud",
);

// "I can help with <list>", "What I can help with is <list>", "I can answer
// questions about <list>", optionally introduced by "But"/"However,"/"Instead,".
const HELP_WITH = new RegExp(
  String.raw`^(?:(?:but|however|instead)\s*,?\s+)?(?:I\s+can\s+(?:help|assist)\s+(?:you\s+)?with|I\s+can\s+answer\s+questions\s+(?:about|on)|What\s+I\s+can\s+(?:help|assist)\s+with\s+(?:is|are|includes?)|I\s+cover)\s*:?\s+(.+)$`,
  "iud",
);

/**
 * If the sentence is a refusal that only names a topic, or a "what I can help
 * with" list, return it with its scope-topic items cut out (the "residual");
 * otherwise return null. Ids and the trailing full stop are ignored for the
 * match. The residual keeps the template words and every non-scope item, so the
 * number, grade-word and finding checks still see everything except our own
 * scope topics.
 */
export function refusalOrHelpResidual(sentence: string): string | null {
  const core = sentence
    .replace(ID_TOKEN, " ")
    .replace(/[.!?]+\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();

  for (const template of [REFUSAL_TOPIC_FIRST, REFUSAL_I_FIRST, HELP_WITH]) {
    const match = template.exec(core);
    if (!match) continue;
    // The one capture group that took part holds the topic / list.
    const group = match.findIndex((g, i) => i > 0 && g !== undefined);
    const span = match.indices?.[group];
    if (group < 1 || span === undefined) return null;
    const others = nonScopeItems(match[group]);
    if (others === null) return null;
    return `${core.slice(0, span[0])}${others.join(", ")}${core.slice(span[1])}`;
  }
  return null;
}

/**
 * Is the sentence a refusal that only names a topic, or a "what I can help
 * with" list? Ids and the trailing full stop are ignored for the match.
 */
export function isRefusalOrHelpSentence(sentence: string): boolean {
  return refusalOrHelpResidual(sentence) !== null;
}

// Id-token recognition, mirroring `ID_TOKEN` above but WITHOUT the global flag so
// we can `.test()` / `.match()` per sentence without carrying `lastIndex` state
// between calls. Captures the id itself (dropping the optional brackets) so we
// can compare it against the known set. Covers both `[F2]`/`[E5]`/`[M1]`/`[R1]`
// and bare `F2`/`E5`/`M1`/`R1`; the word boundary keeps the `E` in "ECG" from
// matching.
const ID_TOKEN_CAPTURE = /\[((?:F|E|M|R)\d+)\]|\b((?:F|E|M|R)\d+)\b/gu;

/**
 * Collect the set of ids the Assessment actually produced.
 *
 * Every finding (and differential entry) carries an `F#` id, every evidence
 * item an `E#` id, every missing item an `M#` id and every red flag an `R#` id
 * (stamped by `withIds`). An `[M#]` citation therefore satisfies a missing-data
 * sentence and an `[R#]` citation a red-flag sentence. Any id token in the reply
 * that is not in this set (including an `M#`/`R#` past the end of its list) was
 * invented by the model and is reported as unknown.
 */
function knownIds(a: IdedAssessment): Set<string> {
  const ids = new Set<string>();
  for (const finding of [...a.findings, ...a.differential]) {
    ids.add(finding.id);
    for (const evidence of finding.evidence) {
      ids.add(evidence.id);
    }
  }
  for (const m of a.missing) {
    ids.add(m.id);
  }
  for (const flag of a.redFlags) {
    ids.add(flag.id);
  }
  return ids;
}

/**
 * Pull every id token out of a string.
 *
 * Returns the bare ids (`F2`, `E5`, `M1`) regardless of whether they were written
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
// Scope topics that end in a digit ("… CAD-RADS 2.0"): a full stop right after
// one of them DOES end the sentence, despite the digit guard above, so
// "I can help with coronary stenosis graded by CAD-RADS 2.0. The valve is
// severe." splits into two sentences. Letters become `[xX]` classes because the
// split regex is case-sensitive (its id patterns must stay upper-case).
const SCOPE_DIGIT_END = SCOPE_PHRASES.filter((t) => /\d$/u.test(t))
  .map((t) => phrasePattern(t, true))
  .join("|") || "(?!)"; // never matches when no scope topic ends in a digit
const SENTENCE_SPLIT = new RegExp(
  String.raw`(?<=(?:(?<!\d)[.!?]|(?<![A-Za-z0-9])(?:${SCOPE_DIGIT_END})\.)(?:[ \t]*\[(?:F|E|M|R)\d+\])*)\s+(?![ \t]*\[(?:F|E|M|R)\d+\])`,
  "u",
);

function splitSentences(text: string): string[] {
  // Split on: (a '.' not preceded by a digit, OR a '!'/'?'), optionally followed by
  // citation ids, then whitespace. The alternation keeps `!`/`?` unconditional
  // while only the period carries the decimal-point guard. Lookbehind is
  // supported by the target runtime (Node).
  //
  // Citations written AFTER the full stop ("… rule-defined. [F1]") belong to the
  // sentence they follow — the live check (task 7.4) showed the model writes
  // them this way. So the split never happens between the punctuation and a
  // following `[F#]`/`[E#]`/`[M#]`/`[R#]` (negative lookahead), and does happen
  // after such a trailing citation group (the optional group inside the
  // lookbehind). A citation group only ever attaches to the ONE sentence directly
  // before it; it never covers earlier sentences on the same line.
  //
  // The one exception to the digit guard is `SCOPE_DIGIT_END` (a full stop right
  // after a scope topic that ends in a digit, see above).
  const parts = text.split(SENTENCE_SPLIT);
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
 *     sentence is clinical if it contains a number, a grade word, a finding
 *     label/condition from the Assessment (case-insensitive substring), or a
 *     clinical term (`CLINICAL_TERMS` / abbreviations, whole words). Note a
 *     sentence whose only id is an unknown one is still uncited — the test is for
 *     a KNOWN id, so an invented citation does not satisfy it (and the unknown id
 *     is independently reported in `unknownIds`).
 *
 * Refusal and "what I can help with" sentences carry no number, grade word or
 * finding label. They often name clinical terms, so a sentence that fits the
 * narrow refusal / help-list templates (`isRefusalOrHelpSentence`) is exempt
 * from the clinical-term check; it needs no citation. Its scope-topic items are
 * also cut out before the number, grade-word and finding checks, so listing
 * "coronary stenosis graded by CAD-RADS 2.0" or "QTc" does not make it clinical.
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
    // For a refusal / help-list sentence, check only what is left after its
    // scope-topic items are cut out (see `refusalOrHelpResidual`).
    const residual = refusalOrHelpResidual(sentence);
    const checked = residual ?? sentence;
    const lower = checked.toLowerCase();

    const hasNumber = extractNumbers(checked).length > 0;
    const hasGradeWord = GRADE_WORD_RE.test(checked);
    const mentionsFinding = findingTerms.some((term) => lower.includes(term));
    // A clinical term counts unless the sentence is a refusal that only names
    // the topic or a "what I can help with" list.
    const mentionsTerm = residual === null && hasClinicalTerm(sentence);

    const isClinical = hasNumber || hasGradeWord || mentionsFinding || mentionsTerm;
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
 * The reply with every refusal / help-list sentence replaced by its residual
 * (scope-topic items cut out); all other text, including line structure, is
 * kept as is. Input to the number check.
 */
function withoutScopeTopics(text: string): string {
  let out = "";
  let cursor = 0;
  for (const sentence of splitSentences(text)) {
    const at = text.indexOf(sentence, cursor);
    if (at < 0) continue;
    out += text.slice(cursor, at) + (refusalOrHelpResidual(sentence) ?? sentence);
    cursor = at + sentence.length;
  }
  return out + text.slice(cursor);
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
  // Scope topics listed in refusal / help sentences are cut out first, so the
  // "2.0" in "CAD-RADS 2.0" is not checked as a record number (Req 6.2).
  const hasBadNumber = extractNumbers(withoutScopeTopics(text)).some(
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
