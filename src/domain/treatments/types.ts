// Treatment-scenario evidence types. Every number that can move a 3D organ lives in evidence.json as an EvidenceEntry.
// Cohort averages from cited studies, never a prediction for an individual (see docs/outlook.md).

export type ConditionId = "lvh" | "as" | "ad";

export type StudyType = "rct" | "meta-analysis" | "placebo-arm" | "prospective-cohort" | "observational" | "guideline";

/** What an effect is measured in: LV mass index change (g/m²) or hippocampal volume change (%). */
export type Quantity = "lvmi_gm2" | "hippocampus_pct";

export interface EvidenceSource {
  id: string;
  cite: string; // short author-year label
  title: string;
  journal: string;
  doi: string;
  studyType: StudyType;
  n: number;
  durationMonths: number;
  population: string;
}

/** Change in `quantity` over `evidenceYears` of the cited study; `best` and `worst` are the favourable and unfavourable ends. */
export interface Effect {
  quantity: Quantity;
  likely: number;
  best: number;
  worst: number;
  evidenceYears: number;
}

export interface EvidenceEntry {
  id: string;
  condition: ConditionId;
  kind: "natural" | "treatment";
  label: string;
  /** Treatments in the same group are not combined: switching one on switches the others off. */
  group?: string;
  /** One sentence, no numbers: shown behind the info tip and used when the chat's reason is rejected. */
  why: string;
  caveat: string;
  sources: string[];
  /** Absent = listed with "no measured effect on the model". */
  effect?: Effect;
}

export interface EvidenceFile {
  sources: Record<string, EvidenceSource>;
  entries: EvidenceEntry[];
}
