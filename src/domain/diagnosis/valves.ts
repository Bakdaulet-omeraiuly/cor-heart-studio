// Valves: aortic stenosis (ACC/AHA 2020 stages), quantitative MR/AR, reported regurgitation and prolapse.
import { VALVE_IDS, type Severity, type ValveId } from "../schema/record";
import { gradeByArea, gradeByVelocity, worse, type AsGrade } from "../outlook/project";
import { round, type Ctx, type DopplerKind, type Grade4, type Num } from "./context";
import type { Evidence } from "./types";

export const VALVE_NAME: Record<ValveId, string> = { mitral_valve: "Mitral", aortic_valve: "Aortic", tricuspid_valve: "Tricuspid", pulmonary_valve: "Pulmonary" };
const KEBAB: Record<ValveId, string> = { mitral_valve: "mitral", aortic_valve: "aortic", tricuspid_valve: "tricuspid", pulmonary_valve: "pulmonary" };

/** Reported (qualitative) severity on the four-step scale used for comparisons. */
export function severityTo4(s: Severity | null | undefined): Grade4 | null {
  switch (s) {
    case "none": case "trace": return "none";
    case "mild": case "mild_to_moderate": return "mild";
    case "moderate": case "moderate_to_severe": return "moderate";
    case "severe": return "severe";
    default: return null;
  }
}
const pretty = (s: string) => s.replace(/_/g, " ");

// ------------------------------------------------------------------ aortic stenosis
/** ACC/AHA 2020 mean-gradient grade; below 20 mmHg it only counts as "mild" when no Vmax is available. */
export function gradeByMeanGradient(mmHg: number, hasVmax: boolean, asReported: boolean): AsGrade | null {
  if (mmHg >= 40) return "severe";
  if (mmHg >= 20) return "moderate";
  if (hasVmax) return null;
  return asReported ? "mild" : "none";
}

export const AVA_SEVERE_CM2 = 1.0;
export const VMAX_VERY_SEVERE = 5.0;
export const MG_VERY_SEVERE = 60;

function aorticStenosis(c: Ctx) {
  const V: ValveId = "aortic_valve";
  const reported = c.valveFindings(V, "stenosis")[0];
  const vmax = c.valveNum(V, "peakVelocity", "stenosis") ?? c.doppler(V, "peakVelocity");
  const mg = c.valveNum(V, "meanGradient", "stenosis") ?? c.doppler(V, "meanGradient");
  const ava = c.valveNum(V, "valveArea", "stenosis");
  const reportedEv = reported?.severity ? c.ev("R-DX-AS-04", `valveFindings[${V} stenosis].severity`, reported.severity) : null;
  const reported4 = severityTo4(reported?.severity);

  if (!vmax && !mg && !ava) {
    if (!reported) return;
    const why = "needed to grade aortic stenosis by the ACC/AHA criteria";
    c.need(`valveFindings[${V} stenosis].peakVelocity`, why);
    c.need(`valveFindings[${V} stenosis].meanGradient`, why);
    c.need(`valveFindings[${V} stenosis].valveArea`, why);
    const sev = reported.severity ?? "unspecified";
    c.finding({ condition: "aortic-stenosis", label: `Aortic stenosis, ${pretty(sev)} (reported, not measured)`, grade: pretty(sev), basis: "supported",
      evidence: [reportedEv ?? c.ev("R-DX-AS-04", `valveFindings[${V} stenosis].condition`, "stenosis")], organ: "heart", target: V });
    if (reported4) c.facts.as = { grade: reported4, evidence: reportedEv ? [reportedEv] : [], gradientSevere: false };
    return;
  }

  const evidence: Evidence[] = [];
  if (vmax) evidence.push(c.evNum("R-DX-AS-01", vmax));
  if (mg) evidence.push(c.evNum("R-DX-AS-01", mg));
  if (ava) evidence.push(c.evNum("R-DX-AS-02", ava));

  const gV = vmax ? gradeByVelocity(vmax.value) : null;
  const gM = mg ? gradeByMeanGradient(mg.value, !!vmax, !!reported) : null;
  const gGrad = gV && gM ? worse(gV, gM) : gV ?? gM;
  const gradientSevere = gGrad === "severe";
  const avaSevere = !!ava && ava.value <= AVA_SEVERE_CM2;
  const verySevere = (vmax && vmax.value >= VMAX_VERY_SEVERE) || (mg && mg.value >= MG_VERY_SEVERE);

  let grade: Grade4 | "discordant";
  let label: string;
  if (!gGrad) {
    // valve area only
    grade = gradeByArea(ava!.value);
    label = `Aortic stenosis, ${grade} by valve area (gradients not recorded)`;
    const why = "valve area alone does not stage aortic stenosis; gradients are needed to confirm the grade";
    c.need(`valveFindings[${V} stenosis].peakVelocity`, why);
    c.need(`valveFindings[${V} stenosis].meanGradient`, why);
  } else if (!gradientSevere && avaSevere) {
    grade = "discordant";
    label = "Aortic stenosis, low-gradient: valve area in the severe range, gradients not severe";
    lowGradientAlternatives(c, ava!, evidence);
  } else {
    grade = gGrad;
    label = grade === "none" ? "No haemodynamically significant aortic stenosis" : `Aortic stenosis, ${grade}${verySevere ? " (very high velocity or gradient)" : ""}`;
    if (gradientSevere && ava && !avaSevere) {
      c.alt({ condition: "aortic-stenosis-high-flow", label: "High-flow state or valve-area overestimation (severe gradient, valve area above the severe range)",
        basis: "possible", evidence: [...evidence], organ: "heart", target: V });
      c.num("observations.strokeVolume", "stroke volume shows whether a high-flow state explains a severe gradient with a non-severe valve area");
    }
    if (!ava && gGrad !== "none") c.need(`valveFindings[${V} stenosis].valveArea`, "valve area confirms whether the gradient and the orifice size agree");
  }

  c.finding({ condition: "aortic-stenosis", label, grade, basis: "rule-defined", evidence: reportedEv ? [...evidence, reportedEv] : evidence, organ: "heart", target: V });
  c.facts.as = { grade, evidence, gradientSevere };

  if (verySevere) {
    const parts = [vmax && vmax.value >= VMAX_VERY_SEVERE ? `peak velocity ${vmax.value} m/s` : null, mg && mg.value >= MG_VERY_SEVERE ? `mean gradient ${mg.value} mmHg` : null].filter(Boolean);
    c.redFlag(`Very severe aortic stenosis (${parts.join(", ")}): urgent specialist (heart valve team) review.`);
  }
  if (reported4 && grade !== "discordant" && reported4 !== grade && reportedEv) {
    c.alt({ condition: "aortic-stenosis-grade-mismatch", label: `Reported severity (${pretty(reported!.severity!)}) differs from the measured grade (${grade}): check the measurements`,
      basis: "supported", evidence: [reportedEv, ...evidence], organ: "heart", target: V });
  }
}

