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
  devereux2004: { id: "devereux2004", cite: "LIFE · Devereux 2004", title: "Regression of hypertensive left ventricular hypertrophy by losartan compared with atenolol: the LIFE trial",
    journal: "Circulation 110:1456–62", doi: "10.1161/01.CIR.0000141573.44737.5A", design: "Randomised double-blind trial, echo substudy, 457 losartan / 459 atenolol, yearly echo for 5 years" },
  gerdts2009: { id: "gerdts2009", cite: "Gerdts 2009", title: "Pulse pressure, left ventricular function and cardiovascular events during antihypertensive treatment (the LIFE study)",
    journal: "Blood Press 18:180–6", doi: "10.1080/08037050903047202", design: "LIFE echo substudy, 883 patients, 4.8 years of treatment" },
  klingbeil2003: { id: "klingbeil2003", cite: "Klingbeil 2003", title: "A meta-analysis of the effects of treatment on left ventricular mass in essential hypertension",
    journal: "Am J Med 115:41–6", doi: "10.1016/s0002-9343(03)00158-x", design: "Meta-analysis, 80 double-blind RCTs, 3767 treated / 346 placebo" },
  devereux1986: { id: "devereux1986", cite: "Devereux 1986", title: "Echocardiographic assessment of left ventricular hypertrophy: comparison to necropsy findings",
    journal: "Am J Cardiol 57:450–8", doi: "10.1016/0002-9149(86)90771-x", design: "Echo vs necropsy LV mass, 55 patients" },
  lang2015: { id: "lang2015", cite: "ASE/EACVI 2015", title: "Recommendations for cardiac chamber quantification by echocardiography in adults",
    journal: "J Am Soc Echocardiogr 28:1–39", doi: "10.1016/j.echo.2014.10.003", design: "Chamber quantification guideline" },
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

// ---------------------------------------------------------------- hypertensive LVH on treatment

export type LvhArm = "losartan" | "atenolol";

/** LIFE echo substudy: change in LV mass index from baseline to the last study (mean ± SD between patients). */
export const LVH_TREATMENT: Record<LvhArm, { label: string; lvmiChange: number; sd: number; source: string }> = {
  losartan: { label: "Losartan-based", lvmiChange: -21.7, sd: 21.8, source: "devereux2004" },
  atenolol: { label: "Atenolol-based", lvmiChange: -17.7, sd: 19.6, source: "devereux2004" },
};

/** Mean treatment time in the LIFE echo substudy (Gerdts 2009), the time base for the LIFE changes. */
export const LVH_FOLLOW_UP_YEARS = 4.8;

/** Klingbeil 2003: LV mass index change by drug class, adjusted for treatment duration and diastolic pressure change. */
export const LVH_CLASS_EFFECT = [
  { label: "Angiotensin II receptor blockers", percent: -13, ci: [-8, -18] },
  { label: "Calcium antagonists", percent: -11, ci: [-9, -13] },
  { label: "ACE inhibitors", percent: -10, ci: [-8, -12] },
  { label: "Diuretics", percent: -8, ci: [-5, -10] },
  { label: "Beta-blockers", percent: -6, ci: [-3, -8] },
] as const;

/** ASE/EACVI 2015 upper normal LV mass index (linear method). */
export const LVMI_UPPER_NORMAL = { men: 115, women: 95 } as const;
