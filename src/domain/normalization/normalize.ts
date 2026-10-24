// One normalization adapter: raw record -> validated, unit-normalized observations + derived values.
// Original values are preserved alongside every normalized value.
import type { z } from "zod";
import { FIELDS, convertUnit, type FieldDef } from "../schema/fields";
import { KNOWN_TOP_LEVEL_KEYS, PatientRecordSchema, type PatientRecord } from "../schema/record";
import {
  recordKey, type DerivedValue, type Issue, type NormalizedObservation, type NormalizedPatient,
  type NormalizedValveFinding, type NormalizedWallThickness, type ObservationStatus,
} from "../types";

export type NormalizeResult =
  | { ok: true; patient: NormalizedPatient }
  | { ok: false; issues: Issue[]; patientId?: string; studyId?: string };

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

const SUGGEST: Record<string, string> = {
  patientId: "Add a stable identifier such as \"SYN-001\".",
  studyId: "Add a study identifier so two examinations of one patient never overwrite each other, e.g. \"STUDY-001-A\".",
};

function zodIssues(err: z.ZodError): Issue[] {
  return err.issues.map((i) => {
    const path = i.path.join(".");
    const head = String(i.path[0] ?? "");
    let message = i.message;
    if (i.code === "invalid_type" && (i as { input?: unknown }).input === undefined) message = "Required field is missing";
    return {
      severity: "error" as const,
      code: `schema.${i.code}`,
      path,
      message,
      suggestion: SUGGEST[head] ?? (i.code === "invalid_value" ? "Use one of the documented values (see the data dictionary)." : undefined),
    };
  });
}

/** Contextual requirements for geometry-driving fields. Returns a reason when context contradicts. */
function contextProblem(def: FieldDef, phase: string | undefined, indexed: boolean | undefined): string | null {
  if (indexed) return "Indexed value (per body surface area); an absolute value is required to drive geometry.";
  if (!phase) return null; // the field definition itself implies the phase (e.g. "end-diastolic")
  const p = phase.toLowerCase().replace(/[\s-]+/g, "_");
  const expectsDiastole = /EndDiastolic|ivsThickness|lvPosteriorWall/.test(def.path);
  const expectsSystole = /EndSystolic/.test(def.path);
  if (expectsDiastole && /systol/.test(p) && !/diastol/.test(p)) return `Phase "${phase}" contradicts an end-diastolic measurement.`;
  if (expectsSystole && /diastol/.test(p) && !/systol/.test(p)) return `Phase "${phase}" contradicts an end-systolic measurement.`;
  return null;
}

function normalizeObservation(def: FieldDef, raw: unknown, issues: Issue[]): NormalizedObservation | null {
  if (raw === undefined) return null;
  const o = (typeof raw === "number" ? { value: raw } : raw) as {
    value: number | null; unit?: string; source?: string; observedAt?: string; method?: string; phase?: string;
    location?: string; axis?: string; indexed?: boolean; note?: string;
  };
  const base = {
    path: def.path, label: def.label, short: def.short, category: def.category, rendering: def.rendering,
    original: { value: o.value, unit: o.unit }, unit: def.canonicalUnit, source: o.source, observedAt: o.observedAt,
    method: o.method, phase: o.phase, location: o.location, axis: o.axis, indexed: o.indexed, note: o.note,
    evidence: "reported_measurement" as const,
  };
  if (o.value === null) return { ...base, value: null, status: "null", statusMessage: "Explicitly unknown" };
  const conv = convertUnit(def, o.value, o.unit);
  if (!conv.ok) {
    const missing = conv.reason === "missing";
    issues.push({
      severity: "warning", code: missing ? "unit.missing" : "unit.unknown", path: def.path,
      message: missing ? `${def.label}: unit not supplied; value kept but not used for rendering.` : `${def.label}: unit "${o.unit}" is not supported; value kept but not used for rendering.`,
      suggestion: `Use ${Object.keys(def.units).slice(0, 3).map((u) => `"${u}"`).join(", ")} (canonical: ${def.canonicalUnit}).`,
    });
    return { ...base, value: null, status: missing ? "unit_missing" : "unit_unknown", statusMessage: missing ? "Unit missing" : `Unsupported unit "${o.unit}"` };
  }
  const v = conv.value;
  const { min, max, exclusiveMin } = def.impossible;
  if ((min !== undefined && (exclusiveMin ? v <= min : v < min)) || (max !== undefined && v > max)) {
    issues.push({
      severity: "error", code: "value.impossible", path: def.path,
      message: `${def.label} ${o.value} ${o.unit ?? ""} is outside physically possible input bounds (${exclusiveMin ? ">" : "≥"}${min ?? "-∞"}, ≤${max ?? "∞"} ${def.canonicalUnit}). The value is excluded.`,
      suggestion: "Check for a typo or a unit mix-up (e.g. cm entered as mm).",
    });
    return { ...base, value: null, status: "impossible", statusMessage: "Physically impossible input" };
  }
  const ctx = def.rendering === "drives_geometry" ? contextProblem(def, o.phase, o.indexed) : null;
  if (ctx) {
    issues.push({ severity: "warning", code: "context.mismatch", path: def.path, message: `${def.label}: ${ctx}` });
    return { ...base, value: v, status: "context_mismatch", statusMessage: ctx };
  }
  return { ...base, value: v, status: "ok" };
}

