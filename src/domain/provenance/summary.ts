// Deterministic interpretation summary: restates supplied observations and rendered effects.
// It never diagnoses, classifies against thresholds, or recommends anything.
import type { PatientVisualState } from "../mapping/types";
import type { NormalizedPatient } from "../types";

export function interpretationSummary(p: NormalizedPatient, v: PatientVisualState): string[] {
  const out: string[] = [];
  const dx = p.record.diagnoses ?? [];
  if (dx.length) out.push(`Supplied diagnoses (as attributed): ${dx.map((d) => `${d.text}${d.source ? ` — ${d.source}` : ""}`).join("; ")}.`);
  else out.push("No diagnosis supplied.");
  const ok = Object.values(p.observations).filter((o) => o.status === "ok");
  const notUsable = Object.values(p.observations).filter((o) => o.status !== "ok" && o.status !== "null");
  out.push(`${ok.length} usable observation${ok.length === 1 ? "" : "s"} supplied${notUsable.length ? `; ${notUsable.length} kept but not rendered (unit/context problems)` : ""}.`);
  const geom = v.changes.filter((c) => c.evidence !== "illustrative_inference");
  if (geom.length) out.push(`Rendered effects driven by supplied data: ${geom.map((c) => c.summary.replace(/\.$/, "")).join("; ")}.`);
  else out.push("No supplied observation drives the geometry; the heart is shown at the illustration baseline.");
  if (v.unknowns.length) out.push(`Unknown (shown at baseline/default, not normal): ${v.unknowns.map((u) => `${u.structure.toUpperCase()} ${u.property}`).join(", ")}.`);
  out.push("Automatic clinical classification is not performed: no sourced thresholds are configured.");
  return out;
}
