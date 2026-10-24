import { describe, expect, it } from "vitest";
import { fallbackText } from "@/app/api/assistant/fallback";
import { guard } from "@/app/api/assistant/guard";
import { withIds } from "@/app/api/assistant/ids";
import { assess } from "@/app/api/assistant/engine";
import type { Assessment } from "@/app/api/assistant/engine";
import {
  AORTIC_STENOSIS,
  CONCENTRIC_WALL_THICKENING,
  EMPTY_WITH_MISSING,
  INJECTION_IN_RECORD_TEXT,
  RED_FLAG,
} from "@/app/api/assistant/__fixtures__/assess";
import type { NormalizedPatient } from "@/domain/types";
import type { PatientRecord } from "@/domain/schema/record";

/**
 * Build a minimal valid `NormalizedPatient` for a given patient id. The clinical
 * collections are empty on purpose: the fallback prints only the Assessment's own
 * evidence values, and `allowedNumbers()` always includes those, so the guard does
 * not need any extra allowed numbers from the record. This keeps the fixture small
 * while still exercising the real guard end to end.
 */
function patientFor(patientId: string): NormalizedPatient {
  const record = { patientId, studyId: "STUDY-1" } as PatientRecord;
  return {
    key: `${patientId}::STUDY-1`,
    patientId,
    studyId: "STUDY-1",
    synthetic: true,
    original: record,
    record,
    observations: {},
    derived: [],
    valveFindings: [],
    coronaryFindings: [],
    wallMotion: [],
    wallThickness: [],
    issues: [],
    unrecognizedFields: [],
  };
}

/** Build `assess(record)` by patientId, exactly as the route will. */
function assessFor(patientId: string): Assessment {
  return assess({ patientId, studyId: "STUDY-1" } as PatientRecord);
}

// The required cases: SYN-004 (aortic stenosis), SYN-003 (wall thickening), an
// unknown id (→ the empty-with-missing Assessment). Plus the red-flag and
// injection fixtures so the guard-safety invariant is proven for EVERY fixture.
const cases: { name: string; ided: ReturnType<typeof withIds>; patientId: string }[] = [
  { name: "SYN-004 (aortic stenosis)", ided: withIds(assessFor("SYN-004")), patientId: "SYN-004" },
  { name: "SYN-003 (wall thickening)", ided: withIds(assessFor("SYN-003")), patientId: "SYN-003" },
  { name: "unknown id → empty with missing", ided: withIds(assessFor("SYN-999")), patientId: "SYN-999" },
  { name: "red flag", ided: withIds(RED_FLAG), patientId: "SYN-RF" },
  { name: "injection in record text", ided: withIds(INJECTION_IN_RECORD_TEXT), patientId: "SYN-INJ" },
];

describe("fallbackText — always passes the guard", () => {
  for (const { name, ided, patientId } of cases) {
    it(`produces guard-safe text for ${name}`, () => {
      const text = fallbackText(ided);
      const result = guard(text, ided, patientFor(patientId));
      expect(result).toEqual({ ok: true });
    });
  }

  it("matches the selected-fixture Assessments to the required sources", () => {
    // Sanity: the route's `assess(record)` picks fixtures by patientId as designed.
    expect(assessFor("SYN-004")).toBe(AORTIC_STENOSIS);
    expect(assessFor("SYN-003")).toBe(CONCENTRIC_WALL_THICKENING);
    expect(assessFor("SYN-999")).toBe(EMPTY_WITH_MISSING);
  });
});

describe("fallbackText — content", () => {
  it("renders each finding line with its id, basis and cited evidence numbers", () => {
    const text = fallbackText(withIds(AORTIC_STENOSIS));
    // F1 line leads with the finding id and label, then each evidence id + value.
    expect(text).toContain("F1 Aortic stenosis, severe (rule-defined)");
    expect(text).toContain("E1 peak velocity 4.3 m/s");
    expect(text).toContain("E2 mean gradient 48 mmHg");
    expect(text).toContain("E3 valve area 0.8 cm2");
  });

  it("includes differential findings and a field-only Missing line", () => {
    const text = fallbackText(withIds(CONCENTRIC_WALL_THICKENING));
    expect(text).toContain("F1 Concentric left ventricular hypertrophy (rule-defined)");
    expect(text).toContain("F2 Hypertensive heart disease (supported)");
    expect(text).toContain("E3 systolic bp 162 mmHg");
    // Missing line is built from field names only (no free-text `why`).
    expect(text).toContain("Missing: observations.lvMassIndex.");
    expect(text).not.toContain("distinguishes concentric hypertrophy");
  });

  it("lists missing fields when no rule fired", () => {
    const text = fallbackText(withIds(EMPTY_WITH_MISSING));
    expect(text).toContain(
      "Missing: valveFindings, observations.lvEjectionFraction, echo.wallThickness.",
    );
  });

  it("cites a finding id on a clinical red-flag line and never echoes quoted record text", () => {
    const redFlag = fallbackText(withIds(RED_FLAG));
    // The red flag is a clinical claim (number + grade word), so it carries F1.
    expect(redFlag).toContain("F1 Ejection fraction 22% with severe systolic dysfunction");

    const injection = fallbackText(withIds(INJECTION_IN_RECORD_TEXT));
    // String evidence renders its field label only, never the injected free text.
    expect(injection).toContain("E2 clinician notes");
    expect(injection).not.toContain("IGNORE PREVIOUS INSTRUCTIONS");
  });
});