function lowGradientAlternatives(c: Ctx, ava: Num, evidence: Evidence[]) {
  const V = "aortic_valve";
  const ef = c.num("observations.lvEjectionFraction") ?? c.derived("lvEfFromVolumes");
  const sv = c.num("observations.strokeVolume");
  const bsa = c.bsa("needed to index stroke volume and valve area (SVi, AVAi) in low-gradient aortic stenosis");
  const extra: Evidence[] = [];
  let svi: number | null = null, avai: number | null = null;
  if (ef) extra.push(c.evNum("R-DX-AS-02", ef));
  if (bsa) {
    extra.push(c.evNum("R-DX-BSA-01", bsa));
    avai = round(ava.value / bsa.value, 2);
    extra.push(c.ev("R-DX-AS-02", "derived.aorticValveAreaIndex", avai, "cm²/m²"));
    if (sv) {
      svi = round(sv.value / bsa.value, 1);
      extra.push(c.evNum("R-DX-AS-02", sv), c.ev("R-DX-AS-02", "derived.strokeVolumeIndex", svi, "mL/m²"));
    }
  }
  if (!sv) c.need("observations.strokeVolume", "stroke volume index separates low-flow from normal-flow low-gradient aortic stenosis");
  if (!ef) c.need("observations.lvEjectionFraction", "LVEF separates classical (reduced EF) from paradoxical (preserved EF) low-flow aortic stenosis");
  const ev = [...evidence, ...extra];
  const reduced = ef ? ef.value < 50 : null;
  if (reduced !== false) {
    // the ACC/AHA stage name goes into evidence, not the label, so every digit the user sees is backed by an Evidence value
    c.alt({ condition: "aortic-stenosis-classical-low-flow", label: "Classical low-flow, low-gradient severe aortic stenosis with reduced LVEF",
      basis: "possible", evidence: [...ev, c.ev("R-DX-AS-02", "derived.accAhaStage", "D2")], organ: "heart", target: V });
    c.need("additionalInvestigations.dobutamineStressEcho", "low-dose dobutamine stress echo distinguishes true-severe from pseudo-severe stenosis when LVEF is reduced");
  }
  if (reduced !== true) {
    const lowFlow = svi !== null && avai !== null && svi < 35 && avai <= 0.6;
    c.alt({ condition: "aortic-stenosis-paradoxical-low-flow", label: "Paradoxical low-flow, low-gradient severe aortic stenosis with preserved LVEF",
      basis: lowFlow ? "supported" : "possible", evidence: [...ev, c.ev("R-DX-AS-02", "derived.accAhaStage", "D3")], organ: "heart", target: V });
    c.need("additionalInvestigations.ctCalciumScore", "aortic valve calcium score on CT supports true-severe stenosis when gradients are low and LVEF is preserved");
  }
  c.alt({ condition: "aortic-stenosis-moderate-measurement-error", label: "Moderate aortic stenosis with valve-area underestimation (LVOT measurement) or small body size",
    basis: "possible", evidence: ev, organ: "heart", target: V });
}

