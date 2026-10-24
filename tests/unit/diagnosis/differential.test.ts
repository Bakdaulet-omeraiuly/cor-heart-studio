import { describe, expect, it } from "vitest";
import { alt, bsa2, female, male, missingFields, o, obsRec, run } from "./helpers";

describe("heart failure and LV dysfunction causes", () => {
  it("heart failure is possible below LVEF 50 % and natriuretic peptide is asked for", () => {
    const a = obsRec({ lvEjectionFraction: o(49, "%") });
    expect(alt(a, "heart-failure")?.basis).toBe("possible");
    expect(missingFields(a)).toContain("labs.natriureticPeptide");
    expect(alt(obsRec({ lvEjectionFraction: o(50, "%") }), "heart-failure")).toBeUndefined();
    const withNp = obsRec({ lvEjectionFraction: o(35, "%") }, { labs: [{ analyte: "NT-proBNP", value: 2400, unit: "pg/mL" }] });
    expect(missingFields(withNp)).not.toContain("labs.natriureticPeptide");
    expect(alt(withNp, "heart-failure")?.evidence.map((e) => e.value)).toContain(2400);
  });

  it("reduced EF + regional wall-motion abnormality → ischaemic cause supported", () => {
    const a = obsRec({ lvEjectionFraction: o(35, "%") }, { echo: { regionalWallMotion: [{ segment: 7, motion: "akinetic" }] } });
    expect(alt(a, "ischaemic-cardiomyopathy")?.basis).toBe("supported");
    expect(missingFields(a)).toContain("coronaryFindings");
  });

  it("wall-motion abnormality in the territory of a ≥ 50 % stenosis → ischaemic heart disease supported", () => {
    const a = obsRec({ lvEjectionFraction: o(60, "%") }, {
      echo: { regionalWallMotion: [{ segment: 4, motion: "hypokinetic" }] }, coronaryFindings: [{ vessel: "RCA", stenosisPercent: 80 }],
    });
    expect(alt(a, "ischaemic-heart-disease")?.basis).toBe("supported");
    const other = obsRec({ lvEjectionFraction: o(60, "%") }, {
      echo: { regionalWallMotion: [{ segment: 4, motion: "hypokinetic" }] }, coronaryFindings: [{ vessel: "LAD", stenosisPercent: 80 }],
    });
    expect(alt(other, "ischaemic-heart-disease")).toBeUndefined();
  });

  it("reduced EF + dilatation without regional abnormality → DCM possible, ischaemic possible", () => {
    const a = obsRec({ lvEjectionFraction: o(30, "%"), lvEndDiastolicDiameter: o(66, "mm") });
    expect(alt(a, "dilated-cardiomyopathy")?.basis).toBe("possible");
    expect(alt(a, "ischaemic-cardiomyopathy")?.basis).toBe("possible");
  });

  it("LV dysfunction with severe valve disease → valvular cause supported", () => {
    const a = obsRec({ lvEjectionFraction: o(40, "%") }, { valveFindings: [{ valve: "aortic", condition: "stenosis", peakVelocity: o(4.5, "m/s") }] });
    expect(alt(a, "valvular-lv-dysfunction")?.basis).toBe("supported");
  });
});

describe("LV hypertrophy causes", () => {
  const thick = (sbp: number, ivs = 13) => obsRec({ ivsThickness: o(ivs, "mm"), lvPosteriorWallThickness: o(12, "mm"), systolicBP: o(sbp, "mmHg") }, { demographics: { biologicalSex: "male" } });
  it("SBP 140 → hypertensive heart disease supported; 139 → possible", () => {
    expect(alt(thick(140), "hypertensive-heart-disease")?.basis).toBe("supported");
    expect(alt(thick(139), "hypertensive-heart-disease")?.basis).toBe("possible");
  });
  it("wall ≥ 15 mm → HCM possible; 14 mm → not listed", () => {
    expect(alt(thick(130, 15), "hypertrophic-cardiomyopathy")?.basis).toBe("possible");
    expect(alt(thick(130, 14), "hypertrophic-cardiomyopathy")).toBeUndefined();
  });
  it("moderate or worse AS → afterload supported", () => {
    const a = obsRec({ ivsThickness: o(13, "mm") }, { demographics: { biologicalSex: "male" }, valveFindings: [{ valve: "aortic", condition: "stenosis", peakVelocity: o(3.4, "m/s") }] });
    expect(alt(a, "aortic-stenosis-afterload")?.basis).toBe("supported");
  });
});

