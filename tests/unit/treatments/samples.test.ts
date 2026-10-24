import { describe, expect, it } from "vitest";
import { readText } from "../helpers";

const ids = (file: string) => (JSON.parse(readText(file)).patients as { patientId: string }[]).map((p) => p.patientId);

describe("shipped sample patients", () => {
  it("shipped sample file contains only SYN-008", () => {
    expect(ids("public/samples/synthetic-patients.json")).toEqual(["SYN-008"]);
  });

  it("the full set of eight stays available to the tests as a fixture", () => {
    expect(ids("tests/fixtures/synthetic-patients.full.json")).toEqual(["SYN-001", "SYN-002", "SYN-003", "SYN-004", "SYN-005", "SYN-006", "SYN-007", "SYN-008"]);
  });

  it("the CSV twin of the shipped file lists the same patients", () => {
    const csv = readText("public/samples/synthetic-patients.csv");
    expect(csv).toContain("SYN-008");
    expect(csv).not.toContain("SYN-001");
  });
});
