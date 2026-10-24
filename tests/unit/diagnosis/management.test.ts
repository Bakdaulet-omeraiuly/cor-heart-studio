import { describe, expect, it } from "vitest";
import type { Assessment } from "@/domain/diagnosis";
import { assessIncludingUnverifiedOptions } from "@/domain/diagnosis/assess";
import { CATALOGUE } from "@/domain/diagnosis/management";
import { PatientRecordSchema } from "@/domain/schema/record";
import { missingFields, o, run, type Rec } from "./helpers";

const review = (extra: Rec): Assessment => assessIncludingUnverifiedOptions(PatientRecordSchema.parse({ patientId: "T-1", studyId: "S-1", ...extra }));
const ids = (a: Assessment) => (a.options ?? []).map((x) => x.appliesBecause[0]?.rule);
const hf = (ef: number, symptoms?: unknown[]) => ({ observations: { lvEjectionFraction: o(ef, "%") }, ...(symptoms ? { symptoms } : {}) }) as Rec;

describe("management options — verified entry (ARNi in HFrEF, AHA/ACC/HFSA 2022, COR 1 / LOE A)", () => {
  it("LVEF 40 % with NYHA class II → ARNi option with COR, LOE, evidence and source", () => {
    const a = run(hf(40, ["NYHA class II"]));
    expect(a.options).toHaveLength(1);
    const opt = a.options![0];
    expect(opt).toMatchObject({ findingCondition: "lv-ef-category", cor: "1", loe: "A" });
    expect(opt.source).toMatch(/doi:10\.1161\/CIR\.0000000000001063/);
    expect(opt.appliesBecause.map((e) => [e.field, e.value, e.rule])).toEqual([
      ["observations.lvEjectionFraction", 40, "R-DX-MGMT-HF-ARNI"], ["symptoms.nyhaClass", "II", "R-DX-MGMT-HF-ARNI"],
    ]);
    expect(opt.outlookInterventionId).toBeUndefined();
  });
  it("LVEF 41 % (mildly reduced) → no ARNi option", () => {
    expect(run(hf(41, ["NYHA class II"])).options).toEqual([]);
  });
  it("NYHA III and Arabic numerals count; NYHA I and IV do not", () => {
    expect(run(hf(30, ["NYHA III"])).options).toHaveLength(1);
    expect(run(hf(30, ["NYHA 2"])).options).toHaveLength(1);
    expect(run(hf(30, ["NYHA class I"])).options).toEqual([]);
    expect(run(hf(30, ["NYHA class IV"])).options).toEqual([]);
  });
  it("NYHA class not stated → no option, NYHA asked for; a denied entry does not count", () => {
    const a = run(hf(30, ["Exertional breathlessness"]));
    expect(a.options).toEqual([]);
    expect(missingFields(a)).toContain("symptoms.nyhaClass");
    expect(run(hf(30, [{ symptom: "NYHA class II", present: false }])).options).toEqual([]);
  });
  it("records without a finding the entry applies to get no options and no extra missing items", () => {
    const a = run({ observations: { lvEjectionFraction: o(60, "%") } });
    expect(a.options).toEqual([]);
    expect(missingFields(a)).not.toContain("symptoms.nyhaClass");
  });
});

describe("management options — unverified entries are never emitted by assess()", () => {
  const severeAs = (extra: Rec = {}) => ({ valveFindings: [{ valve: "aortic", condition: "stenosis", peakVelocity: o(4.5, "m/s") }], ...extra }) as Rec;
  it("symptomatic severe AS: no option from assess(), D1 entry in review mode", () => {
    const rec = severeAs({ symptoms: ["Exertional syncope"] });
    expect(run(rec).options).toEqual([]);
    expect(ids(review(rec))).toContain("R-DX-MGMT-AS-AVR-D1");
  });
  it("unverified entries add nothing to missing[] in assess()", () => {
    expect(missingFields(run(severeAs()))).not.toContain("symptoms");
  });
  it("every unverified catalogue entry says why", () => {
    for (const e of CATALOGUE) if (!e.verified) expect(e.verifiedBy.length, e.id).toBeGreaterThan(5);
  });
});

