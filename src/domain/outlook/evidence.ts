// Outlook evidence: published, cohort-level rates of change that drive the scenario views.
// Every number here is copied from the cited abstract; see docs/outlook.md for how each is used.
// These are population averages, not a prediction for an individual.

export interface Source {
  id: string;
  cite: string; // short author-year label shown next to a number
  title: string;
  journal: string;
  doi: string;
  design: string; // study type and size, so the reader can weigh it
}

export const SOURCES: Record<string, Source> = {
  barnes2009: { id: "barnes2009", cite: "Barnes 2009", title: "A meta-analysis of hippocampal atrophy rates in Alzheimer's disease",
    journal: "Neurobiol Aging 30:1711–23", doi: "10.1016/j.neurobiolaging.2008.01.010", design: "Meta-analysis, 9 MRI studies, 595 AD / 212 controls" },
  deleon1989: { id: "deleon1989", cite: "de Leon 1989", title: "Alzheimer's disease: longitudinal CT studies of ventricular change",
    journal: "AJR 152:1257–62", doi: "10.2214/ajr.152.6.1257", design: "Prospective CT cohort, 3 years, 50 AD / 45 controls" },
  fjell2009: { id: "fjell2009", cite: "Fjell 2009", title: "One-year brain atrophy evident in healthy aging",
    journal: "J Neurosci 29:15223–31", doi: "10.1523/JNEUROSCI.3252-09.2009", design: "Longitudinal MRI, 142 healthy adults aged 60–91" },
  sluimer2008: { id: "sluimer2008", cite: "Sluimer 2008", title: "Whole-brain atrophy rate in Alzheimer disease: identifying fast progressors",
    journal: "Neurology 70:1836–41", doi: "10.1212/01.wnl.0000311446.61861.e3", design: "Serial MRI, 65 AD patients, mean age 70" },
  otto1997: { id: "otto1997", cite: "Otto 1997", title: "Prospective study of asymptomatic valvular aortic stenosis",
    journal: "Circulation 95:2262–70", doi: "10.1161/01.cir.95.9.2262", design: "Prospective echo cohort, 123 adults, 2.5 ± 1.4 years" },
  acc2020: { id: "acc2020", cite: "ACC/AHA 2020", title: "2020 ACC/AHA Guideline for the Management of Patients With Valvular Heart Disease",
    journal: "Circulation 143:e72–e227", doi: "10.1161/CIR.0000000000000923", design: "Clinical practice guideline" },
};

/** How the low/high bounds of a rate were defined in its source. */
export type SpreadKind = "ci95_mean" | "sd_patients" | "none_reported";

export const SPREAD_LABEL: Record<SpreadKind, string> = {
  ci95_mean: "95% CI of the cohort mean",
  sd_patients: "±1 SD between patients",
  none_reported: "no spread reported",
};

export interface Rate {
  /** Signed % change per year (negative = loss). */
  mean: number;
  /** Slower and faster ends of the reported spread (equal to mean when none is reported). */
  slow: number;
  fast: number;
  spread: SpreadKind;
  source: string;
  /** What the source measured, when it is not exactly what the view applies the rate to. */
  caveat?: string;
}

export type BrainScenarioId = "aging" | "alzheimers";
export type BrainTarget = "hippocampus" | "ventricles" | "cortex";

export interface BrainScenario {
  id: BrainScenarioId;
  label: string;
  cohort: string;
  rates: Record<BrainTarget, Rate>;
}

export const BRAIN_SCENARIOS: Record<BrainScenarioId, BrainScenario> = {
  aging: {
    id: "aging",
    label: "Typical ageing",
    cohort: "Cognitively normal older adults (about 60–90 years)",
    rates: {
      hippocampus: { mean: -1.41, slow: -0.52, fast: -2.3, spread: "ci95_mean", source: "barnes2009" },
      ventricles: { mean: 2, slow: 2, fast: 2, spread: "none_reported", source: "deleon1989",
        caveat: "Reported as approximately 2% per year, measured on CT." },
      cortex: { mean: -0.5, slow: -0.5, fast: -0.5, spread: "none_reported", source: "fjell2009",
        caveat: "About 0.5% per year in temporal and prefrontal cortex; applied here to the whole cortex." },
    },
  },
  alzheimers: {
    id: "alzheimers",
    label: "Alzheimer's disease",
    cohort: "Patients with mild to moderate Alzheimer's dementia (mean age about 70)",
    rates: {
      hippocampus: { mean: -4.66, slow: -3.92, fast: -5.4, spread: "ci95_mean", source: "barnes2009" },
      ventricles: { mean: 9, slow: 9, fast: 9, spread: "none_reported", source: "deleon1989",
        caveat: "Reported as approximately 9% per year, measured on CT." },
      cortex: { mean: -1.9, slow: -1.0, fast: -2.8, spread: "sd_patients", source: "sluimer2008",
        caveat: "Whole-brain atrophy rate, applied here to the cortex." },
    },
  },
};

/** Aortic stenosis haemodynamic progression, Otto 1997 (mean ± SD between patients). */
export const AS_PROGRESSION = {
  areaCm2PerYear: { mean: -0.12, sd: 0.19 },
  velocityMsPerYear: { mean: 0.32, sd: 0.34 },
  meanGradientMmHgPerYear: { mean: 7, sd: 7 },
  source: "otto1997",
} as const;

/** Otto 1997: alive without valve replacement 2 years after a given aortic jet velocity (± SE as reported). */
export const AS_EVENT_FREE_2Y = [
  { maxVelocity: 3, label: "< 3.0 m/s", percent: 84, pm: 16 },
  { maxVelocity: 4, label: "3.0–4.0 m/s", percent: 66, pm: 13 },
  { maxVelocity: Infinity, label: "> 4.0 m/s", percent: 21, pm: 18 },
] as const;
