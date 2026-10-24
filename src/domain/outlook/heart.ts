// Heart outlook: read today's aortic stenosis measurements from a record and write a projected copy
// that the ordinary mapping engine renders (so the projected heart obeys the same rules as a real record).
import type { NormalizedPatient, NormalizedValveFinding } from "../types";
import { gradeToSeverity, type AsProjection } from "./project";

export interface AsBaseline {
  ava: number | null;
  vmax: number | null;
}

const AREA_UNITS = new Set(["cm2", "cm²", "cm^2"]);

/** Valve area (cm²) and peak velocity (m/s) of a reported aortic stenosis, when both are usable. */
export function readAsBaseline(p: NormalizedPatient): AsBaseline {
  const f = p.valveFindings.find((v) => v.valve === "aortic_valve" && v.condition === "stenosis");
  const m = (label: string, ok: (u: string) => boolean) => {
    const x = f?.measurements.find((q) => q.label === label && q.status === "ok" && q.value != null && q.unit && ok(q.unit.trim().toLowerCase()));
    return x ? x.value! : null;
  };
  return { ava: m("Valve area", (u) => AREA_UNITS.has(u)), vmax: m("Peak velocity", (u) => u === "m/s") };
}

/** A copy of the record whose aortic stenosis is replaced by the projection (all other findings kept). */
export function withProjectedAorticStenosis(p: NormalizedPatient, proj: AsProjection, keySuffix: string): NormalizedPatient {
  const finding: NormalizedValveFinding = {
    valve: "aortic_valve",
    condition: "stenosis",
    severity: gradeToSeverity(proj.grade),
    source: `COR Outlook projection (+${proj.years} y, Otto 1997 rates)`,
    measurements: [
      { label: "Valve area", value: Math.round(proj.ava * 100) / 100, unit: "cm2", status: "ok" },
      { label: "Peak velocity", value: Math.round(proj.vmax * 100) / 100, unit: "m/s", status: "ok" },
    ],
    note: "Projected from cohort-average progression; not a measurement.",
    evidence: "reported_assessment",
  };
  const others = p.valveFindings.filter((v) => !(v.valve === "aortic_valve" && v.condition === "stenosis"));
  return {
    ...p,
    key: `${p.key}${keySuffix}`,
    displayName: `${p.displayName ?? p.patientId} · ${proj.years === 0 ? "today" : `+${proj.years} y (projected)`}`,
    valveFindings: proj.grade === "none" ? others : [...others, finding],
  };
}
