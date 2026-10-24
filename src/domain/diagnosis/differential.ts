// Phase 2: alternative explanations that combine findings across conditions (docs/research/diagnosis-engine.md §2).
// Evidence items are re-tagged with the R-DX-DIFF-* rule that links them to the alternative.
import type { CoronaryVessel } from "../coronary";
import type { Ctx, SymptomKey, Territory } from "./context";
import { ruleSource, type RuleId } from "./rules";
import type { Evidence } from "./types";

const retag = (rule: RuleId, ev: Evidence[]): Evidence[] => ev.map((e) => ({ ...e, rule, source: ruleSource(rule) }));
const VESSEL_TERRITORIES: Record<CoronaryVessel, Territory[]> = { LM: ["LAD", "LCx"], LAD: ["LAD"], LCx: ["LCx"], RCA: ["RCA"], PDA: ["RCA"] };
const AS_SYMPTOMS: SymptomKey[] = ["syncope", "angina", "dyspnoea", "heart_failure"];

function symptomEvidence(c: Ctx, rule: RuleId, keys: SymptomKey[]): Evidence[] {
  return keys.filter((k) => c.symptoms.has(k)).map((k) => c.ev(rule, "symptoms", k.replace("_", " ")));
}

function lab(c: Ctx, re: RegExp) {
  return (c.p.record.labs ?? []).find((l) => re.test(l.analyte) && l.value !== null);
}

