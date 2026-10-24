import { describe, expect, it } from "vitest";
import { alt, find, missingFields, o, run } from "./helpers";

const as = (m: Record<string, unknown>, severity?: string) => run({ valveFindings: [{ valve: "aortic", condition: "stenosis", ...(severity ? { severity } : {}), ...m }] });
const asGrade = (m: Record<string, unknown>, severity?: string) => find(as(m, severity), "aortic-stenosis")?.grade;

describe("aortic stenosis — ACC/AHA 2020", () => {
  for (const [v, g] of [
    [1.99, "none"], [2.0, "mild"], [2.99, "mild"], [3.0, "moderate"], [3.99, "moderate"], [4.0, "severe"], [4.3, "severe"],
  ] as const) {
    it(`Vmax ${v} m/s → ${g}`, () => {
      expect(asGrade({ peakVelocity: o(v, "m/s") })).toBe(g);
    });
  }

  for (const [mg, g] of [[19, "mild"], [20, "moderate"], [39, "moderate"], [40, "severe"]] as const) {
    it(`mean gradient ${mg} mmHg (no Vmax) → ${g}`, () => {
      expect(asGrade({ meanGradient: o(mg, "mmHg") })).toBe(g);
    });
  }

  it("grades by the worse of Vmax and mean gradient", () => {
    expect(asGrade({ peakVelocity: o(3.5, "m/s"), meanGradient: o(42, "mmHg") })).toBe("severe");
    expect(asGrade({ peakVelocity: o(4.1, "m/s"), meanGradient: o(15, "mmHg") })).toBe("severe");
  });

  it("is rule-defined with every measurement as evidence", () => {
    const f = find(as({ peakVelocity: o(4.3, "m/s"), meanGradient: o(48, "mmHg"), valveArea: o(0.8, "cm2") }, "severe"), "aortic-stenosis")!;
    expect(f).toMatchObject({ basis: "rule-defined", grade: "severe", organ: "heart", target: "aortic_valve" });
    expect(f.evidence.map((e) => [e.field, e.value, e.rule])).toEqual([
      ["valveFindings[aortic_valve stenosis].peakVelocity", 4.3, "R-DX-AS-01"],
      ["valveFindings[aortic_valve stenosis].meanGradient", 48, "R-DX-AS-01"],
      ["valveFindings[aortic_valve stenosis].valveArea", 0.8, "R-DX-AS-02"],
      ["valveFindings[aortic_valve stenosis].severity", "severe", "R-DX-AS-04"],
    ]);
  });

  it("raises a red flag only for very severe AS (Vmax ≥ 5.0 or mean gradient ≥ 60)", () => {
    expect(as({ peakVelocity: o(4.99, "m/s") }).redFlags).toEqual([]);
    expect(as({ peakVelocity: o(5.0, "m/s") }).redFlags).toHaveLength(1);
    expect(as({ peakVelocity: o(4.5, "m/s"), meanGradient: o(59, "mmHg") }).redFlags).toEqual([]);
    expect(as({ peakVelocity: o(4.5, "m/s"), meanGradient: o(60, "mmHg") }).redFlags[0]).toContain("60");
  });

  it("converts cm/s and kPa", () => {
    expect(asGrade({ peakVelocity: o(430, "cm/s") })).toBe("severe");
    expect(asGrade({ peakVelocity: o(399, "cm/s") })).toBe("moderate");
    expect(asGrade({ meanGradient: o(5.4, "kPa") })).toBe("severe"); // 40.5 mmHg
  });

  it("never uses a value without a unit, and says so", () => {
    const a = as({ peakVelocity: 4.3 }, "severe");
    expect(find(a, "aortic-stenosis")).toMatchObject({ basis: "supported", grade: "severe" });
    expect(missingFields(a)).toContain("valveFindings[aortic_valve stenosis].peakVelocity");
  });

  it("reports a reported severity without numbers as supported and asks for Vmax, gradient and area", () => {
    const a = as({}, "moderate");
    expect(find(a, "aortic-stenosis")).toMatchObject({ basis: "supported", grade: "moderate" });
    for (const m of ["peakVelocity", "meanGradient", "valveArea"]) expect(missingFields(a)).toContain(`valveFindings[aortic_valve stenosis].${m}`);
  });

  it("flags a reported severity that differs from the measured grade", () => {
    const a = as({ peakVelocity: o(3.2, "m/s") }, "severe");
    expect(find(a, "aortic-stenosis")?.grade).toBe("moderate");
    expect(alt(a, "aortic-stenosis-grade-mismatch")?.basis).toBe("supported");
    expect(alt(as({ peakVelocity: o(4.2, "m/s") }, "severe"), "aortic-stenosis-grade-mismatch")).toBeUndefined();
  });
});


