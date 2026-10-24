import { describe, expect, it } from "vitest";
import { laviGrade } from "@/domain/diagnosis/chambers";
import { bsa2, find, missingFields, o, obsRec } from "./helpers";

describe("LA volume index — ASE/EACVI 2015", () => {
  it("partitions: < 35 normal, 35–41 mild, 42–48 moderate, > 48 severe", () => {
    expect([34.9, 35, 41.9, 42, 48, 48.1].map(laviGrade)).toEqual(["normal", "mild", "mild", "moderate", "moderate", "severe"]);
  });
  it("indexes LA volume to BSA (2.00 m²)", () => {
    expect(find(obsRec({ laVolume: o(68, "mL") }, bsa2()), "la-enlargement")).toBeUndefined();
    const f = find(obsRec({ laVolume: o(90, "mL") }, bsa2()), "la-enlargement")!;
    expect(f).toMatchObject({ grade: "moderate", basis: "rule-defined", target: "la" });
    expect(f.evidence.find((e) => e.field === "derived.laVolumeIndex")?.value).toBe(45);
  });
  it("does not grade an absolute LA volume without BSA, and asks for height and weight", () => {
    const a = obsRec({ laVolume: o(120, "mL") });
    expect(find(a, "la-enlargement")).toBeUndefined();
    expect(missingFields(a)).toContain("demographics.heightCm");
    expect(missingFields(a)).toContain("demographics.weightKg");
  });
});

describe("RV and RA", () => {
  it("RV basal diameter > 41 mm", () => {
    expect(find(obsRec({ rvBasalDiameter: o(41, "mm") }), "rv-dilatation")).toBeUndefined();
    expect(find(obsRec({ rvBasalDiameter: o(42, "mm") }), "rv-dilatation")?.basis).toBe("rule-defined");
  });
  it("TAPSE < 17 mm or RVEF < 45 %", () => {
    expect(find(obsRec({ tapse: o(17, "mm") }), "rv-systolic-dysfunction")).toBeUndefined();
    expect(find(obsRec({ tapse: o(16, "mm") }), "rv-systolic-dysfunction")).toBeDefined();
    expect(find(obsRec({ rvEjectionFraction: o(45, "%") }), "rv-systolic-dysfunction")).toBeUndefined();
    expect(find(obsRec({ rvEjectionFraction: o(44, "%") }), "rv-systolic-dysfunction")).toBeDefined();
    expect(find(obsRec({ tapse: o(20, "mm"), rvEjectionFraction: o(40, "%") }), "rv-systolic-dysfunction")?.label).toContain("disagree");
  });
  it("RA minor axis > 44 mm", () => {
    expect(find(obsRec({ raMinorDimension: o(44, "mm") }), "ra-enlargement")).toBeUndefined();
    expect(find(obsRec({ raMinorDimension: o(4.5, "cm") }), "ra-enlargement")).toMatchObject({ grade: "enlarged", basis: "supported" });
  });
});
