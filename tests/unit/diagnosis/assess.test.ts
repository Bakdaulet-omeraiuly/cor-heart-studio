import { describe, expect, it } from "vitest";
import { assess } from "@/domain/diagnosis";
import { PatientRecordSchema } from "@/domain/schema/record";

describe("assess() contract", () => {
  const record = PatientRecordSchema.parse({ patientId: "T-1", studyId: "S-1" });

  it("returns the agreed Assessment shape with a disclaimer", () => {
    const a = assess(record);
    expect(Object.keys(a).sort()).toEqual(["differential", "disclaimer", "findings", "missing", "redFlags"]);
    expect(a.disclaimer).toMatch(/not a diagnosis/i);
  });

  it("is deterministic", () => {
    expect(assess(record)).toEqual(assess(record));
  });
});