describe("management options — condition boundaries (review mode)", () => {
  const as = (extra: Rec) => review({ valveFindings: [{ valve: "aortic", condition: "stenosis", peakVelocity: o(4.4, "m/s") }], ...extra } as Rec);
  it("severe AS: symptomatic → D1; explicitly asymptomatic with LVEF 49 → C2; LVEF 50 → none; unknown → symptoms missing", () => {
    expect(ids(as({ symptoms: ["Chest pain"] }))).toEqual(["R-DX-MGMT-AS-AVR-D1"]);
    expect(ids(as({ symptoms: ["Asymptomatic"], observations: { lvEjectionFraction: o(49, "%") } }))).toEqual(["R-DX-MGMT-AS-AVR-C2"]);
    expect(ids(as({ symptoms: ["Asymptomatic"], observations: { lvEjectionFraction: o(50, "%") } }))).toEqual([]);
    expect(ids(as({ observations: { lvEjectionFraction: o(45, "%") } }))).not.toContain("R-DX-MGMT-AS-AVR-C2");
  });
  it("all cardinal symptoms denied counts as asymptomatic", () => {
    const denied = ["Syncope", "Chest pain", "Shortness of breath", "Oedema"].map((symptom) => ({ symptom, present: false }));
    expect(ids(as({ symptomDetails: denied, observations: { lvEjectionFraction: o(40, "%") } }))).toContain("R-DX-MGMT-AS-AVR-C2");
  });
  it("severe AR, asymptomatic: LVEF 55 → C2, LVEF 56 → none", () => {
    const ar = (ef: number) => review({ symptoms: ["asymptomatic"], observations: { lvEjectionFraction: o(ef, "%") },
      doppler: [{ measurement: "vena contracta", value: 0.7, unit: "cm", valve: "aortic" }] });
    expect(ids(ar(55))).toContain("R-DX-MGMT-AR-AVR-C2");
    expect(ids(ar(56))).not.toContain("R-DX-MGMT-AR-AVR-C2");
  });
  it("HF by EF band with symptoms: 40 → HFrEF entries, 41 and 49 → HFmrEF, 50 → HFpEF", () => {
    const at = (ef: number) => ids(review(hf(ef, ["Shortness of breath", "NYHA class II"])));
    expect(at(40)).toEqual(["R-DX-MGMT-HF-ARNI", "R-DX-MGMT-HF-SGLT2I-REF"]);
    expect(at(41)).toEqual(["R-DX-MGMT-HF-SGLT2I-MREF", "R-DX-MGMT-HF-GDMT-MREF"]);
    expect(at(49)).toEqual(["R-DX-MGMT-HF-SGLT2I-MREF", "R-DX-MGMT-HF-GDMT-MREF"]);
    expect(at(50)).toEqual(["R-DX-MGMT-HF-SGLT2I-PEF"]);
  });
  it("severe primary MR needs prolapse and symptoms", () => {
    const mr = (prolapse: boolean) => review({ symptoms: ["Shortness of breath"], valveFindings: [{ valve: "mitral", condition: "regurgitation", severity: "severe" },
      ...(prolapse ? [{ valve: "mitral", condition: "prolapse" }] : [])] } as Rec);
    expect(ids(mr(true))).toContain("R-DX-MGMT-MR-SURG-D");
    expect(ids(mr(false))).not.toContain("R-DX-MGMT-MR-SURG-D");
  });
  it("coronary: CAD-RADS 0 → no statin option, CAD-RADS 1 → statin option linked to the outlook intervention", () => {
    expect(ids(review({ coronaryFindings: [{ vessel: "LAD", stenosisPercent: 0 }] }))).not.toContain("R-DX-MGMT-CCD-STATIN");
    const a = review({ coronaryFindings: [{ vessel: "LAD", stenosisPercent: 20 }] });
    expect(a.options?.find((x) => x.appliesBecause[0]?.rule === "R-DX-MGMT-CCD-STATIN")?.outlookInterventionId).toBe("statin");
  });
});

describe("management options — content rules", () => {
  it("labels carry no doses and no drug names, only classes (SGLT2 is a class name); COR values are the guideline's", () => {
    for (const e of CATALOGUE) {
      expect(e.label.replace(/SGLT2/g, "SGLT"), e.id).not.toMatch(/\d|\bmg\b|sacubitril|valsartan|dapagliflozin|empagliflozin|atorvastatin|rosuvastatin/i);
      expect(["1", "2a", "2b", "3-no-benefit", "3-harm"]).toContain(e.cor);
      expect(e.source, e.id).toMatch(/doi:10\./);
    }
  });
  it("options never change red flags", () => {
    const rec = { valveFindings: [{ valve: "aortic", condition: "stenosis", peakVelocity: o(5.2, "m/s") }], symptoms: ["Exertional syncope"] } as Rec;
    expect(review(rec).redFlags).toEqual(run(rec).redFlags);
  });
});
