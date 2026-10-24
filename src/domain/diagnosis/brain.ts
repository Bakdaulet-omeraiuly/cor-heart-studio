// Brain: annual atrophy rates compared with published cohort ranges (Barnes 2009; de Leon 1989).
// Cohort means are not individual cut-offs and Alzheimer's disease is a clinical/biological diagnosis (NIA-AA 2018),
// so brain output is differential-only and always "possible".
import type { Ctx, Num } from "./context";
import type { Evidence } from "./types";

export const BRAIN_FIELDS = {
  hippocampus: "observations.hippocampalVolumeChangePerYear",
  ventricles: "observations.ventricularVolumeChangePerYear",
} as const;

/** Barnes 2009 95% CIs of the annual hippocampal loss: AD 3.92–5.40, controls 0.52–2.30 (% per year). */
export const HIPPO_AD_LOWER = 3.92;
export const HIPPO_AGEING_UPPER = 2.3;
/** de Leon 1989 approximate annual ventricular expansion: AD ≈ 9, controls ≈ 2 (% per year). */
export const VENT_AD = 9;
export const VENT_AGEING = 2;

export type BrainPattern = "alzheimer" | "ageing" | "between";
export const hippocampalPattern = (lossPctPerYear: number): BrainPattern =>
  lossPctPerYear >= HIPPO_AD_LOWER ? "alzheimer" : lossPctPerYear <= HIPPO_AGEING_UPPER ? "ageing" : "between";
export const ventricularPattern = (expansionPctPerYear: number): BrainPattern =>
  expansionPctPerYear >= VENT_AD ? "alzheimer" : expansionPctPerYear <= VENT_AGEING ? "ageing" : "between";

const RATE_UNITS = new Set(["%/y", "%/yr", "%/year", "%peryear", "percent/year", "%/a"]);

/** Brain rate observations are outside the field registry, so they are read from the validated record directly. */
function rate(c: Ctx, field: string): Num | null {
  const key = field.slice("observations.".length);
  const raw = c.p.record.observations?.[key];
  if (raw === undefined) return null;
  if (raw.value === null) { c.need(field, "explicitly unknown in the record"); return null; }
  const unit = "unit" in raw ? raw.unit : undefined;
  const u = (unit ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!RATE_UNITS.has(u)) { c.need(field, unit ? "unit is not supported (use %/year), so the value is not used" : "value has no unit (use %/year), so it is not used"); return null; }
  return { field, value: raw.value, unit: "%/year" };
}

export function hasBrainData(c: Ctx) {
  return Object.values(BRAIN_FIELDS).some((f) => c.p.record.observations?.[f.slice("observations.".length)] !== undefined);
}

export function assessBrain(c: Ctx) {
  if (!hasBrainData(c)) return;
  const hip = rate(c, BRAIN_FIELDS.hippocampus);
  const ven = rate(c, BRAIN_FIELDS.ventricles);
  const support: Record<"alzheimer" | "ageing", Evidence[]> = { alzheimer: [], ageing: [] };
  const add = (p: BrainPattern, e: Evidence) => {
    if (p !== "ageing") support.alzheimer.push(e);
    if (p !== "alzheimer") support.ageing.push(e);
  };
  if (hip) add(hippocampalPattern(-hip.value), c.evNum("R-DX-BRAIN-01", hip));
  if (ven) add(ventricularPattern(ven.value), c.evNum("R-DX-BRAIN-02", ven));
  const target = hip ? "hippocampus" : "ventricles";
  if (support.alzheimer.length) {
    c.alt({ condition: "brain-atrophy-alzheimer-pattern", label: "Atrophy rate compatible with the Alzheimer's disease cohort (cohort comparison, not a diagnosis)",
      basis: "possible", evidence: support.alzheimer, organ: "brain", target });
  }
  if (support.ageing.length) {
    c.alt({ condition: "brain-atrophy-ageing-pattern", label: "Atrophy rate compatible with typical ageing (cohort comparison, not a diagnosis)",
      basis: "possible", evidence: support.ageing, organ: "brain", target });
  }
  if (hip || ven) {
    c.need("clinical.cognitiveAssessment", "atrophy rates are cohort-level; Alzheimer's disease is a clinical diagnosis that needs cognitive assessment");
    c.need("labs.amyloidTauBiomarkers", "amyloid and tau biomarkers (CSF or PET) define Alzheimer's disease biologically (NIA-AA)");
  }
}
