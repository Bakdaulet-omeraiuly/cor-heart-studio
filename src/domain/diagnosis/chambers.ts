// Other chambers: LA volume index, RV size and function, RA size (ASE/EACVI 2015; RA minor axis: ASE 2010 right heart).
import { round, type Ctx } from "./context";
import type { Evidence } from "./types";

export type LaGrade = "normal" | "mild" | "moderate" | "severe";
export const laviGrade = (lavi: number): LaGrade => (lavi < 35 ? "normal" : lavi < 42 ? "mild" : lavi <= 48 ? "moderate" : "severe");
export const RVD_UPPER_MM = 41;
export const TAPSE_LOWER_MM = 17;
export const RVEF_LOWER = 45;
export const RA_MINOR_UPPER_MM = 44;

function leftAtrium(c: Ctx) {
  const lav = c.num("observations.laVolume");
  if (!lav) return;
  const bsa = c.bsa("needed to index LA volume (LA enlargement is graded on volume per body surface area)");
  if (!bsa) return;
  const lavi = round(lav.value / bsa.value, 1);
  const g = laviGrade(lavi);
  if (g === "normal") return;
  const ev = [c.evNum("R-DX-LA-01", lav), c.evNum("R-DX-BSA-01", bsa), c.ev("R-DX-LA-01", "derived.laVolumeIndex", lavi, "mL/m²")];
  c.finding({ condition: "la-enlargement", label: `LA enlargement, ${g}`, grade: g, basis: "rule-defined", evidence: ev, organ: "heart", target: "la" });
  c.facts.laEnlarged = ev;
}

function rightVentricle(c: Ctx) {
  const rvd = c.num("observations.rvBasalDiameter");
  const abnormal: Evidence[] = [];
  if (rvd && rvd.value > RVD_UPPER_MM) {
    const ev = c.evNum("R-DX-RV-01", rvd);
    c.finding({ condition: "rv-dilatation", label: "RV dilatation", grade: "dilated", basis: "rule-defined", evidence: [ev], organ: "heart", target: "rv" });
    abnormal.push(ev);
  }
  const tapse = c.num("observations.tapse");
  const rvef = c.num("observations.rvEjectionFraction");
  const low = [tapse && tapse.value < TAPSE_LOWER_MM ? tapse : null, rvef && rvef.value < RVEF_LOWER ? rvef : null].filter((x) => x !== null);
  if (low.length) {
    const all = [tapse, rvef].filter((x) => x !== null).map((n) => c.evNum("R-DX-RV-02", n));
    const label = all.length > low.length ? "RV systolic dysfunction (parameters disagree)" : "RV systolic dysfunction";
    c.finding({ condition: "rv-systolic-dysfunction", label, grade: "reduced", basis: "rule-defined", evidence: all, organ: "heart", target: "rv" });
    abnormal.push(...all);
  }
  if (abnormal.length) c.facts.rvAbnormal = abnormal;
}

function rightAtrium(c: Ctx) {
  const ra = c.num("observations.raMinorDimension");
  if (ra && ra.value > RA_MINOR_UPPER_MM) {
    // "supported", not rule-defined: the minor-axis limit is from the 2010 ASE right-heart guideline, which the 2025 ASE
    // guideline replaced with RA area / volume index; the record holds no RA area or volume (docs/research/diagnosis-engine.md §2.4).
    c.finding({ condition: "ra-enlargement", label: "RA enlargement by minor-axis dimension (older ASE limit; RA area or volume index preferred)", grade: "enlarged",
      basis: "supported", evidence: [c.evNum("R-DX-RA-01", ra)], organ: "heart", target: "ra" });
  }
}

export function assessChambers(c: Ctx) {
  leftAtrium(c);
  rightVentricle(c);
  rightAtrium(c);
}
