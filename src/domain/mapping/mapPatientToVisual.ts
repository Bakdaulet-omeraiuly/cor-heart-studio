// Deterministic, pure mapping: normalized patient + reference profile + asset capabilities -> visual state.
// No React, no WebGL, no randomness, no clock. Same inputs + versions => identical output.
import { VALVE_IDS, type Severity, type ValveId } from "../schema/record";
import { LESION_LENGTH_MM, VESSEL_ID, VESSEL_LABEL, cadRads, segmentCentre, stenosisCategory, type LesionVisual } from "../coronary";
import type { EvidenceClass, Issue, NormalizedObservation, NormalizedPatient } from "../types";
import { cyclePhases } from "./cycle";
import {
  MAPPING_VERSION, STRUCTURE_IDS, STRUCTURE_LABEL, type AssetCapabilities, type Highlight, type PatientVisualState,
  type ReferenceProfile, type SegmentStatus, type SourceRef, type StructureId, type UnknownItem, type UnsupportedFinding,
  type ValveVisual, type VisualChange,
} from "./types";

const RULE_V = "1.0.0";
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const r3 = (x: number) => Math.round(x * 1000) / 1000;

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(",")}}`;
}
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const src = (o: NormalizedObservation): SourceRef => ({
  path: o.path, originalValue: o.original.value, originalUnit: o.original.unit, normalizedValue: o.value, normalizedUnit: o.unit,
});

// AHA 17-segment groupings
export const AHA_SEGMENT_NAMES = [
  "basal anterior", "basal anteroseptal", "basal inferoseptal", "basal inferior", "basal inferolateral", "basal anterolateral",
  "mid anterior", "mid anteroseptal", "mid inferoseptal", "mid inferior", "mid inferolateral", "mid anterolateral",
  "apical anterior", "apical septal", "apical inferior", "apical lateral", "apex",
];
const SEPTAL = [2, 3, 8, 9, 14];
const INFEROLATERAL = [5, 11];
/** Adjacency used only for the illustrative taper of a regional thickness change into neighbours. */
const NEIGHBOURS: Record<number, number[]> = {
  1: [2, 6, 7], 2: [1, 3, 8], 3: [2, 4, 9], 4: [3, 5, 10], 5: [4, 6, 11], 6: [5, 1, 12],
  7: [1, 8, 12, 13], 8: [2, 7, 9, 14], 9: [3, 8, 10, 14], 10: [4, 9, 11, 15], 11: [5, 10, 12, 16], 12: [6, 11, 7, 16],
  13: [7, 14, 16, 17], 14: [8, 9, 13, 15, 17], 15: [10, 14, 16, 17], 16: [11, 12, 13, 15, 17], 17: [13, 14, 15, 16],
};
const MOTION_FACTOR: Record<string, number> = { normal: 1, hypokinetic: 0.45, akinetic: 0, dyskinetic: -0.35, aneurysmal: -0.55, unspecified: 1 };
const STENOSIS_OPENING: Record<Severity, number> = { none: 1, trace: 0.95, mild: 0.75, mild_to_moderate: 0.65, moderate: 0.52, moderate_to_severe: 0.42, severe: 0.3, unspecified: 0.6 };

export function mapPatientToVisual(patient: NormalizedPatient, reference: ReferenceProfile, capabilities: AssetCapabilities): PatientVisualState {
  const changes: VisualChange[] = [];
  const issues: Issue[] = [];
  const unsupported: UnsupportedFinding[] = [];
  const unknowns: UnknownItem[] = [];
  const highlights: Highlight[] = [];
  const B = reference.baseline;
  const obs = (path: string) => patient.observations[path];
  const usable = (path: string) => (obs(path)?.status === "ok" ? obs(path) : undefined);
  let n = 0;
  const change = (c: Omit<VisualChange, "id" | "ruleVersion" | "conflicts" | "limitations"> & Partial<Pick<VisualChange, "conflicts" | "limitations">>) => {
    const id = `${c.ruleId}#${++n}`;
    changes.push({ id, ruleVersion: RULE_V, conflicts: [], limitations: [], ...c });
    return id;
  };
  const bound = (value: number, [lo, hi]: [number, number], what: string, path: string) => {
    const v = clamp(value, lo, hi);
    if (v !== value) {
      issues.push({ severity: "warning", code: "display.clamped", path, message: `${what}: display scale ${value.toFixed(2)} limited to ${v.toFixed(2)} to protect geometry. The clinical value is unchanged.` });
      return { v, note: `Display scale limited from ${value.toFixed(2)} to ${v.toFixed(2)} (geometry safety bound).` };
    }
    return { v, note: undefined };
  };

  // ---------------------------------------------------------------- timing
  let hr = reference.defaults.heartRateBpm;
  let hrEvidence: EvidenceClass = "default_unknown";
  let hrPath: string | undefined;
  const hrObs = usable("observations.heartRate") ?? usable("ecg.heartRate");
  if (hrObs) {
    hr = hrObs.value!;
    hrEvidence = "reported_measurement";
    hrPath = hrObs.path;
    change({
      ruleId: "R-HR-01", target: "myocardium", property: "cycle frequency", summary: `Animation cycle runs at ${hr} beats per minute in real-time mode.`,
      sources: [src(hrObs)], evidence: "reported_measurement", nature: "quantitative",
      limitations: ["Frequency is data-driven; the contraction waveform shape is an illustrative template.",
        ...(hrObs.path === "ecg.heartRate" ? ["Uses the ECG acquisition heart rate because no vital-sign heart rate was supplied."] : [])],
    });
    if (hr < 25 || hr > 220) issues.push({ severity: "info", code: "hr.unusual", path: hrObs.path, message: `Heart rate ${hr} bpm is unusual; it is rendered as supplied.` });
  } else {
    unknowns.push({ structure: "myocardium", property: "heart rate", message: `Heart rate unknown — animation uses an illustrative ${hr} bpm (not the patient's rate).` });
  }
  const phases = cyclePhases(clamp(hr, 20, 250));
  if (hr !== clamp(hr, 20, 250)) issues.push({ severity: "warning", code: "display.clamped", path: hrPath ?? "", message: "Heart rate is outside the animatable range (20–250 bpm); timing is limited for display." });

  // ---------------------------------------------------------------- LV geometry (end-diastole)
  const edd = usable("observations.lvEndDiastolicDiameter");
  const edvObs = usable("observations.lvEndDiastolicVolume");
  const esvObs = usable("observations.lvEndSystolicVolume");
  const efObs = usable("observations.lvEjectionFraction");
  let lvRadial = 1, lvLong = 1;
  let edvTarget = B.lvEndDiastolicVolumeMl;
  let edvEvidence: EvidenceClass = "default_unknown";
  const lvChangeIds: string[] = [];

  if (edd) {
    const raw = edd.value! / B.lvEndDiastolicDiameterMm;
    const b = bound(raw, reference.bounds.lvRadial, "LV short-axis scale", edd.path);
    lvRadial = b.v;
    lvChangeIds.push(change({
      ruleId: "R-LV-DIM-01", target: "lv", property: "end-diastolic short-axis cavity scale",
      summary: `LV cavity widened/narrowed to ×${r3(lvRadial)} in the short axis (LVEDD ${edd.value} mm vs asset baseline ${B.lvEndDiastolicDiameterMm} mm).`,
      sources: [src(edd)], evidence: "reported_measurement", nature: "quantitative",
      formula: `scale = LVEDD / ${B.lvEndDiastolicDiameterMm} mm`, displayAdjustment: b.note,
      limitations: ["One diameter does not determine the complete 3D cavity; the rest of the shape is inferred from the baseline asset."],
    }));
  }
  if (edvObs) {
    edvTarget = edvObs.value!;
    edvEvidence = "reported_measurement";
    const ratio = edvTarget / B.lvEndDiastolicVolumeMl;
    if (edd) {
      const rawLong = ratio / (lvRadial * lvRadial);
      const b = bound(rawLong, reference.bounds.lvLong, "LV long-axis scale", edvObs.path);
      lvLong = b.v;
      lvChangeIds.push(change({
        ruleId: "R-LV-VOL-01", target: "lv", property: "end-diastolic long-axis cavity scale",
        summary: `LV cavity length ×${r3(lvLong)} so the rendered end-diastolic cavity volume approaches ${edvTarget} mL given the measured diameter.`,
        sources: [src(edvObs), src(edd)], evidence: "reported_measurement", nature: "quantitative",
        formula: `long = (EDV / ${B.lvEndDiastolicVolumeMl} mL) / radial²`, displayAdjustment: b.note,
        limitations: ["Shape distribution between axes is inferred; volume and linear scale are not interchangeable."],
      }));
    } else {
      const lin = Math.cbrt(ratio);
      const br = bound(lin, reference.bounds.lvRadial, "LV cavity scale", edvObs.path);
      const bl = bound(lin, reference.bounds.lvLong, "LV long-axis scale", edvObs.path);
      lvRadial = br.v; lvLong = bl.v;
      lvChangeIds.push(change({
        ruleId: "R-LV-VOL-02", target: "lv", property: "end-diastolic cavity volume (uniform)",
        summary: `LV cavity scaled uniformly ×${r3(lin)} (cube root of ${edvTarget} / ${B.lvEndDiastolicVolumeMl} mL) to target the reported EDV.`,
        sources: [src(edvObs)], evidence: "reported_measurement", nature: "quantitative",
        formula: "linear = ∛(EDV / baseline EDV)", displayAdjustment: br.note ?? bl.note,
        limitations: ["Uniform shape change is an illustrative assumption; a volume ratio does not define shape."],
      }));
    }
  } else if (edd) {
    edvEvidence = "illustrative_inference";
  } else {
    unknowns.push({ structure: "lv", property: "size", message: "No LV diameter or volume supplied — LV shown at the illustration baseline (unknown, not normal)." });
  }
  const renderedEdv = B.lvEndDiastolicVolumeMl * lvRadial * lvRadial * lvLong;
  if (!edvObs) edvTarget = renderedEdv;

  // ---------------------------------------------------------------- LV excursion (EF / volumes)
  let rho: number; // ESV / EDV
  let esvEvidence: EvidenceClass;
  const derivedEf = patient.derived.find((d) => d.id === "lvEfFromVolumes");
  if (edvObs && esvObs) {
    rho = esvObs.value! / edvObs.value!;
    esvEvidence = "reported_measurement";
    const conflicts: string[] = [];
    if (efObs && Math.abs(efObs.value! - 100 * (1 - rho)) > 5) conflicts.push(`Reported LVEF ${efObs.value}% vs volume-derived ${(100 * (1 - rho)).toFixed(1)}%: rendering follows the volumes.`);
    lvChangeIds.push(change({
      ruleId: "R-LV-EF-02", target: "lv", property: "systolic cavity volume excursion",
      summary: `LV cavity animates between ${edvObs.value} mL and ${esvObs.value} mL targets (derived EF ${(100 * (1 - rho)).toFixed(1)}%).`,
      sources: [src(edvObs), src(esvObs)], evidence: "derived", nature: "quantitative",
      formula: "EF = 100 × (EDV − ESV) / EDV; endocardial radial factor = √(ESV/EDV ÷ longitudinal factor)",
      conflicts,
      limitations: ["Split between longitudinal and radial shortening is illustrative.", ...(derivedEf?.note ? [derivedEf.note] : [])],
    }));
  } else if (efObs) {
    rho = 1 - efObs.value! / 100;
    esvEvidence = "derived";
    lvChangeIds.push(change({
      ruleId: "R-LV-EF-01", target: "lv", property: "systolic cavity volume excursion",
      summary: `LV cavity volume shrinks by ${efObs.value}% from end-diastole to end-systole.`,
      sources: [src(efObs)], evidence: "reported_measurement", nature: "quantitative",
      formula: "ESV/EDV = 1 − EF/100",
      limitations: [edvObs || edd ? "End-diastolic size from supplied dimensions; systolic shape inferred." : "No EDV supplied: the excursion is applied to the illustration baseline EDV.",
        "EF changes only the LV excursion — not heart rate and not overall heart size."],
    }));
  } else {
    rho = 1 - reference.defaults.lvEjectionFractionPercent / 100;
    esvEvidence = "default_unknown";
    unknowns.push({ structure: "lv", property: "systolic function", message: `No LVEF or volumes supplied — the contraction shown is an illustrative default (EF-equivalent ${reference.defaults.lvEjectionFractionPercent}%), not the patient's function.` });
  }
  if (rho < 0.05) { issues.push({ severity: "warning", code: "display.clamped", path: "observations.lvEjectionFraction", message: "Extremely small ESV/EDV ratio; contraction depiction limited for geometry safety." }); rho = 0.05; }
  rho = Math.min(rho, 1);
  const longShort = clamp(0.27 * (1 - rho), 0, 0.22);
  const esLong = 1 - longShort;
  const esRadialEndo = Math.sqrt(rho / esLong);
  // myocardial volume is approximately conserved: epicardium moves less than endocardium
  const epiEd = B.lvEpicardialVolumeMl * (renderedEdv / B.lvEndDiastolicVolumeMl);
  const strokeRendered = renderedEdv * (1 - rho);
  const esRadialEpi = Math.sqrt(Math.max(0.3, (epiEd - strokeRendered) / (epiEd * esLong)));
  // wall preserved at end-diastole: epicardial radial scale derived from endocardial scale
  const { lvMeanCavityRadiusCm: meanR, lvMeanWallCm: meanT } = reference.geometry;
  const edRadialEpi = (meanR * lvRadial + meanT) / (meanR + meanT);
  const twistRad = (12 * Math.PI / 180) * ((1 - rho) / 0.45);

  // ---------------------------------------------------------------- LV wall thickness (segments)
  const thickness = new Array<number>(17).fill(0);
  const tStatus: SegmentStatus[] = new Array(17).fill("default");
  const applyThickness = (segs: number[], deltaCm: number, sources: SourceRef[], label: string, path: string) => {
    const b = bound(deltaCm, reference.bounds.wallDeltaCm, `${label} wall change`, path);
    for (const s of segs) { thickness[s - 1] = b.v; tStatus[s - 1] = "measured"; }
    for (const s of segs) for (const nb of NEIGHBOURS[s]) {
      if (tStatus[nb - 1] === "default" || tStatus[nb - 1] === "interpolated") {
        thickness[nb - 1] = tStatus[nb - 1] === "interpolated" ? (thickness[nb - 1] + b.v * 0.5) / 2 + b.v * 0.25 : b.v * 0.5;
        tStatus[nb - 1] = "interpolated";
      }
    }
    return change({
      ruleId: "R-LV-WALL-01", target: "lv", segments: segs, property: "regional wall thickness",
      summary: `${label} wall ${deltaCm >= 0 ? "thickened" : "thinned"} by ${Math.abs(b.v * 10).toFixed(1)} mm in segments ${segs.join(", ")}; adjacent segments taper by half (illustrative).`,
      sources, evidence: "reported_measurement", nature: "quantitative", displayAdjustment: b.note,
      formula: "Δ = measured − asset baseline thickness", limitations: ["Only the named region is driven by data; the taper into neighbouring segments is illustrative.", "The heart is not enlarged as a substitute for wall thickening."],
    });
  };
  const ivs = usable("observations.ivsThickness");
  const lvpw = usable("observations.lvPosteriorWallThickness");
  if (capabilities.wallThickness) {
    if (ivs) lvChangeIds.push(applyThickness(SEPTAL, (ivs.value! - B.ivsThicknessMm) / 10, [src(ivs)], "Septal", ivs.path));
    if (lvpw) lvChangeIds.push(applyThickness(INFEROLATERAL, (lvpw.value! - B.lvPosteriorWallThicknessMm) / 10, [src(lvpw)], "Inferolateral (posterior)", lvpw.path));
    for (const t of patient.wallThickness) {
      if (t.status !== "ok" || t.valueMm === null) continue;
      const baseMm = (B.ivsThicknessMm + B.lvPosteriorWallThicknessMm) / 2;
      lvChangeIds.push(applyThickness(t.segments, (t.valueMm - baseMm) / 10, [{ path: `echo.wallThickness[${String(t.region)}]`, originalValue: t.original.value, originalUnit: t.original.unit, normalizedValue: t.valueMm, normalizedUnit: "mm" }], `Region ${t.region}`, "echo.wallThickness"));
    }
  } else if (ivs || lvpw) unsupported.push({ path: "observations.ivsThickness", label: "Wall thickness", reason: "Asset has no wall-thickness handles." });

  // ---------------------------------------------------------------- regional wall motion
  const motion = new Array<number>(17).fill(1);
  const mStatus: SegmentStatus[] = new Array(17).fill("default");
  const seen = new Set<number>();
  for (const f of patient.wallMotion) {
    if (seen.has(f.segment)) continue;
    seen.add(f.segment);
    if (!capabilities.segmentalLv) { unsupported.push({ path: `echo.regionalWallMotion.${f.segment}`, label: "Regional wall motion", reason: "Asset lacks segmental handles." }); continue; }
    motion[f.segment - 1] = MOTION_FACTOR[f.motion];
    mStatus[f.segment - 1] = "reported";
    if (f.motion !== "normal") {
      const id = change({
        ruleId: "R-LV-WMA-01", target: "lv", segments: [f.segment], property: "regional wall motion",
        summary: `Segment ${f.segment} (${AHA_SEGMENT_NAMES[f.segment - 1]}) depicted as ${f.motion}: local inward motion ×${MOTION_FACTOR[f.motion]}.`,
        sources: [{ path: `echo.regionalWallMotion[segment=${f.segment}]`, originalValue: f.motion, normalizedValue: f.motion }],
        evidence: "reported_assessment", nature: "qualitative",
        limitations: ["Motion magnitude per category is an illustrative convention.", "Segment convention: AHA 17-segment; only the named segment is modulated (smooth blend at borders)."],
      });
      lvChangeIds.push(id);
      highlights.push({ structure: "lv", segments: [f.segment], label: `Reported ${f.motion} segment ${f.segment}`, changeId: id, kind: "finding" });
    }
  }

  // ---------------------------------------------------------------- RV
  let rvRadial = 1;
  const rvIds: string[] = [];
  const rvd = usable("observations.rvBasalDiameter");
  if (rvd) {
    const b = bound(rvd.value! / B.rvBasalDiameterMm, reference.bounds.rvRadial, "RV scale", rvd.path);
    rvRadial = b.v;
    rvIds.push(change({ ruleId: "R-RV-DIM-01", target: "rv", property: "short-axis scale",
      summary: `RV cavity scaled ×${r3(rvRadial)} across the short axis (RV basal diameter ${rvd.value} mm vs asset ${B.rvBasalDiameterMm} mm).`,
      sources: [src(rvd)], evidence: "reported_measurement", nature: "quantitative", formula: "scale = RVD / baseline", displayAdjustment: b.note,
      limitations: ["The RV crescent shape is inferred; one diameter does not define RV volume."] }));
  } else unknowns.push({ structure: "rv", property: "size", message: "RV size not supplied — baseline shape (unknown, not normal)." });
  const rvef = usable("observations.rvEjectionFraction");
  const rvRho = 1 - (rvef ? rvef.value! : reference.defaults.rvEjectionFractionPercent) / 100;
  if (rvef) rvIds.push(change({ ruleId: "R-RV-EF-01", target: "rv", property: "systolic excursion", summary: `RV volume excursion set from RVEF ${rvef.value}%.`,
    sources: [src(rvef)], evidence: "reported_measurement", nature: "quantitative", formula: "ESV/EDV = 1 − RVEF/100", limitations: ["RV contraction pattern is illustrative."] }));
  else unknowns.push({ structure: "rv", property: "systolic function", message: "RV function not supplied — illustrative default excursion." });
  const rvLong = 1 - clamp(0.3 * (1 - rvRho), 0, 0.22);
  const rvEsR = Math.sqrt(Math.max(0.05, rvRho) / rvLong);

  // ---------------------------------------------------------------- atria
  let laScale = 1, raScale = 1;
  const laIds: string[] = [], raIds: string[] = [];
  const lav = usable("observations.laVolume");
  if (lav) {
    const b = bound(Math.cbrt(lav.value! / B.laVolumeMl), reference.bounds.atrialScale, "LA scale", lav.path);
    laScale = b.v;
    laIds.push(change({ ruleId: "R-LA-VOL-01", target: "la", property: "size", summary: `LA scaled ×${r3(laScale)} (∛ of ${lav.value} / ${B.laVolumeMl} mL).`,
      sources: [src(lav)], evidence: "reported_measurement", nature: "quantitative", formula: "linear = ∛(LAV / baseline)", displayAdjustment: b.note,
      limitations: ["Uniform atrial scaling; LA shape is illustrative.", "Appendage and pulmonary vein roots follow smoothly."] }));
  } else unknowns.push({ structure: "la", property: "size", message: "LA size not supplied — baseline (unknown, not normal)." });
  const ram = usable("observations.raMinorDimension");
  if (ram) {
    const b = bound(ram.value! / B.raMinorDimensionMm, reference.bounds.atrialScale, "RA scale", ram.path);
    raScale = b.v;
    raIds.push(change({ ruleId: "R-RA-DIM-01", target: "ra", property: "size", summary: `RA scaled ×${r3(raScale)} (RA minor dimension ${ram.value} mm vs asset ${B.raMinorDimensionMm} mm).`,
      sources: [src(ram)], evidence: "reported_measurement", nature: "quantitative", displayAdjustment: b.note,
      limitations: ["One dimension does not define RA volume; uniform scaling is illustrative."] }));
  } else unknowns.push({ structure: "ra", property: "size", message: "RA size not supplied — baseline (unknown, not normal)." });

  // ---------------------------------------------------------------- valves
  const valves = Object.fromEntries(VALVE_IDS.map((v) => [v, { maxOpening: 1, stenosis: null, regurgitation: null, prolapse: false, reported: false } satisfies ValveVisual])) as Record<ValveId, ValveVisual>;
  const valveIds: Record<string, string[]> = {};
  for (const f of patient.valveFindings) {
    const vv = valves[f.valve];
    vv.reported = true;
    const sev: Severity = f.severity ?? "unspecified";
    const fsrc: SourceRef = { path: `valveFindings[${f.valve}]`, originalValue: `${f.condition}${f.severity ? ` (${f.severity})` : ""}`, normalizedValue: `${f.condition}:${sev}` };
    const area = f.measurements.find((m) => m.label === "Valve area" && m.status === "ok");
    if (f.condition === "stenosis") {
      if (!capabilities.valveLeaflets.includes(f.valve)) { unsupported.push({ path: fsrc.path, label: "Valve stenosis", reason: "Asset has no leaflets for this valve." }); continue; }
      vv.stenosis = sev;
      vv.maxOpening = Math.min(vv.maxOpening, STENOSIS_OPENING[sev]);
      const id = change({ ruleId: "R-VALVE-STEN-01", target: f.valve, property: "maximum leaflet opening",
        summary: `${STRUCTURE_LABEL[f.valve]} opens to ${Math.round(vv.maxOpening * 100)}% of the illustrative full opening (reported ${sev} stenosis).`,
        sources: [fsrc], evidence: "reported_assessment", nature: "qualitative",
        limitations: ["Qualitative severity does not specify an orifice area; the opening fraction is an illustrative convention.",
          ...(area ? [`Reported valve area ${area.value} ${area.unit ?? ""} is displayed, not converted into geometry.`] : [])] });
      (valveIds[f.valve] ??= []).push(id);
      highlights.push({ structure: f.valve, label: `Reported ${sev} stenosis`, changeId: id, kind: "finding" });
    } else if (f.condition === "regurgitation") {
      if (!capabilities.regurgitationCue) { unsupported.push({ path: fsrc.path, label: "Valve regurgitation", reason: "Asset has no flow cue." }); continue; }
      vv.regurgitation = sev;
      const id = change({ ruleId: "R-VALVE-REGURG-01", target: f.valve, property: "reverse-flow cue",
        summary: `Labelled illustrative reverse-flow cue at the ${STRUCTURE_LABEL[f.valve].toLowerCase()} during its closed phase (reported ${sev} regurgitation); a small coaptation gap is drawn.`,
        sources: [fsrc], evidence: "reported_assessment", nature: "illustrative",
        limitations: ["Particles are not measured flow, velocity, or a CFD result.", "Jet size reflects the category only."] });
      (valveIds[f.valve] ??= []).push(id);
      highlights.push({ structure: f.valve, label: `Reported ${sev} regurgitation`, changeId: id, kind: "flow_cue" });
    } else if (f.condition === "prolapse") {
      vv.prolapse = true;
      const id = change({ ruleId: "R-VALVE-PROLAPSE-01", target: f.valve, property: "leaflet closure position",
        summary: `${STRUCTURE_LABEL[f.valve]} leaflets billow beyond the annulus plane when closed (reported prolapse).`,
        sources: [fsrc], evidence: "reported_assessment", nature: "illustrative", limitations: ["Billow depth and the affected scallop are not specified by the input."] });
      (valveIds[f.valve] ??= []).push(id);
      highlights.push({ structure: f.valve, label: "Reported prolapse", changeId: id, kind: "finding" });
    } else {
      highlights.push({ structure: f.valve, label: `Reported ${f.condition}`, kind: "finding" });
      unsupported.push({ path: fsrc.path, label: `Valve ${f.condition}`, reason: "Displayed as a highlighted finding; no geometric depiction rule for this condition." });
    }
  }

  // ---------------------------------------------------------------- imaging findings with segment localization
  for (const f of patient.record.imaging?.findings ?? []) {
    if (f.segment && capabilities.tissueOverlay && (f.category === "fibrosis_scar" || f.category === "tissue_characterization")) {
      const id = change({ ruleId: "R-TISSUE-01", target: "lv", segments: [f.segment], property: "tissue finding overlay",
        summary: `Hatched overlay on segment ${f.segment} (${AHA_SEGMENT_NAMES[f.segment - 1]}): reported ${f.modality} finding "${f.finding}". Geometry unchanged.`,
        sources: [{ path: "imaging.findings", originalValue: f.finding, normalizedValue: f.category }], evidence: "reported_assessment", nature: "qualitative",
        limitations: ["Overlay marks the reported segment only; extent within the segment is not represented."] });
      lvChangeIds.push(id);
      highlights.push({ structure: "lv", segments: [f.segment], label: `${f.modality}: ${f.finding}`, changeId: id, kind: "finding" });
    } else {
      unsupported.push({ path: "imaging.findings", label: `${f.modality}: ${f.finding}`, reason: f.segment ? "Category has no overlay rule; displayed as text." : "No supported anatomical localization (segment) supplied; displayed as text." });
    }
  }

  // Display-only observations (blood pressure, labs, ECG intervals, ...) are intentionally not mapped.
  if (usable("observations.globalLongitudinalStrain")) {
    unsupported.push({ path: "observations.globalLongitudinalStrain", label: "GLS", reason: "Displayed with the qualitative longitudinal-shortening cue; one GLS value is not expanded into a strain field." });
  }

  // ---------------------------------------------------------------- structure status
  // ---------------------------------------------------------------- coronary stenoses (CAD-RADS 2.0)
  const lesions: LesionVisual[] = [];
  const coroIds: string[] = [];
  for (const f of patient.coronaryFindings) {
    const vessel = capabilities.coronaryStenosis?.[f.vessel];
    const where = `${f.vessel}${f.segment ? ` ${f.segment}` : ""}`;
    const fsrc: SourceRef = { path: `coronaryFindings[${where}]`, originalValue: `${f.stenosisPercent}%${f.plaque ? ` ${f.plaque}` : ""}`, normalizedValue: f.stenosisPercent, normalizedUnit: "% diameter" };
    if (!vessel) {
      unsupported.push({ path: fsrc.path, label: "Coronary stenosis", reason: capabilities.coronaryStenosis ? `The anatomy template has no ${f.vessel}.` : "This anatomy has no coronary lumen handles; choose the CT anatomy template." });
      continue;
    }
    const category = stenosisCategory(f.stenosisPercent);
    const id = change({ ruleId: "R-CORO-STEN-01", target: "coronary_vessels", property: "lumen diameter",
      summary: `${VESSEL_LABEL[f.vessel]}${f.segment ? ` (${f.segment})` : ""}: lumen diameter narrowed by ${f.stenosisPercent}% at the lesion centre (reported; CAD-RADS ${category}).`,
      sources: [fsrc], evidence: "reported_measurement", nature: "quantitative",
      limitations: [
        "Lesion position is the proximal / mid / distal third of the modelled vessel, not this patient's segment anatomy.",
        `Lesion length (${LESION_LENGTH_MM} mm) and its tapered profile are illustrative.`,
        "The vessel course is a template pattern (right-dominant), not this patient's coronary anatomy.",
      ] });
    coroIds.push(id);
    lesions.push({ vessel: f.vessel, vesselId: VESSEL_ID[f.vessel], segment: f.segment, narrowing: Math.min(1, f.stenosisPercent / 100),
      tCentre: segmentCentre(f.vessel, f.segment), tHalfWidth: Math.min(0.5, LESION_LENGTH_MM / 2 / vessel.lengthMm),
      plaque: f.plaque ?? "unspecified", category, changeId: id });
    highlights.push({ structure: "coronary_vessels", label: `${where} ${f.stenosisPercent}% (CAD-RADS ${category})`, changeId: id, kind: "finding" });
  }
  const cad = patient.coronaryFindings.length ? cadRads(patient.coronaryFindings) : null;

  const structureStatus = Object.fromEntries(STRUCTURE_IDS.map((s) => [s, { status: "default_unknown" as const, changeIds: [] as string[] }])) as PatientVisualState["structureStatus"];
  const setStatus = (s: StructureId, ids: string[]) => {
    if (!ids.length) return;
    const ev = changes.filter((c) => ids.includes(c.id)).map((c) => c.evidence);
    structureStatus[s] = {
      status: ev.includes("reported_measurement") ? "measured_driven" : ev.includes("derived") ? "derived" : "assessment_driven",
      changeIds: ids,
    };
  };
  setStatus("lv", lvChangeIds);
  setStatus("rv", rvIds);
  setStatus("la", laIds);
  setStatus("ra", raIds);
  for (const [v, ids] of Object.entries(valveIds)) setStatus(v as StructureId, ids);
  const hrChange = changes.find((c) => c.ruleId === "R-HR-01");
  if (hrChange) setStatus("myocardium", [hrChange.id]);
  for (const s of ["aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins", "coronary_vessels"] as const) structureStatus[s].status = "display_only";
  setStatus("coronary_vessels", coroIds);

  const inputHash = fnv1a(stableStringify({ o: patient.observations, v: patient.valveFindings, c: patient.coronaryFindings, w: patient.wallMotion, t: patient.wallThickness, i: patient.record.imaging?.findings ?? [] }));

  return {
    mappingVersion: MAPPING_VERSION,
    assetId: capabilities.assetId,
    assetVersion: capabilities.assetVersion,
    referenceProfileId: reference.id,
    patientKey: patient.key,
    inputHash,
    timing: { heartRateBpm: hr, evidence: hrEvidence, sourcePath: hrPath, phases },
    lv: { edRadial: lvRadial, edLong: lvLong, edRadialEpi, esRadialEndo, esRadialEpi, esLong, twistRad },
    rv: { edRadial: rvRadial, edLong: 1, edRadialEpi: (2 * rvRadial + 0.4) / 2.4, esRadialEndo: rvEsR, esRadialEpi: 1 - (1 - rvEsR) * 0.55, esLong: rvLong },
    la: { edScale: laScale, swing: 0.07 },
    ra: { edScale: raScale, swing: 0.07 },
    segments: { motion, thicknessDeltaCm: thickness, status: thickness.map((_, i) => (mStatus[i] === "reported" ? "reported" : tStatus[i])) },
    valves,
    highlights,
    changes,
    issues,
    unsupported,
    unknowns,
    structureStatus,
    coronary: { cadRads: cad?.category ?? null, driver: cad?.driver ? `${cad.driver.vessel}${cad.driver.segment ? ` ${cad.driver.segment}` : ""} ${cad.driver.stenosisPercent}%` : null, lesions },
    lvTargets: { edvMl: edvTarget, esvMl: edvTarget * rho, edvEvidence, esvEvidence },
  };
}