describe("aortic stenosis — valve area and discordance", () => {
  const base = { peakVelocity: o(3.5, "m/s"), meanGradient: o(30, "mmHg") };

  it("AVA 1.00 cm² with non-severe gradients → discordant; 1.01 → graded by gradient", () => {
    expect(asGrade({ ...base, valveArea: o(1.0, "cm2") })).toBe("discordant");
    expect(asGrade({ ...base, valveArea: o(1.01, "cm2") })).toBe("moderate");
  });

  it("low-gradient: reduced EF → classical low-flow (D2); preserved EF → paradoxical (D3)", () => {
    const rec = (ef: number) => run({ observations: { lvEjectionFraction: o(ef, "%") }, valveFindings: [{ valve: "aortic", condition: "stenosis", ...base, valveArea: o(0.9, "cm2") }] });
    const reduced = rec(35), preserved = rec(60);
    expect(alt(reduced, "aortic-stenosis-classical-low-flow")).toBeDefined();
    expect(alt(reduced, "aortic-stenosis-paradoxical-low-flow")).toBeUndefined();
    expect(missingFields(reduced)).toContain("additionalInvestigations.dobutamineStressEcho");
    expect(alt(preserved, "aortic-stenosis-paradoxical-low-flow")?.basis).toBe("possible");
    expect(alt(preserved, "aortic-stenosis-classical-low-flow")).toBeUndefined();
    expect(alt(preserved, "aortic-stenosis-moderate-measurement-error")).toBeDefined();
    expect(missingFields(preserved)).toContain("observations.strokeVolume");
  });

  it("unknown EF → both low-flow alternatives and LVEF missing", () => {
    const a = as({ ...base, valveArea: o(0.9, "cm2") });
    expect(alt(a, "aortic-stenosis-classical-low-flow")).toBeDefined();
    expect(alt(a, "aortic-stenosis-paradoxical-low-flow")).toBeDefined();
    expect(missingFields(a)).toContain("observations.lvEjectionFraction");
  });

  it("paradoxical low-flow is supported when SVi < 35 and AVAi ≤ 0.6 (BSA 2.00)", () => {
    const a = run({
      demographics: { heightCm: o(180, "cm"), weightKg: o(80, "kg") },
      observations: { lvEjectionFraction: o(62, "%"), strokeVolume: o(60, "mL") },
      valveFindings: [{ valve: "aortic", condition: "stenosis", ...base, valveArea: o(0.9, "cm2") }],
    });
    const d3 = alt(a, "aortic-stenosis-paradoxical-low-flow")!;
    expect(d3.basis).toBe("supported");
    expect(d3.evidence.find((e) => e.field === "derived.strokeVolumeIndex")?.value).toBe(30);
    expect(d3.evidence.find((e) => e.field === "derived.aorticValveAreaIndex")?.value).toBe(0.45);
  });

  it("severe gradient with AVA > 1.0 → severe, high-flow alternative", () => {
    const a = as({ peakVelocity: o(4.2, "m/s"), valveArea: o(1.2, "cm2") });
    expect(find(a, "aortic-stenosis")?.grade).toBe("severe");
    expect(alt(a, "aortic-stenosis-high-flow")?.basis).toBe("possible");
  });

  it("reads Vmax from doppler[] when the valve finding has none", () => {
    const a = run({ doppler: [{ measurement: "Peak velocity", value: 4.1, unit: "m/s", valve: "aortic" }] });
    expect(find(a, "aortic-stenosis")?.grade).toBe("severe");
  });
});

