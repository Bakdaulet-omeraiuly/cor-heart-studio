// ECG: QTc (AHA/ACCF/HRS 2009 Part IV), markedly prolonged QTc (AHA/ACCF 2010), PR, QRS, rate, reported atrial arrhythmia.
// QTc formulas are reused from src/domain/ecg.ts.
import { qtcBazett, qtcFridericia } from "../ecg";
import type { Ctx, Num, Sex } from "./context";
import type { Evidence } from "./types";

export const QTC_PROLONGED_MS: Record<Sex, number> = { male: 450, female: 460 };
export const QTC_SHORT_MS = 390;
export const QTC_RED_FLAG_MS = 500;
export const PR_UPPER_MS = 200;
export const QRS_WIDE_MS = 120;
export const HR_BRADY = 50;
export const HR_TACHY = 100;

export type QtcGrade = "short" | "normal" | "prolonged" | "indeterminate";

export function qtcGrade(ms: number, sex: Sex | null): QtcGrade {
  if (ms <= QTC_SHORT_MS) return "short";
  if (sex) return ms >= QTC_PROLONGED_MS[sex] ? "prolonged" : "normal";
  if (ms >= QTC_PROLONGED_MS.female) return "prolonged";
  if (ms < QTC_PROLONGED_MS.male) return "normal";
  return "indeterminate";
}

const METHODS: [string, RegExp][] = [["Bazett", /bazett/i], ["Fridericia", /frideric/i], ["Framingham", /framingham|sagie/i], ["Hodges", /hodges/i]];
const QTC_LABEL: Record<QtcGrade | "formula-dependent", string> = {
  short: "Short QTc", normal: "QTc within the normal range", prolonged: "Prolonged QTc",
  indeterminate: "QTc in the sex-dependent band: classification needs biological sex",
  "formula-dependent": "QTc classification depends on the correction formula (Bazett vs Fridericia)",
};

function qtc(c: Ctx, hr: Num | null) {
  const rep = c.num("ecg.qtc");
  const ev: Evidence[] = [];
  let grade: QtcGrade | "formula-dependent";
  let redFlagMs: number | null = null;
  const anyProlonged: boolean[] = [];
  if (rep) {
    ev.push(c.evNum("R-DX-QTC-01", rep));
    const raw = c.p.observations["ecg.qtc"]?.method;
    const method = raw ? METHODS.find(([, re]) => re.test(raw))?.[0] : undefined;
    if (method) ev.push(c.ev("R-DX-QTC-01", "ecg.qtcCorrectionMethod", method));
    grade = qtcGrade(rep.value, c.sex);
    anyProlonged.push(grade === "prolonged");
    if (rep.value > QTC_RED_FLAG_MS) redFlagMs = rep.value;
  } else {
    const qt = c.num("ecg.qtInterval");
    if (!qt) return;
    if (!hr) { c.need("ecg.heartRate", "heart rate is needed to correct the QT interval (QTc)"); return; }
    const rr = 60 / hr.value;
    const b = Math.round(qtcBazett(qt.value, rr));
    const f = Math.round(qtcFridericia(qt.value, rr));
    ev.push(c.evNum("R-DX-QTC-01", qt), c.evNum("R-DX-QTC-01", hr), c.ev("R-DX-QTC-01", "derived.qtcBazett", b, "ms"), c.ev("R-DX-QTC-01", "derived.qtcFridericia", f, "ms"));
    const gb = qtcGrade(b, c.sex), gf = qtcGrade(f, c.sex);
    grade = gb === gf ? gb : "formula-dependent";
    anyProlonged.push(gb === "prolonged", gf === "prolonged");
    if (gb === "indeterminate" || gf === "indeterminate") c.needSex("QTc limits are sex-specific (AHA/ACCF/HRS)");
    if (f > QTC_RED_FLAG_MS) redFlagMs = f;
  }
  if (c.sex) ev.push(c.ev("R-DX-QTC-01", "demographics.biologicalSex", c.sex));
  if (grade === "indeterminate") c.needSex("QTc limits are sex-specific (AHA/ACCF/HRS)");
  c.finding({ condition: "qtc", label: QTC_LABEL[grade], grade, basis: "rule-defined", evidence: ev, organ: "heart", target: "myocardium" });
  if (anyProlonged.some(Boolean)) c.facts.qtcProlonged = ev;
  if (redFlagMs !== null) c.redFlag(`Markedly prolonged QTc (${redFlagMs} ms): urgent specialist review.`);
}

const AF = /atrial fibrillation|\ba-?fib\b|\baf\b/i;
const FLUTTER = /atrial flutter/i;
const NEG = /\b(no|not|without|absent|negative|excluded)\b/i;

function rhythm(c: Ctx) {
  const e = c.p.record.ecg;
  const texts = [e?.rhythm, ...(e?.arrhythmias ?? [])].filter((x): x is string => !!x && !NEG.test(x));
  if (texts.some((t) => AF.test(t))) {
    const ev = c.ev("R-DX-RHY-01", "ecg.rhythm", "atrial fibrillation");
    c.finding({ condition: "atrial-fibrillation", label: "Atrial fibrillation (reported)", basis: "supported", evidence: [ev], organ: "heart", target: "la" });
    c.facts.atrialFibrillation = ev;
  }
  if (texts.some((t) => FLUTTER.test(t))) {
    c.finding({ condition: "atrial-flutter", label: "Atrial flutter (reported)", basis: "supported", evidence: [c.ev("R-DX-RHY-01", "ecg.rhythm", "atrial flutter")], organ: "heart", target: "ra" });
  }
}

export function assessEcg(c: Ctx) {
  const hr = c.num("ecg.heartRate") ?? c.num("observations.heartRate");
  qtc(c, hr);
  const pr = c.num("ecg.prInterval");
  if (pr && pr.value > PR_UPPER_MS) {
    c.finding({ condition: "first-degree-av-block", label: "PR prolongation (first-degree AV block)", basis: "rule-defined", evidence: [c.evNum("R-DX-PR-01", pr)], organ: "heart", target: "myocardium" });
  }
  const qrs = c.num("ecg.qrsDuration");
  if (qrs && qrs.value >= QRS_WIDE_MS) {
    const ev = c.evNum("R-DX-QRS-01", qrs);
    c.finding({ condition: "wide-qrs", label: "Wide QRS (bundle-branch block or intraventricular conduction delay)", basis: "rule-defined", evidence: [ev], organ: "heart", target: "myocardium" });
    c.facts.wideQrs = ev;
  }
  if (hr && hr.value < HR_BRADY) {
    c.finding({ condition: "bradycardia", label: "Heart rate in the bradycardia range", basis: "rule-defined", evidence: [c.evNum("R-DX-HR-01", hr)], organ: "heart", target: "myocardium" });
  } else if (hr && hr.value > HR_TACHY) {
    c.finding({ condition: "tachycardia", label: "Heart rate in the tachycardia range", basis: "rule-defined", evidence: [c.evNum("R-DX-HR-01", hr)], organ: "heart", target: "myocardium" });
  }
  rhythm(c);
}
