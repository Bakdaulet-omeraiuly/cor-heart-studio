// Stable ids for an Assessment (Requirements 3.2, 7.1).
//
// `withIds()` stamps `F1`, `F2`, … across findings then differential (one shared
// sequence), `E1`, `E2`, … across every evidence item in reading order, and `M1`,
// `M2`, … across `missing[]` in order. The ids
// are deterministic: the same Assessment always yields the same ids, so the server
// can send them to the model and return the identical ids to the client.
//
// `refsFor()` flattens the ided Assessment into a lookup from id → `Ref`, so a cited
// id (`[F2]`, `[E5]`, `[M1]`) resolves to the finding, evidence or missing item it
// names — with the fields the chat panel needs to render a tooltip and move the 3D
// view. A missing item has no `target`/`organ`, so it never moves the view.
import type { Assessment, Evidence, Finding } from "./engine";

type Ided<T> = T & { id: string };

export interface IdedAssessment {
  findings: Ided<Finding & { evidence: Ided<Evidence>[] }>[];
  differential: Ided<Finding & { evidence: Ided<Evidence>[] }>[];
  missing: Ided<{ field: string; why: string }>[];
  redFlags: string[];
  disclaimer: string;
}

export interface Ref {
  id: string;
  kind: "finding" | "evidence" | "missing";
  label: string;
  field?: string;
  value?: number | string;
  unit?: string;
  rule?: string;
  source?: string;
  /** Why a missing item matters (`kind: "missing"` only). */
  why?: string;
  target?: string;
  organ?: "heart" | "brain";
}

/** Label of every missing-item ref; the field and why carry the detail. */
export const MISSING_LABEL = "Missing data";

/**
 * Assign stable ids to every finding, evidence item and missing item.
 *
 * Findings and differential share one `F#` sequence (findings first, then
 * differential, continuing the count). Evidence items share one `E#` sequence in
 * the order they appear while walking findings then differential. Missing items
 * get `M1`, `M2`, … in `missing[]` order. The three sequences are independent but
 * deterministic.
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
    // `redFlags` and `disclaimer` carry no ids; they pass through.
    redFlags: a.redFlags,
    disclaimer: a.disclaimer,
  };
}

/**
 * Build the id → `Ref` lookup for a response. Each finding contributes a `finding`
 * ref (label, target, organ) and each of its evidence items contributes an
 * `evidence` ref (field, value, unit, rule, source) that inherits the parent
 * finding's `target`/`organ` so a cited evidence id can still drive the 3D view.
 * Each missing item contributes a `missing` ref (label "Missing data", field, why)
 * with no `target` or `organ`, so citing it only highlights it in the panel.
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

  return refs;
}