const dop = (valve: string, measurement: string, value: number, unit: string) => ({ measurement, value, unit, valve });
const regGrade = (valve: "mitral" | "aortic", items: ReturnType<typeof dop>[]) => find(run({ doppler: items }), `${valve}-regurgitation`)?.grade;

describe("mitral regurgitation — quantitative (ACC/AHA 2020)", () => {
  for (const [m, v, u, g] of [
    ["vena contracta", 0.69, "cm", "not severe"], ["vena contracta", 0.7, "cm", "severe"], ["vena contracta", 7, "mm", "severe"],
    ["EROA", 0.39, "cm2", "not severe"], ["EROA", 0.4, "cm²", "severe"],
    ["regurgitant volume", 59, "mL", "not severe"], ["regurgitant volume", 60, "mL", "severe"],
    ["regurgitant fraction", 49, "%", "not severe"], ["regurgitant fraction", 50, "%", "severe"],
  ] as const) {
    it(`${m} ${v} ${u} → ${g}`, () => {
      expect(regGrade("mitral", [dop("mitral", m, v, u)])).toBe(g);
    });
  }

  it("parameters in different classes → discordant, never picked", () => {
    const a = run({ doppler: [dop("mitral", "vena contracta", 0.75, "cm"), dop("mitral", "EROA", 0.3, "cm2")] });
    expect(find(a, "mitral-regurgitation")).toMatchObject({ grade: "discordant", basis: "rule-defined" });
  });
});

describe("aortic regurgitation — quantitative (ACC/AHA 2020)", () => {
  for (const [m, v, g] of [
    ["vena contracta", 0.29, "mild"], ["vena contracta", 0.3, "moderate"], ["vena contracta", 0.6, "moderate"], ["vena contracta", 0.61, "severe"],
    ["regurgitant volume", 29, "mild"], ["regurgitant volume", 30, "moderate"], ["regurgitant volume", 59, "moderate"], ["regurgitant volume", 60, "severe"],
    ["regurgitant fraction", 29, "mild"], ["regurgitant fraction", 30, "moderate"], ["regurgitant fraction", 49, "moderate"], ["regurgitant fraction", 50, "severe"],
    ["EROA", 0.09, "mild"], ["EROA", 0.1, "moderate"], ["EROA", 0.29, "moderate"], ["EROA", 0.3, "severe"],
  ] as const) {
    it(`${m} ${v} → ${g}`, () => {
      const unit = m === "vena contracta" ? "cm" : m === "regurgitant volume" ? "mL" : m === "regurgitant fraction" ? "%" : "cm2";
      expect(regGrade("aortic", [dop("aortic", m, v, unit)])).toBe(g);
    });
  }
});

describe("reported regurgitation and prolapse", () => {
  it("reported severity is supported; none is not a finding", () => {
    const a = run({ valveFindings: [{ valve: "tricuspid", condition: "regurgitation", severity: "moderate" }, { valve: "pulmonary", condition: "regurgitation", severity: "none" }] });
    expect(find(a, "tricuspid-regurgitation")).toMatchObject({ basis: "supported", grade: "moderate" });
    expect(find(a, "pulmonary-regurgitation")).toBeUndefined();
  });

  it("reported prolapse is supported", () => {
    const a = run({ valveFindings: [{ valve: "mitral", condition: "prolapse" }] });
    expect(find(a, "mitral-valve-prolapse")).toMatchObject({ basis: "supported", target: "mitral_valve" });
  });

  it("quantitative grade wins and a disagreeing reported grade is flagged", () => {
    const a = run({ valveFindings: [{ valve: "mitral", condition: "regurgitation", severity: "severe" }], doppler: [dop("mitral", "EROA", 0.2, "cm2")] });
    expect(find(a, "mitral-regurgitation")?.grade).toBe("not severe");
    expect(alt(a, "mitral-regurgitation-grade-mismatch")).toBeDefined();
  });
});
