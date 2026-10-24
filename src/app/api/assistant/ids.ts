// Stable ids for an Assessment (Requirements 3.2, 7.1).
//
// `withIds()` stamps `F1`, `F2`, … across findings then differential (one shared
// sequence), `E1`, `E2`, … across every evidence item in reading order, `M1`,
// `M2`, … across `missing[]` in order, and `R1`, `R2`, … across `redFlags` in
// order (each engine string becomes `{ id, text }`). The ids are deterministic:
// the same Assessment always yields the same ids, so the server can send them to
// the model and return the identical ids to the client.
//
// `refsFor()` flattens the ided Assessment into a lookup from id → `Ref`, so a cited
// id (`[F2]`, `[E5]`, `[M1]`, `[R1]`) resolves to the finding, evidence, missing
// item or red flag it names — with the fields the chat panel needs to render a
// tooltip and move the 3D view. Missing items and red flags have no
// `target`/`organ`, so they never move the view.
import type { Assessment, Evidence, Finding } from "./engine";

type Ided<T> = T & { id: string };

export interface IdedAssessment {
  findings: Ided<Finding & { evidence: Ided<Evidence>[] }>[];
  differential: Ided<Finding & { evidence: Ided<Evidence>[] }>[];
  missing: Ided<{ field: string; why: string }>[];
  /** The engine's `redFlags` strings, each wrapped as `{ id: "R#", text }`. */
  redFlags: Ided<{ text: string }>[];
  disclaimer: string;
}

export interface Ref {
  id: string;
  kind: "finding" | "evidence" | "missing" | "redFlag";
  label: string;
  field?: string;
  value?: number | string;
  unit?: string;
  rule?: string;
  source?: string;
  /** Why a missing item matters (`kind: "missing"` only). */
  why?: string;
  /** The red flag's text (`kind: "redFlag"` only). */
  text?: string;
  target?: string;
  organ?: "heart" | "brain";
}

/** Label of every missing-item ref; the field and why carry the detail. */
export const MISSING_LABEL = "Missing data";

/** Label of every red-flag ref; the text carries the detail. */
export const RED_FLAG_LABEL = "Red flag";

/**
 * Assign stable ids to every finding, evidence item, missing item and red flag.
 *
 * Findings and differential share one `F#` sequence (findings first, then
 * differential, continuing the count). Evidence items share one `E#` sequence in
 * the order they appear while walking findings then differential. Missing items
 * get `M1`, `M2`, … in `missing[]` order and red flags `R1`, `R2`, … in
 * `redFlags` order. The four sequences are independent but deterministic.
 */
export function withIds(a: Assessment): IdedAssessment {
  let nextFinding = 1;
  let nextEvidence = 1;

  const stamp = (
    finding: Finding,
  ): Ided<Finding & { evidence: Ided<Evidence>[] }> => ({
    ...finding,
    id: `F${nextFinding++}`,
    evidence: finding.evidence.map((evidence) => ({
      ...evidence,
      id: `E${nextEvidence++}`,
    })),
  });

  return {
    findings: a.findings.map(stamp),
    differential: a.differential.map(stamp),
    missing: a.missing.map((m, i) => ({ ...m, id: `M${i + 1}` })),
    redFlags: a.redFlags.map((text, i) => ({ id: `R${i + 1}`, text })),
    // `disclaimer` carries no id; it passes through.
    disclaimer: a.disclaimer,
  };
}

/**
 * Build the id → `Ref` lookup for a response. Each finding contributes a `finding`
 * ref (label, target, organ) and each of its evidence items contributes an
 * `evidence` ref (field, value, unit, rule, source) that inherits the parent
 * finding's `target`/`organ` so a cited evidence id can still drive the 3D view.
 * Each missing item contributes a `missing` ref (label "Missing data", field, why)
 * and each red flag a `redFlag` ref (label "Red flag", text), both with no
 * `target` or `organ`, so citing them only highlights them in the panel.
 */
export function refsFor(a: IdedAssessment): Record<string, Ref> {
  const refs: Record<string, Ref> = {};

  for (const finding of [...a.findings, ...a.differential]) {
    refs[finding.id] = {
      id: finding.id,
      kind: "finding",
      label: finding.label,
      organ: finding.organ,
      ...(finding.target !== undefined ? { target: finding.target } : {}),
    };

    for (const evidence of finding.evidence) {
      refs[evidence.id] = {
        id: evidence.id,
        kind: "evidence",
        label: finding.label,
        field: evidence.field,
        value: evidence.value,
        rule: evidence.rule,
        source: evidence.source,
        organ: finding.organ,
        ...(evidence.unit !== undefined ? { unit: evidence.unit } : {}),
        ...(finding.target !== undefined ? { target: finding.target } : {}),
      };
    }
  }

  for (const m of a.missing) {
    refs[m.id] = { id: m.id, kind: "missing", label: MISSING_LABEL, field: m.field, why: m.why };
  }

  for (const flag of a.redFlags) {
    refs[flag.id] = { id: flag.id, kind: "redFlag", label: RED_FLAG_LABEL, text: flag.text };
  }

  return refs;
}
