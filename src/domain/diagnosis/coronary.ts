// Coronary arteries: CAD-RADS 2.0 via the existing cadRads() (src/domain/coronary.ts).
import { cadRads, type CadRadsCategory } from "../coronary";
import type { Ctx } from "./context";

const CATEGORY_WORDS: Record<CadRadsCategory, string> = {
  "0": "no plaque or stenosis",
  "1": "minimal stenosis",
  "2": "mild stenosis",
  "3": "moderate stenosis",
  "4A": "severe stenosis",
  "4B": "left main or three-vessel severe disease",
  "5": "total occlusion",
};

export function assessCoronary(c: Ctx) {
  const lesions = c.p.coronaryFindings;
  if (!lesions.length) return;
  const { category, driver } = cadRads(lesions);
  const vessels = lesions.map((l) => ({
    vessel: l.vessel,
    percent: l.stenosisPercent,
    evidence: c.ev("R-DX-CAD-01", `coronaryFindings[${l.vessel}${l.segment ? ` ${l.segment}` : ""}].stenosisPercent`, l.stenosisPercent, "%"),
  }));
  const evidence = [...vessels.map((v) => v.evidence), c.ev("R-DX-CAD-01", "derived.cadRads", category)];
  const target = driver ? `coronary_vessels#${driver.vessel}${driver.segment ? `:${driver.segment}` : ""}` : "coronary_vessels";
  c.finding({ condition: "coronary-stenosis", label: `Coronary artery disease, CAD-RADS ${category} (${CATEGORY_WORDS[category]})`, grade: category,
    basis: "rule-defined", evidence, organ: "heart", target });
  c.facts.cad = { category, evidence, vessels };

  if (category === "4B") c.redFlag(`CAD-RADS ${category} (left main or three-vessel severe disease): urgent specialist review.`);
  if (category === "5") c.redFlag(`CAD-RADS ${category} (total coronary occlusion): urgent specialist review.`);
  if (category === "3" || category === "4A") {
    const hasFunctional = (c.p.record.additionalInvestigations ?? []).some((i) => i.type === "exercise_stress_test");
    if (!hasFunctional) c.need("additionalInvestigations.functionalTest", "moderate or severe stenosis: functional testing (stress imaging or FFR-CT) shows whether it limits flow");
  }
}