// ------------------------------------------------------------------ regurgitation
type RegClass = "mild" | "moderate" | "severe" | "not severe";

const MR_SEVERE: Record<Exclude<DopplerKind, "peakVelocity" | "meanGradient">, number> = { VC: 0.7, RVol: 60, RF: 50, EROA: 0.4 };
export function classifyMr(kind: keyof typeof MR_SEVERE, v: number): RegClass { return v >= MR_SEVERE[kind] ? "severe" : "not severe"; }

export function classifyAr(kind: keyof typeof MR_SEVERE, v: number): RegClass {
  switch (kind) {
    case "VC": return v > 0.6 ? "severe" : v >= 0.3 ? "moderate" : "mild";
    case "RVol": return v >= 60 ? "severe" : v >= 30 ? "moderate" : "mild";
    case "RF": return v >= 50 ? "severe" : v >= 30 ? "moderate" : "mild";
    case "EROA": return v >= 0.3 ? "severe" : v >= 0.1 ? "moderate" : "mild";
  }
}

function quantitative(c: Ctx, valve: "mitral_valve" | "aortic_valve") {
  const rule = valve === "mitral_valve" ? "R-DX-MR-01" : "R-DX-AR-01";
  const classify = valve === "mitral_valve" ? classifyMr : classifyAr;
  const items: { n: Num; cls: RegClass }[] = [];
  for (const k of ["VC", "RVol", "RF", "EROA"] as const) {
    const n = c.doppler(valve, k);
    if (n) items.push({ n, cls: classify(k, n.value) });
  }
  if (!items.length) return null;
  const classes = new Set(items.map((i) => i.cls));
  const grade = classes.size === 1 ? items[0].cls : "discordant";
  return { grade, evidence: items.map((i) => c.evNum(rule, i.n)) };
}

function regurgitation(c: Ctx) {
  for (const valve of VALVE_IDS) {
    const reported = c.valveFindings(valve, "regurgitation")[0];
    const q = valve === "mitral_valve" || valve === "aortic_valve" ? quantitative(c, valve) : null;
    const name = VALVE_NAME[valve];
    const condition = `${KEBAB[valve]}-regurgitation`;
    const repEv = reported?.severity ? c.ev("R-DX-REG-01", `valveFindings[${valve} regurgitation].severity`, reported.severity) : null;
    const rep4 = severityTo4(reported?.severity);
    if (q) {
      const label = q.grade === "discordant" ? `${name} regurgitation: quantitative parameters disagree (integrative assessment needed)` : `${name} regurgitation, ${q.grade}`;
      c.finding({ condition, label, grade: q.grade, basis: "rule-defined", evidence: repEv ? [...q.evidence, repEv] : q.evidence, organ: "heart", target: valve });
      const severe = q.grade === "severe";
      const atLeastModerate = severe || q.grade === "moderate" || (q.grade === "discordant" && (rep4 === "moderate" || rep4 === "severe"));
      c.facts.regurg[valve] = { grade: q.grade, evidence: q.evidence, severe, atLeastModerate };
      const mismatch = rep4 && q.grade !== "discordant" && (q.grade === "not severe" ? rep4 === "severe" : rep4 !== q.grade);
      if (mismatch && repEv) {
        c.alt({ condition: `${condition}-grade-mismatch`, label: `Reported ${name.toLowerCase()} regurgitation severity differs from the quantitative grade: check the measurements`,
          basis: "supported", evidence: [repEv, ...q.evidence], organ: "heart", target: valve });
      }
    } else if (reported && rep4 !== "none") {
      const sev = reported.severity ?? "unspecified";
      c.finding({ condition, label: `${name} regurgitation, ${pretty(sev)} (reported)`, grade: pretty(sev), basis: "supported",
        evidence: [repEv ?? c.ev("R-DX-REG-01", `valveFindings[${valve} regurgitation].condition`, "regurgitation")], organ: "heart", target: valve });
      c.facts.regurg[valve] = { grade: sev, evidence: repEv ? [repEv] : [], severe: rep4 === "severe", atLeastModerate: rep4 === "moderate" || rep4 === "severe" };
    }
  }
}

function prolapse(c: Ctx) {
  for (const valve of VALVE_IDS) {
    if (!c.valveFindings(valve, "prolapse").length) continue;
    const ev = c.ev("R-DX-MVP-01", `valveFindings[${valve} prolapse].condition`, "prolapse");
    c.finding({ condition: `${KEBAB[valve]}-valve-prolapse`, label: `${VALVE_NAME[valve]} valve prolapse (reported)`, basis: "supported", evidence: [ev], organ: "heart", target: valve });
    if (valve === "mitral_valve") c.facts.mitralProlapse = ev;
  }
}

export function assessValves(c: Ctx) {
  aorticStenosis(c);
  regurgitation(c);
  prolapse(c);
}
