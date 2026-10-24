// Stable ids for an Assessment (Requirements 3.2, 7.1).
//
// `withIds()` stamps `F1`, `F2`, … across findings then differential (one shared
// sequence) and `E1`, `E2`, … across every evidence item in reading order. The ids
// are deterministic: the same Assessment always yields the same ids, so the server
// can send them to the model and return the identical ids to the client.
//
// `refsFor()` flattens the ided Assessment into a lookup from id → `Ref`, so a cited
// id (`[F2]`, `[E5]`) resolves to the finding or evidence it names — with the fields
// the chat panel needs to render a tooltip and move the 3D view.
import type { Assessment, Evidence, Finding } from "./engine";

type Ided<T> = T & { id: string };

export interface IdedAssessment {
  findings: Ided<Finding & { evidence: Ided<Evidence>[] }>[];
  differential: Ided<Finding & { evidence: Ided<Evidence>[] }>[];
  missing: { field: string; why: string }[];
  redFlags: string[];
  disclaimer: string;
}

export interface Ref {
  id: string;
  kind: "finding" | "evidence";
  label: string;
  field?: string;
  value?: number | string;
  unit?: string;
  rule?: string;
  source?: string;
  target?: string;
  organ?: "heart" | "brain";
}

/**
 * Assign stable ids to every finding and evidence item.
 *
 * Findings and differential share one `F#` sequence (findings first, then
 * differential, continuing the count). Evidence items share one `E#` sequence in
 * the order they appear while walking findings then differential. A `counter`
 * closure keeps the two sequences independent but deterministic.
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
    missing: a.missing,
    redFlags: a.redFlags,
    disclaimer: a.disclaimer,
    // `missing`, `redFlags` and `disclaimer` carry no ids; they pass through.
  };
}

/**
 * Build the id → `Ref` lookup for a response. Each finding contributes a `finding`
 * ref (label, target, organ) and each of its evidence items contributes an
 * `evidence` ref (field, value, unit, rule, source) that inherits the parent
 * finding's `target`/`organ` so a cited evidence id can still drive the 3D view.
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

  return refs;
}