const SEPTAL = [2, 3, 8, 9, 14];
const INFEROLATERAL = [5, 11];
const REGION_SEGMENTS: Record<string, number[]> = {
  septum: SEPTAL, posterior: INFEROLATERAL, anterior: [1, 7, 13], lateral: [6, 12, 16], inferior: [4, 10, 15], apex: [17],
};

const sameTime = (a?: string, b?: string) => !a || !b || a.slice(0, 10) === b.slice(0, 10);

export function normalizeRecord(raw: unknown): NormalizeResult {
  const parsed = PatientRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    return { ok: false, issues: zodIssues(parsed.error), patientId: typeof r.patientId === "string" ? r.patientId : undefined, studyId: typeof r.studyId === "string" ? r.studyId : undefined };
  }
  const rec: PatientRecord = parsed.data;
  const issues: Issue[] = [];
  const observations: Record<string, NormalizedObservation> = {};

  const unrecognized = Object.keys(raw as object).filter((k) => !KNOWN_TOP_LEVEL_KEYS.has(k));
  for (const k of unrecognized) issues.push({ severity: "info", code: "field.unrecognized", path: k, message: `Unrecognized field "${k}" preserved in the original record but not used.` });
  const knownObs = new Set(FIELDS.filter((f) => f.path.startsWith("observations.")).map((f) => f.path.slice(13)));
  for (const k of Object.keys(rec.observations ?? {})) {
    if (!knownObs.has(k)) issues.push({ severity: "info", code: "observation.unsupported", path: `observations.${k}`, message: `Observation "${k}" is not in the data dictionary; preserved and listed as unsupported.` });
  }

  for (const def of FIELDS) {
    const n = normalizeObservation(def, getPath(rec, def.path), issues);
    if (n) observations[def.path] = n;
  }
  // QTc correction method travels with the QTc value
  if (observations["ecg.qtc"] && rec.ecg?.qtcCorrectionMethod) observations["ecg.qtc"].method ??= rec.ecg.qtcCorrectionMethod;

  // ---- consistency checks (never silently "fix" a value)
  const ok = (p: string) => (observations[p]?.status === "ok" ? observations[p] : undefined);
  const edv = ok("observations.lvEndDiastolicVolume"), esv = ok("observations.lvEndSystolicVolume");
  const derived: DerivedValue[] = [];
  if (edv && esv) {
    if (esv.value! >= edv.value!) {
      for (const p of ["observations.lvEndDiastolicVolume", "observations.lvEndSystolicVolume"]) {
        observations[p] = { ...observations[p], status: "contradiction", statusMessage: "ESV ≥ EDV" };
      }
      issues.push({ severity: "error", code: "volumes.contradiction", path: "observations.lvEndSystolicVolume",
        message: `LVESV (${esv.value} mL) is not smaller than LVEDV (${edv.value} mL). Both volumes are excluded from rendering.`,
        suggestion: "Check whether the two volumes were swapped." });
    } else {
      const ef = (100 * (edv.value! - esv.value!)) / edv.value!;
      derived.push({ id: "lvEfFromVolumes", label: "LV ejection fraction (from volumes)", value: Math.round(ef * 10) / 10, unit: "%",
        formula: "EF = 100 × (EDV − ESV) / EDV", inputs: [edv.path, esv.path], evidence: "derived",
        note: sameTime(edv.observedAt, esv.observedAt) ? undefined : "Volumes have different observation dates." });
      derived.push({ id: "lvStrokeVolumeFromVolumes", label: "LV stroke volume (from volumes)", value: Math.round((edv.value! - esv.value!) * 10) / 10, unit: "mL",
        formula: "SV = EDV − ESV", inputs: [edv.path, esv.path], evidence: "derived" });
      const efRep = ok("observations.lvEjectionFraction");
      if (efRep && Math.abs(efRep.value! - ef) > 5) {
        issues.push({ severity: "warning", code: "ef.conflict", path: "observations.lvEjectionFraction",
          message: `Reported LVEF ${efRep.value}% differs from the volume-derived EF ${ef.toFixed(1)}% by more than 5 points. Rendering uses the volumes; both values are shown.`,
          suggestion: "Confirm whether EF and volumes come from the same method and examination." });
      }
      if (efRep && !sameTime(efRep.observedAt, edv.observedAt)) {
        issues.push({ severity: "info", code: "time.mismatch", path: "observations.lvEjectionFraction", message: "LVEF and LV volumes have different observation dates; they are not treated as one simultaneous state." });
      }
    }
  }
  const edd = ok("observations.lvEndDiastolicDiameter"), esd = ok("observations.lvEndSystolicDiameter");
  if (edd && esd && esd.value! >= edd.value!) {
    issues.push({ severity: "warning", code: "diameters.contradiction", path: "observations.lvEndSystolicDiameter", message: "LVESD is not smaller than LVEDD; check the measurements." });
  }
  const sbp = ok("observations.systolicBP"), dbp = ok("observations.diastolicBP");
  if (sbp && dbp && dbp.value! >= sbp.value!) {
    issues.push({ severity: "warning", code: "bp.contradiction", path: "observations.diastolicBP", message: "Diastolic pressure is not lower than systolic pressure; check the entry." });
  }
  const h = ok("demographics.heightCm"), w = ok("demographics.weightKg");
  if (h && w) {
    const bsa = Math.sqrt((h.value! * w.value!) / 3600);
    derived.push({ id: "bsaMosteller", label: "Body surface area (Mosteller)", value: Math.round(bsa * 100) / 100, unit: "m²",
      formula: "BSA = √(height[cm] × weight[kg] / 3600)", inputs: [h.path, w.path], evidence: "derived" });
  }

  // ---- valves
  const valveFindings: NormalizedValveFinding[] = (rec.valveFindings ?? []).map((v) => {
    const meas = ([["valveArea", "Valve area"], ["peakGradient", "Peak gradient"], ["meanGradient", "Mean gradient"], ["peakVelocity", "Peak velocity"]] as const)
      .filter(([k]) => v[k] !== undefined)
      .map(([k, label]) => {
        const o = v[k] as { value: number | null; unit?: string };
        const status: ObservationStatus = o.value === null ? "null" : o.unit ? "ok" : "unit_missing";
        return { label, value: o.value, unit: o.unit, status };
      });
    if ((v.condition === "stenosis" || v.condition === "regurgitation") && !v.severity) {
      issues.push({ severity: "info", code: "valve.severity_missing", path: `valveFindings.${v.valve}`, message: `${v.valve.replace("_", " ")} ${v.condition} has no severity; depicted with a neutral "unspecified" cue.` });
    }
    return { valve: v.valve, condition: v.condition, severity: v.severity ?? null, source: v.source, method: v.method, observedAt: v.observedAt, measurements: meas, note: v.note, evidence: "reported_assessment" };
  });

  // ---- regional findings
  const wallMotion = (rec.echo?.regionalWallMotion ?? []).map((f) => ({ segment: f.segment, motion: f.motion, source: f.source, evidence: "reported_assessment" as const }));
  const seenSeg = new Set<number>();
  for (const f of wallMotion) {
    if (seenSeg.has(f.segment)) issues.push({ severity: "warning", code: "wallmotion.duplicate", path: `echo.regionalWallMotion.${f.segment}`, message: `Segment ${f.segment} is listed more than once; the first finding is used.` });
    seenSeg.add(f.segment);
  }
  const wallThickness: NormalizedWallThickness[] = (rec.echo?.wallThickness ?? []).map((t, i) => {
    const segments = typeof t.region === "number" ? [t.region] : REGION_SEGMENTS[t.region];
    let valueMm: number | null = null;
    let status: ObservationStatus = "null";
    if (t.value !== null) {
      const u = (t.unit ?? "").trim().toLowerCase();
      if (!u) status = "unit_missing";
      else if (u === "mm") { valueMm = t.value; status = "ok"; }
      else if (u === "cm") { valueMm = t.value * 10; status = "ok"; }
      else status = "unit_unknown";
      if (valueMm !== null && (valueMm <= 0 || valueMm > 80)) { valueMm = null; status = "impossible"; }
      if (status !== "ok") issues.push({ severity: status === "impossible" ? "error" : "warning", code: `wallthickness.${status}`, path: `echo.wallThickness.${i}`, message: `Wall thickness (${t.region}) not usable: ${status.replace("_", " ")}.` });
    }
    return { region: t.region, segments, valueMm, original: { value: t.value, unit: t.unit }, status, phase: t.phase, method: t.method, source: t.source, evidence: "reported_measurement" };
  });

  if (rec.imaging?.assets?.length) {
    issues.push({ severity: "info", code: "imaging.unsupported", path: "imaging.assets", message: `${rec.imaging.assets.length} imaging attachment(s) listed. A mesh that references a bundled CT-derived heart (Tier B) is rendered; images are never reconstructed here and other attachments are references only.` });
  }
  for (const [i, wf] of (rec.ecg?.waveforms ?? []).entries()) {
    if (!wf.samples) issues.push({ severity: "info", code: "ecg.waveform_reference", path: `ecg.waveforms.${i}`, message: `Waveform "${wf.attachmentRef ?? wf.format ?? "attachment"}" has no inline samples; only inline numeric samples can be plotted.` });
  }

  return {
    ok: true,
    patient: {
      key: recordKey(rec.patientId, rec.studyId),
      patientId: rec.patientId,
      studyId: rec.studyId,
      displayName: rec.displayName,
      synthetic: rec.synthetic ?? false,
      studyDate: rec.studyDate,
      original: raw,
      record: rec,
      observations,
      derived,
      valveFindings,
      coronaryFindings: (rec.coronaryFindings ?? []).map((c) => ({ vessel: c.vessel, segment: c.segment, stenosisPercent: c.stenosisPercent, plaque: c.plaque, source: c.source })),
      wallMotion,
      wallThickness,
      issues,
      unrecognizedFields: unrecognized,
    },
  };
}
