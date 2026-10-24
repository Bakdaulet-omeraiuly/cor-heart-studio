// Heart outlook: read today's aortic stenosis measurements from a record and write a projected copy
// that the ordinary mapping engine renders (so the projected heart obeys the same rules as a real record).
import type { NormalizedObservation, NormalizedPatient, NormalizedValveFinding } from "../types";
import { FIELD_BY_PATH } from "../schema/fields";
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

export interface LvhBaseline {
  ivsMm: number | null;
  pwMm: number | null;
  lvidMm: number | null;
  bsaM2: number | null;
}

/** End-diastolic septum, posterior wall, LV diameter and derived BSA, when usable. */
export function readLvhBaseline(p: NormalizedPatient): LvhBaseline {
  const v = (path: string) => (p.observations[path]?.status === "ok" ? p.observations[path].value ?? null : null);
  return {
    ivsMm: v("observations.ivsThickness"),
    pwMm: v("observations.lvPosteriorWallThickness"),
    lvidMm: v("observations.lvEndDiastolicDiameter"),
    bsaM2: p.derived.find((d) => d.id === "bsaMosteller")?.value ?? null,
  };
}

/** A copy of the record with projected septal / posterior wall thickness (all else unchanged). */
export function withProjectedWalls(p: NormalizedPatient, ivsMm: number, pwMm: number, keySuffix: string, label: string): NormalizedPatient {
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const set = (path: string, value: number) => {
    const f = FIELD_BY_PATH.get(path)!;
    const o: NormalizedObservation = p.observations[path] ?? {
      path, label: f.label, short: f.short, category: f.category, rendering: f.rendering,
      original: { value, unit: "mm" }, value, unit: "mm", status: "ok", evidence: "reported_measurement",
    };
    return { ...o, status: "ok" as const, value: r1(value), unit: "mm", source: `COR Outlook projection (${label})` };
  };
  return {
    ...p,
    key: `${p.key}${keySuffix}`,
    displayName: `${p.displayName ?? p.patientId} · ${label}`,
    observations: { ...p.observations, "observations.ivsThickness": set("observations.ivsThickness", ivsMm), "observations.lvPosteriorWallThickness": set("observations.lvPosteriorWallThickness", pwMm) },
  };
}