export function assessDifferential(c: Ctx) {
  const f = c.facts;
  const lvefLow = f.lvef && f.lvef.value < 50 ? f.lvef : null;
  const lvDys: Evidence[] = [...(lvefLow ? [lvefLow.evidence] : []), ...(f.lvDilated ?? [])];
  const wmaAll = Object.values(f.wma).flat();
  const cadAtLeast3 = f.cad && !["0", "1", "2"].includes(f.cad.category);

  // ---- symptomatic severe AS (red flag)
  if (f.as?.grade === "severe" && AS_SYMPTOMS.some((k) => c.symptoms.has(k))) {
    c.redFlag("Severe aortic stenosis with reported symptoms: urgent specialist (heart valve team) review.");
  }

  // ---- heart failure
  if (lvefLow) {
    const ev = [...retag("R-DX-DIFF-HF", [lvefLow.evidence]), ...symptomEvidence(c, "R-DX-DIFF-HF", ["dyspnoea", "heart_failure"])];
    const np = lab(c, /bnp|natriuretic/i);
    if (np) ev.push(c.ev("R-DX-DIFF-HF", `labs[${/nt/i.test(np.analyte) ? "NT-proBNP" : "BNP"}]`, np.value!, np.unit));
    else c.need("labs.natriureticPeptide", "heart failure needs symptoms or signs plus raised natriuretic peptide or congestion (universal definition)");
    c.alt({ condition: "heart-failure", label: "Heart failure (clinical syndrome: needs symptoms or signs and natriuretic peptide or congestion)",
      basis: "possible", evidence: ev, organ: "heart", target: "lv" });
  }

  // ---- ischaemic cause
  const matched: Evidence[] = [];
  if (f.cad) {
    for (const v of f.cad.vessels) {
      if (v.percent < 50) continue;
      for (const t of VESSEL_TERRITORIES[v.vessel]) if (f.wma[t]) matched.push(v.evidence, ...f.wma[t]!);
    }
  }
  if (lvDys.length && (wmaAll.length || cadAtLeast3)) {
    c.alt({ condition: "ischaemic-cardiomyopathy", label: "Ischaemic cause of LV dysfunction", basis: "supported",
      evidence: retag("R-DX-DIFF-ISCH", [...lvDys, ...wmaAll, ...(cadAtLeast3 ? f.cad!.evidence : [])]), organ: "heart", target: "lv" });
    if (!f.cad) c.need("coronaryFindings", "coronary imaging confirms or excludes the ischaemic cause suggested by the wall-motion pattern");
  } else if (matched.length) {
    c.alt({ condition: "ischaemic-heart-disease", label: "Ischaemic heart disease (wall-motion abnormality in the territory of a significant stenosis)",
      basis: "supported", evidence: retag("R-DX-DIFF-ISCH", [...new Set(matched)]), organ: "heart", target: "lv" });
  } else if ((lvDys.length || wmaAll.length) && !f.cad) {
    c.alt({ condition: lvDys.length ? "ischaemic-cardiomyopathy" : "ischaemic-heart-disease", label: lvDys.length ? "Ischaemic cause of LV dysfunction" : "Ischaemic heart disease",
      basis: "possible", evidence: retag("R-DX-DIFF-ISCH", [...lvDys, ...wmaAll]), organ: "heart", target: "lv" });
    c.need("coronaryFindings", "an ischaemic cause cannot be confirmed or excluded without coronary imaging");
  }

  // ---- valvular cause
  const mr = f.regurg.mitral_valve, ar = f.regurg.aortic_valve, tr = f.regurg.tricuspid_valve;
  const valveSevere: Evidence[] = [
    ...(f.as && (f.as.grade === "severe" || f.as.grade === "discordant") ? f.as.evidence : []),
    ...(mr?.severe ? mr.evidence : []), ...(ar?.severe ? ar.evidence : []),
  ];
  if (lvDys.length && valveSevere.length) {
    c.alt({ condition: "valvular-lv-dysfunction", label: "Valvular cause of LV dysfunction or dilatation", basis: "supported",
      evidence: retag("R-DX-DIFF-VALV", [...lvDys, ...valveSevere]), organ: "heart", target: "lv" });
  }

  // ---- non-ischaemic dilated cardiomyopathy
  if (lvefLow && f.lvDilated && !wmaAll.length && (!f.cad || !cadAtLeast3)) {
    c.alt({ condition: "dilated-cardiomyopathy", label: "Non-ischaemic dilated cardiomyopathy", basis: "possible",
      evidence: retag("R-DX-DIFF-DCM", lvDys), organ: "heart", target: "lv" });
  }

  // ---- LV hypertrophy / thick walls
  const lvh = f.lvMassIncreased ?? f.concentricRemodelling ?? f.wallThick;
  if (lvh) {
    const base = retag("R-DX-DIFF-LVH", lvh);
    const sbp = c.num("observations.systolicBP", "blood pressure is needed to judge a hypertensive cause of LV hypertrophy");
    const htn = !!sbp && sbp.value >= 140;
    c.alt({ condition: "hypertensive-heart-disease", label: "Hypertensive heart disease", basis: htn ? "supported" : "possible",
      evidence: sbp ? [...base, c.evNum("R-DX-DIFF-LVH", sbp)] : base, organ: "heart", target: "lv" });
    if (f.as && ["moderate", "severe", "discordant"].includes(f.as.grade)) {
      c.alt({ condition: "aortic-stenosis-afterload", label: "Pressure overload from aortic stenosis", basis: "supported",
        evidence: [...base, ...retag("R-DX-DIFF-LVH", f.as.evidence)], organ: "heart", target: "aortic_valve" });
    }
    if (f.maxWallMm && f.maxWallMm.value >= 15) {
      c.alt({ condition: "hypertrophic-cardiomyopathy", label: "Hypertrophic cardiomyopathy (maximal wall thickness in the HCM range)", basis: "possible",
        evidence: [c.evNum("R-DX-DIFF-LVH", f.maxWallMm), ...base], organ: "heart", target: "lv" });
    }
  }

  // ---- mitral regurgitation mechanism
  if (mr && mr.grade !== "none") {
    const mrEv = mr.evidence.length ? mr.evidence : [];
    if (f.mitralProlapse) {
      c.alt({ condition: "primary-mitral-regurgitation", label: "Primary (degenerative) mitral regurgitation due to prolapse", basis: "supported",
        evidence: retag("R-DX-DIFF-MR", [...mrEv, f.mitralProlapse]), organ: "heart", target: "mitral_valve" });
    } else if (lvDys.length || wmaAll.length) {
      c.alt({ condition: "secondary-mitral-regurgitation", label: "Secondary (functional) mitral regurgitation from LV remodelling", basis: "possible",
        evidence: retag("R-DX-DIFF-MR", [...mrEv, ...lvDys, ...wmaAll]), organ: "heart", target: "mitral_valve" });
    }
  }

  // ---- LA enlargement
  if (f.laEnlarged) {
    const base = retag("R-DX-DIFF-LA", f.laEnlarged);
    let explained = false;
    if (mr?.atLeastModerate) {
      explained = true;
      c.alt({ condition: "la-enlargement-mitral-regurgitation", label: "LA enlargement from mitral regurgitation", basis: "supported",
        evidence: [...base, ...retag("R-DX-DIFF-LA", mr.evidence)], organ: "heart", target: "la" });
    }
    if (f.atrialFibrillation) {
      explained = true;
      c.alt({ condition: "la-enlargement-atrial-fibrillation", label: "LA enlargement with atrial fibrillation", basis: "supported",
        evidence: [...base, ...retag("R-DX-DIFF-LA", [f.atrialFibrillation])], organ: "heart", target: "la" });
    }
    if (!explained) {
      c.alt({ condition: "raised-lv-filling-pressure", label: "Raised LV filling pressure (diastolic dysfunction)", basis: "possible", evidence: base, organ: "heart", target: "la" });
      if (!c.p.record.echo?.diastolicFunction) c.need("echo.diastolicFunction", "E/e′ and diastolic grading test whether raised filling pressure explains the LA enlargement");
    }
  }

  // ---- RV
  if (f.rvAbnormal) {
    const base = retag("R-DX-DIFF-RV", f.rvAbnormal);
    const left: Evidence[] = [...(lvefLow ? [lvefLow.evidence] : []), ...(mr?.severe ? mr.evidence : []), ...(f.as?.grade === "severe" ? f.as.evidence : [])];
    if (left.length) {
      c.alt({ condition: "rv-left-heart-disease", label: "Right-heart involvement secondary to left-heart disease", basis: "supported",
        evidence: [...base, ...retag("R-DX-DIFF-RV", left)], organ: "heart", target: "rv" });
    }
    if (tr?.atLeastModerate) {
      c.alt({ condition: "rv-tricuspid-regurgitation", label: "RV volume overload from tricuspid regurgitation", basis: "supported",
        evidence: [...base, ...retag("R-DX-DIFF-RV", tr.evidence)], organ: "heart", target: "rv" });
    }
    const pasp = c.num("observations.pasp", "estimated pulmonary artery systolic pressure is needed to assess pulmonary hypertension");
    c.alt({ condition: "pulmonary-hypertension", label: "Pulmonary hypertension", basis: "possible",
      evidence: pasp ? [...base, c.evNum("R-DX-DIFF-RV", pasp)] : base, organ: "heart", target: "rv" });
  }

  // ---- prolonged QTc
  if (f.qtcProlonged) {
    const base = retag("R-DX-DIFF-QTC", f.qtcProlonged);
    const meds = c.p.record.medications ?? [];
    if (meds.length) {
      c.alt({ condition: "qt-prolonging-drugs", label: "QT-prolonging medication (review the medication list)", basis: "possible",
        evidence: [...base, c.ev("R-DX-DIFF-QTC", "derived.medicationCount", meds.length)], organ: "heart", target: "myocardium" });
    }
    const electrolytes: Evidence[] = [];
    for (const [name, re] of [["potassium", /potassium|^k\+?$/i], ["magnesium", /magnesium|^mg$/i], ["calcium", /calcium|^ca$/i]] as const) {
      const l = lab(c, re);
      if (l) electrolytes.push(c.ev("R-DX-DIFF-QTC", `labs[${name}]`, l.value!, l.unit));
      else c.need(`labs.${name}`, "electrolyte disturbance is a reversible cause of QTc prolongation");
    }
    c.alt({ condition: "electrolyte-disturbance", label: "Electrolyte disturbance (potassium, magnesium, calcium)", basis: "possible",
      evidence: [...base, ...electrolytes], organ: "heart", target: "myocardium" });
    c.alt({ condition: "congenital-long-qt", label: "Congenital long-QT syndrome", basis: "possible", evidence: base, organ: "heart", target: "myocardium" });
    if (f.wideQrs) {
      c.alt({ condition: "qt-prolonged-by-wide-qrs", label: "QT lengthened by a wide QRS (assess the JT interval)", basis: "supported",
        evidence: [...base, ...retag("R-DX-DIFF-QTC", [f.wideQrs])], organ: "heart", target: "myocardium" });
    }
  }
}