describe("LA and RV causes", () => {
  it("LA enlargement with moderate MR or AF → supported; otherwise raised filling pressure possible", () => {
    const mr = obsRec({ laVolume: o(100, "mL") }, { ...bsa2(), valveFindings: [{ valve: "mitral", condition: "regurgitation", severity: "moderate" }] });
    expect(alt(mr, "la-enlargement-mitral-regurgitation")?.basis).toBe("supported");
    const af = obsRec({ laVolume: o(100, "mL") }, { ...bsa2(), ecg: { rhythm: "atrial fibrillation" } });
    expect(alt(af, "la-enlargement-atrial-fibrillation")?.basis).toBe("supported");
    const none = obsRec({ laVolume: o(100, "mL") }, bsa2());
    expect(alt(none, "raised-lv-filling-pressure")?.basis).toBe("possible");
    expect(missingFields(none)).toContain("echo.diastolicFunction");
  });

  it("RV dilatation: TR moderate supported, pulmonary hypertension possible with PASP asked for", () => {
    const a = obsRec({ rvBasalDiameter: o(46, "mm") }, { valveFindings: [{ valve: "tricuspid", condition: "regurgitation", severity: "moderate" }] });
    expect(alt(a, "rv-tricuspid-regurgitation")?.basis).toBe("supported");
    expect(alt(a, "pulmonary-hypertension")?.basis).toBe("possible");
    expect(missingFields(a)).toContain("observations.pasp");
  });
});

describe("symptomatic severe AS", () => {
  const sev = (symptoms: unknown[]) => run({ valveFindings: [{ valve: "aortic", condition: "stenosis", peakVelocity: o(4.4, "m/s") }], symptoms } as never);
  it("red flag with a structured cardinal symptom", () => {
    expect(sev(["exertional syncope"]).redFlags).toContain("Severe aortic stenosis with reported symptoms: urgent specialist (heart valve team) review.");
  });
  it("no red flag for a negated or absent symptom", () => {
    expect(sev(["no syncope"]).redFlags).toEqual([]);
    expect(sev([{ symptom: "chest pain", present: false }]).redFlags).toEqual([]);
  });
});

describe("mitral regurgitation mechanism", () => {
  it("prolapse with MR → primary MR supported", () => {
    const a = run({ valveFindings: [{ valve: "mitral", condition: "regurgitation", severity: "severe" }, { valve: "mitral", condition: "prolapse" }] });
    expect(alt(a, "primary-mitral-regurgitation")?.basis).toBe("supported");
    expect(alt(a, "secondary-mitral-regurgitation")).toBeUndefined();
  });

  it("MR without prolapse and reduced EF → secondary MR possible", () => {
    const a = obsRec({ lvEjectionFraction: o(35, "%") }, { valveFindings: [{ valve: "mitral", condition: "regurgitation", severity: "moderate" }] });
    expect(alt(a, "secondary-mitral-regurgitation")?.basis).toBe("possible");
  });
});

describe("QTc causes", () => {
  const ecg = (e: Record<string, unknown>, extra = {}) => run({ ecg: e, ...extra });
  const qtc = (ms: number, extra = {}) => ecg({ qtc: o(ms, "ms") }, extra);
  it("prolonged QTc lists drug, electrolyte and congenital causes; electrolytes asked for", () => {
    const a = qtc(480, { ...female, medications: ["drug A"] });
    expect(alt(a, "qt-prolonging-drugs")).toBeDefined();
    expect(alt(a, "electrolyte-disturbance")).toBeDefined();
    expect(alt(a, "congenital-long-qt")).toBeDefined();
    for (const lab of ["labs.potassium", "labs.magnesium", "labs.calcium"]) expect(missingFields(a)).toContain(lab);
    const b = qtc(480, { ...female, labs: [{ analyte: "Potassium", value: 3.1, unit: "mmol/L" }] });
    expect(missingFields(b)).not.toContain("labs.potassium");
    expect(alt(b, "qt-prolonging-drugs")).toBeUndefined();
  });
  it("wide QRS with prolonged QTc → QT lengthened by depolarisation", () => {
    expect(alt(ecg({ qtc: o(480, "ms"), qrsDuration: o(140, "ms") }, male), "qt-prolonged-by-wide-qrs")?.basis).toBe("supported");
  });
});
