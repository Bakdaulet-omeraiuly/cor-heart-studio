// Left ventricle: EF category (ESC 2021 / AHA-ACC-HFSA 2022), ASE/EACVI 2015 EF grade, dilatation, mass and geometry,
// wall thickness, regional wall motion by coronary territory.
import { AHA_SEGMENT_NAMES } from "../mapping/mapPatientToVisual";
import { LVMI_UPPER_NORMAL } from "../outlook/evidence";
import { lvMassAse } from "../outlook/project";
import type { WallMotion } from "../schema/record";
import { round, type Ctx, type Num, type Sex, type Territory } from "./context";
import type { Evidence } from "./types";

// ------------------------------------------------------------------ thresholds
export type EfCategory = "reduced" | "mildly reduced" | "preserved";
export const efCategory = (ef: number): EfCategory => (ef <= 40 ? "reduced" : ef < 50 ? "mildly reduced" : "preserved");

export const EF_LOWER_NORMAL: Record<Sex, number> = { male: 52, female: 54 };
export type AseEfGrade = "normal" | "mildly abnormal" | "moderately abnormal" | "severely abnormal";
export function aseEfGrade(ef: number, sex: Sex): AseEfGrade {
  if (ef >= EF_LOWER_NORMAL[sex]) return "normal";
  if (ef >= 41) return "mildly abnormal";
  if (ef >= 30) return "moderately abnormal";
  return "severely abnormal";
}

export const LVEDD_UPPER_MM: Record<Sex, number> = { male: 58.4, female: 52.2 };
export const LVEDVI_UPPER: Record<Sex, number> = { male: 74, female: 61 };
export const WALL_UPPER_MM: Record<Sex, number> = { male: 10, female: 9 };
export const RWT_CONCENTRIC = 0.42;
const lvmiUpper = (s: Sex) => (s === "male" ? LVMI_UPPER_NORMAL.men : LVMI_UPPER_NORMAL.women);
/** LV mass index (g/m², linear method) above the ASE/EACVI upper normal limit. */
export const lvMassIncreased = (lvmi: number, s: Sex) => lvmi > lvmiUpper(s);
/** Relative wall thickness 2·PWd/LVIDd above 0.42 = concentric geometry. */
export const isConcentric = (rwt: number) => rwt > RWT_CONCENTRIC;

/** AHA 17-segment model, typical coronary territory of each segment (Cerqueira 2002). */
export const SEGMENT_TERRITORY: Record<number, Territory> = {
  1: "LAD", 2: "LAD", 7: "LAD", 8: "LAD", 13: "LAD", 14: "LAD", 17: "LAD",
  3: "RCA", 4: "RCA", 9: "RCA", 10: "RCA", 15: "RCA",
  5: "LCx", 6: "LCx", 11: "LCx", 12: "LCx", 16: "LCx",
};
const MOTION_ORDER: WallMotion[] = ["hypokinetic", "akinetic", "dyskinetic", "aneurysmal"];

// ------------------------------------------------------------------ EF
function ejectionFraction(c: Ctx, askIfAbsent: boolean) {
  const rep = c.num("observations.lvEjectionFraction");
  const der = c.derived("lvEfFromVolumes");
  const ef = rep ?? der;
  if (!ef) {
    if (askIfAbsent) c.need("observations.lvEjectionFraction", "LV systolic function cannot be graded without LVEF or both LV volumes");
    return;
  }
  const suffix = rep ? "" : " (derived from LV volumes)";
  const cat = efCategory(ef.value);
  const ev = c.evNum("R-DX-LVEF-01", ef);
  c.finding({ condition: "lv-ef-category", label: `LVEF in the ${cat} range${suffix}`, grade: cat, basis: "rule-defined", evidence: [ev], organ: "heart", target: "lv" });
  c.facts.lvef = { value: ef.value, evidence: ev };

  const g = c.bySex((s) => aseEfGrade(ef.value, s), "the normal LVEF range is sex-specific (ASE/EACVI)");
  if (g && g !== "normal") {
    c.finding({ condition: "lv-systolic-dysfunction", label: `LV systolic dysfunction, ${g} LVEF${suffix}`, grade: g, basis: "rule-defined",
      evidence: [c.evNum("R-DX-LVEF-02", ef), ...(c.sex ? [c.ev("R-DX-LVEF-02", "demographics.biologicalSex", c.sex)] : [])], organ: "heart", target: "lv" });
  }
  if (rep && der && Math.abs(rep.value - der.value) > 5) {
    c.alt({ condition: "lvef-measurements-disagree", label: "Reported and volume-derived LVEF disagree: check method and timing",
      basis: "supported", evidence: [c.evNum("R-DX-LVEF-03", rep), c.evNum("R-DX-LVEF-03", der)], organ: "heart", target: "lv" });
  }
}

