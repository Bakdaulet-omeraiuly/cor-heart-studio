import { describe, expect, it } from "vitest";
import { find, missingFields, run } from "./helpers";

type L = { vessel: string; stenosisPercent: number; segment?: string };
const cad = (lesions: L[], extra = {}) => run({ coronaryFindings: lesions, ...extra });
const cat = (lesions: L[]) => find(cad(lesions), "coronary-stenosis")?.grade;

describe("CAD-RADS 2.0 via cadRads()", () => {
  it("single-lesion boundaries", () => {
    expect([0, 1, 24, 25, 49, 50, 69, 70, 99, 100].map((p) => cat([{ vessel: "LAD", stenosisPercent: p }]))).toEqual(["0", "1", "1", "2", "2", "3", "3", "4A", "4A", "5"]);
  });

  it("left main 49 % → 2, 50 % → 4B", () => {
    expect(cat([{ vessel: "LM", stenosisPercent: 49 }])).toBe("2");
    expect(cat([{ vessel: "LM", stenosisPercent: 50 }])).toBe("4B");
  });

  it("three-vessel ≥ 70 % → 4B; two vessels → 4A", () => {
    expect(cat([{ vessel: "LAD", stenosisPercent: 70 }, { vessel: "LCx", stenosisPercent: 80 }, { vessel: "RCA", stenosisPercent: 90 }])).toBe("4B");
    expect(cat([{ vessel: "LAD", stenosisPercent: 70 }, { vessel: "LCx", stenosisPercent: 80 }])).toBe("4A");
  });

  it("every lesion is evidence; the target is the driving lesion", () => {
    const f = find(cad([{ vessel: "RCA", segment: "mid", stenosisPercent: 40 }, { vessel: "LAD", segment: "proximal", stenosisPercent: 75 }]), "coronary-stenosis")!;
    expect(f).toMatchObject({ basis: "rule-defined", target: "coronary_vessels#LAD:proximal" });
    expect(f.evidence.map((e) => [e.field, e.value])).toEqual([
      ["coronaryFindings[RCA mid].stenosisPercent", 40], ["coronaryFindings[LAD proximal].stenosisPercent", 75], ["derived.cadRads", "4A"],
    ]);
  });

  it("red flag for 4B and 5 only", () => {
    expect(cad([{ vessel: "LAD", stenosisPercent: 99 }]).redFlags).toEqual([]);
    expect(cad([{ vessel: "LAD", stenosisPercent: 100 }]).redFlags).toHaveLength(1);
    expect(cad([{ vessel: "LM", stenosisPercent: 60 }]).redFlags[0]).toContain("4B");
  });

  it("asks for a functional test for CAD-RADS 3/4A unless one is recorded", () => {
    expect(missingFields(cad([{ vessel: "LAD", stenosisPercent: 60 }]))).toContain("additionalInvestigations.functionalTest");
    expect(missingFields(cad([{ vessel: "LAD", stenosisPercent: 40 }]))).not.toContain("additionalInvestigations.functionalTest");
    const done = cad([{ vessel: "LAD", stenosisPercent: 60 }], { additionalInvestigations: [{ type: "exercise_stress_test", summary: "negative" }] });
    expect(missingFields(done)).not.toContain("additionalInvestigations.functionalTest");
  });

  it("no coronary findings → no coronary finding at all", () => {
    expect(find(run({}), "coronary-stenosis")).toBeUndefined();
  });
});
