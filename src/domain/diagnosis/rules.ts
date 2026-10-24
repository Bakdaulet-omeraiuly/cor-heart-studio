// Rule registry: every R-DX-* id the engine can cite, with its title and sources.
// The thresholds themselves live next to the code that applies them; the full table is in
// .kiro/specs/diagnosis-engine/design.md and docs/research/diagnosis-engine.md.
import { SRC, type SourceKey } from "./sources";

interface RuleDef { title: string; sources: SourceKey[] }

const R = <T extends Record<string, RuleDef>>(t: T) => t;

export const RULES = R({
  "R-DX-AS-01": { title: "Aortic stenosis grade from peak velocity and mean gradient", sources: ["ACC20"] },
  "R-DX-AS-02": { title: "Aortic stenosis: valve area and concordance with gradients", sources: ["ACC20", "EACVI17"] },
  "R-DX-AS-03": { title: "Very severe aortic stenosis", sources: ["ACC20"] },
  "R-DX-AS-04": { title: "Reported aortic stenosis severity", sources: ["ACC20"] },
  "R-DX-MR-01": { title: "Mitral regurgitation severity from quantitative parameters", sources: ["ACC20"] },
  "R-DX-AR-01": { title: "Aortic regurgitation severity from quantitative parameters", sources: ["ACC20"] },
  "R-DX-REG-01": { title: "Reported valve regurgitation", sources: ["ACC20"] },
  "R-DX-MVP-01": { title: "Reported valve prolapse", sources: ["ACC20"] },
  "R-DX-LVEF-01": { title: "LVEF category (reduced / mildly reduced / preserved)", sources: ["ESC21", "AHA22"] },
  "R-DX-LVEF-02": { title: "LVEF below the sex-specific normal range", sources: ["ASE15"] },
  "R-DX-LVEF-03": { title: "Reported vs volume-derived LVEF", sources: ["ASE15"] },
  "R-DX-LVDIL-01": { title: "LV end-diastolic diameter above the sex-specific normal range", sources: ["ASE15"] },
  "R-DX-LVDIL-02": { title: "LV end-diastolic volume index above the sex-specific normal range", sources: ["ASE15"] },
  "R-DX-LVH-01": { title: "LV mass index and relative wall thickness (geometry)", sources: ["ASE15"] },
  "R-DX-WALL-01": { title: "Wall thickness above the sex-specific normal range", sources: ["ASE15"] },
  "R-DX-WMA-01": { title: "Regional wall-motion abnormality by coronary territory", sources: ["AHA17SEG"] },
  "R-DX-LA-01": { title: "Left atrial volume index", sources: ["ASE15"] },
  "R-DX-RV-01": { title: "RV basal diameter", sources: ["ASE15"] },
  "R-DX-RV-02": { title: "RV systolic function (TAPSE, RVEF)", sources: ["ASE15"] },
  "R-DX-RA-01": { title: "RA minor-axis dimension (2010 limit; superseded by RA area / volume index)", sources: ["RUDSKI10"] },
  "R-DX-CAD-01": { title: "CAD-RADS 2.0 category", sources: ["CADRADS2"] },
  "R-DX-CAD-02": { title: "CAD-RADS high-risk anatomy and next test", sources: ["CADRADS2"] },
  "R-DX-QTC-01": { title: "QTc classification", sources: ["AHA09QT"] },
  "R-DX-QTC-02": { title: "Markedly prolonged QTc", sources: ["DREW10"] },
  "R-DX-PR-01": { title: "First-degree AV block", sources: ["BRADY18"] },
  "R-DX-QRS-01": { title: "Wide QRS", sources: ["AHA09IVCD"] },
  "R-DX-HR-01": { title: "Heart rate outside the normal sinus range", sources: ["BRADY18", "SVT15"] },
  "R-DX-RHY-01": { title: "Reported atrial arrhythmia", sources: ["AHA09QT"] },
  "R-DX-BRAIN-01": { title: "Hippocampal atrophy rate vs cohort ranges", sources: ["BARNES09", "NIAAA18"] },
  "R-DX-BRAIN-02": { title: "Ventricular expansion rate vs cohort means", sources: ["DELEON89", "NIAAA18"] },
  "R-DX-BSA-01": { title: "Body surface area for indexing", sources: ["MOSTELLER"] },
  "R-DX-DIFF-HF": { title: "Heart failure as an explanation of reduced LVEF", sources: ["UDHF21", "ESC21"] },
  "R-DX-DIFF-ISCH": { title: "Ischaemic cause of LV dysfunction", sources: ["AHA17SEG", "CADRADS2"] },
  "R-DX-DIFF-VALV": { title: "Valvular cause of LV dysfunction", sources: ["ACC20"] },
  "R-DX-DIFF-DCM": { title: "Non-ischaemic dilated cardiomyopathy", sources: ["ESC23CM"] },
  "R-DX-DIFF-LVH": { title: "Causes of LV hypertrophy", sources: ["ESH23", "ACC20", "ESC23CM"] },
  "R-DX-DIFF-MR": { title: "Mechanism of mitral regurgitation", sources: ["ACC20"] },
  "R-DX-DIFF-LA": { title: "Causes of LA enlargement", sources: ["ASE15", "ACC20"] },
  "R-DX-DIFF-RV": { title: "Causes of RV enlargement or dysfunction", sources: ["RUDSKI10", "ASE15"] },
  "R-DX-DIFF-QTC": { title: "Causes of QTc prolongation", sources: ["DREW10", "AHA09QT"] },
  "R-DX-DIFF-AS": { title: "Symptomatic severe aortic stenosis", sources: ["ACC20"] },
});

export type RuleId = keyof typeof RULES;

export const ruleSource = (id: RuleId): string => RULES[id].sources.map((s) => SRC[s]).join("; ");