// ------------------------------------------------------------------ size, mass, geometry
function sizeAndMass(c: Ctx) {
  const edd = c.num("observations.lvEndDiastolicDiameter");
  const edv = c.num("observations.lvEndDiastolicVolume");
  const ivs = c.num("observations.ivsThickness");
  const pw = c.num("observations.lvPosteriorWallThickness");
  const sexEv = c.sex ? [c.ev("R-DX-LVDIL-01", "demographics.biologicalSex", c.sex)] : [];

  const dilated: Evidence[] = [];
  if (edd && c.bySex((s) => edd.value > LVEDD_UPPER_MM[s], "the normal LV diameter range is sex-specific (ASE/EACVI)")) dilated.push(c.evNum("R-DX-LVDIL-01", edd));
  const needsBsa = edv || (ivs && pw && edd);
  const bsa = needsBsa ? c.bsa("needed to index LV volume and LV mass to body surface area") : null;
  if (edv && bsa) {
    const edvi = round(edv.value / bsa.value, 1);
    if (c.bySex((s) => edvi > LVEDVI_UPPER[s], "the normal LV volume index is sex-specific (ASE/EACVI)")) {
      dilated.push(c.evNum("R-DX-LVDIL-02", edv), c.evNum("R-DX-BSA-01", bsa), c.ev("R-DX-LVDIL-02", "derived.lvEndDiastolicVolumeIndex", edvi, "mL/m²"));
    }
  }
  if (dilated.length) {
    c.finding({ condition: "lv-dilatation", label: "LV dilatation", grade: "dilated", basis: "rule-defined", evidence: [...dilated, ...sexEv], organ: "heart", target: "lv" });
    c.facts.lvDilated = dilated;
  }

  // walls
  const walls: Num[] = [ivs, pw].filter((x): x is Num => !!x);
  for (const t of c.p.wallThickness) if (t.status === "ok" && t.valueMm !== null) walls.push({ field: `echo.wallThickness[${t.region}]`, value: t.valueMm, unit: "mm" });
  if (walls.length) c.facts.maxWallMm = walls.reduce((a, b) => (b.value > a.value ? b : a));

  let massDone = false;
  if (ivs && pw && edd && bsa) {
    const lvm = round(lvMassAse(ivs.value, edd.value, pw.value), 1);
    const lvmi = round(lvm / bsa.value, 1);
    const rwt = round((2 * pw.value) / edd.value, 2);
    const increased = c.bySex((s) => lvMassIncreased(lvmi, s), "the normal LV mass index is sex-specific (ASE/EACVI)");
    const concentric = isConcentric(rwt);
    const ev = [c.evNum("R-DX-LVH-01", ivs), c.evNum("R-DX-LVH-01", pw), c.evNum("R-DX-LVH-01", edd), c.evNum("R-DX-BSA-01", bsa),
      c.ev("R-DX-LVH-01", "derived.lvMass", lvm, "g"), c.ev("R-DX-LVH-01", "derived.lvMassIndex", lvmi, "g/m²"), c.ev("R-DX-LVH-01", "derived.relativeWallThickness", rwt),
      ...(c.sex ? [c.ev("R-DX-LVH-01", "demographics.biologicalSex", c.sex)] : [])];
    if (increased !== null) {
      massDone = true;
      if (increased) {
        const g = concentric ? "concentric" : "eccentric";
        c.finding({ condition: "lv-hypertrophy", label: `${concentric ? "Concentric" : "Eccentric"} LV hypertrophy`, grade: g, basis: "rule-defined", evidence: ev, organ: "heart", target: "lv" });
        c.facts.lvMassIncreased = ev;
      } else if (concentric) {
        c.finding({ condition: "lv-concentric-remodelling", label: "Concentric LV remodelling (normal mass, increased relative wall thickness)", grade: "concentric remodelling",
          basis: "rule-defined", evidence: ev, organ: "heart", target: "lv" });
        c.facts.concentricRemodelling = ev;
      }
    }
  }
  if (!massDone && (ivs || pw)) {
    const thick = [ivs, pw].filter((x): x is Num => !!x && c.bySex((s) => x.value > WALL_UPPER_MM[s], "the normal wall thickness range is sex-specific (ASE/EACVI)") === true);
    if (thick.length) {
      const ev = [...thick.map((n) => c.evNum("R-DX-WALL-01", n)), ...(c.sex ? [c.ev("R-DX-WALL-01", "demographics.biologicalSex", c.sex)] : [])];
      c.finding({ condition: "lv-increased-wall-thickness", label: "Increased LV wall thickness (LV mass index not computable)", grade: "increased", basis: "supported", evidence: ev, organ: "heart", target: "lv" });
      c.facts.wallThick = ev;
      if (!edd) c.need("observations.lvEndDiastolicDiameter", "LV diameter is needed with wall thickness to compute LV mass and relative wall thickness");
    }
  }
}

// ------------------------------------------------------------------ wall motion
function wallMotion(c: Ctx) {
  const seen = new Set<number>();
  const byTerritory = new Map<Territory, { seg: number; motion: WallMotion }[]>();
  for (const f of [...c.p.wallMotion].sort((a, b) => a.segment - b.segment)) {
    if (seen.has(f.segment)) continue;
    seen.add(f.segment);
    if (f.motion === "normal" || f.motion === "unspecified") continue;
    const t = SEGMENT_TERRITORY[f.segment];
    if (!byTerritory.has(t)) byTerritory.set(t, []);
    byTerritory.get(t)!.push({ seg: f.segment, motion: f.motion });
  }
  for (const t of ["LAD", "RCA", "LCx"] as const) {
    const segs = byTerritory.get(t);
    if (!segs) continue;
    const worst = segs.reduce((a, b) => (MOTION_ORDER.indexOf(b.motion) > MOTION_ORDER.indexOf(a.motion) ? b : a)).motion;
    const ev = segs.map((s) => c.ev("R-DX-WMA-01", `echo.regionalWallMotion[${s.seg}]`, s.motion));
    c.finding({ condition: "regional-wall-motion-abnormality", label: `Regional wall-motion abnormality in the ${t} territory (reported; ${segs.map((s) => AHA_SEGMENT_NAMES[s.seg - 1]).join(", ")})`,
      grade: worst, basis: "supported", evidence: ev, organ: "heart", target: `lv#${segs[0].seg}` });
    c.facts.wma[t] = ev;
  }
}

export function assessLv(c: Ctx, askEfIfAbsent: boolean) {
  ejectionFraction(c, askEfIfAbsent);
  sizeAndMass(c);
  wallMotion(c);
}
