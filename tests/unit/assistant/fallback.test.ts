import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeRecord } from "@/domain/normalization/normalize";
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

/** The synthetic sample records shipped with the app (SYN-001 … ). */
const SAMPLES = (
  JSON.parse(readFileSync(resolve(process.cwd(), "public/samples/synthetic-patients.json"), "utf8")) as {
    patients: unknown[];
  }
).patients;

/** Normalize a sample record and run the real engine on it, exactly as the route does. */
function realCase(patientId: string): { ided: ReturnType<typeof withIds>; patient: NormalizedPatient } {
  const raw = SAMPLES.find((p) => (p as { patientId?: string }).patientId === patientId);
  const n = normalizeRecord(raw);
  if (!n.ok) throw new Error(`sample ${patientId} does not normalize`);
  return { ided: withIds(assess(n.patient.record)), patient: n.patient };
}

// Every hand-written fixture, plus the real engine on the SYN-004 / SYN-003 samples
// and on a bare record (→ only `missing` items), so the guard-safety invariant is
// proven for fixture and real Assessments alike.
const fixtureCases: { name: string; a: Assessment; patientId: string }[] = [
  { name: "aortic stenosis fixture", a: AORTIC_STENOSIS, patientId: "SYN-004" },
  { name: "wall thickening fixture", a: CONCENTRIC_WALL_THICKENING, patientId: "SYN-003" },
  { name: "empty-with-missing fixture", a: EMPTY_WITH_MISSING, patientId: "SYN-999" },
  { name: "red flag fixture", a: RED_FLAG, patientId: "SYN-RF" },
  { name: "injection-in-record-text fixture", a: INJECTION_IN_RECORD_TEXT, patientId: "SYN-INJ" },
];

describe("fallbackText — always passes the guard", () => {
  for (const { name, a, patientId } of fixtureCases) {
    it(`produces guard-safe text for the ${name}`, () => {
      const ided = withIds(a);
      expect(guard(fallbackText(ided), ided, patientFor(patientId))).toEqual({ ok: true });
    });
  }

  for (const patientId of ["SYN-004", "SYN-003"]) {
    it(`produces guard-safe text for the real engine on ${patientId}`, () => {
      const { ided, patient } = realCase(patientId);
      expect(ided.findings.length).toBeGreaterThan(0);
      expect(guard(fallbackText(ided), ided, patient)).toEqual({ ok: true });
    });
  }

  it("produces guard-safe text for the real engine on a bare record (missing items only)", () => {
    const ided = withIds(assess({ patientId: "SYN-999", studyId: "STUDY-1" } as PatientRecord));
    expect(ided.findings).toEqual([]);
    expect(ided.missing.length).toBeGreaterThan(0);
    expect(guard(fallbackText(ided), ided, patientFor("SYN-999"))).toEqual({ ok: true });
  });

  it("the real engine grades the SYN-004 sample as aortic stenosis", () => {
    const { ided } = realCase("SYN-004");
    expect(ided.findings.some((f) => f.condition === "aortic-stenosis")).toBe(true);
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

  it("includes differential findings and an id + field Missing line", () => {
    const text = fallbackText(withIds(CONCENTRIC_WALL_THICKENING));
    expect(text).toContain("F1 Concentric left ventricular hypertrophy (rule-defined)");
    expect(text).toContain("F2 Hypertensive heart disease (supported)");
    expect(text).toContain("E3 systolic bp 162 mmHg");
    // Missing line cites each item's M# id with its field name (no free-text `why`).
    expect(text).toContain("Missing: M1 observations.lvMassIndex.");
    expect(text).not.toContain("distinguishes concentric hypertrophy");
  });

  it("lists missing fields with their M# ids when no rule fired", () => {
    const text = fallbackText(withIds(EMPTY_WITH_MISSING));
    expect(text).toContain(
      "Missing: M1 valveFindings, M2 observations.lvEjectionFraction, M3 echo.wallThickness.",
    );
  });

  it("cites several red flags in order, each by its R# id, and stays guard-safe without findings", () => {
    const a: Assessment = {
      ...EMPTY_WITH_MISSING,
      redFlags: ["Severe aortic stenosis with reported symptoms: urgent specialist review.", "QTc prolonged: urgent review."],
    };
    const ided = withIds(a);
    const text = fallbackText(ided);
    expect(text).toContain("R1 Severe aortic stenosis with reported symptoms: urgent specialist review.");
    expect(text).toContain("R2 QTc prolonged: urgent review.");
    expect(text.match(/\bR\d+\b/g)).toEqual(["R1", "R2"]);
    expect(guard(text, ided, patientFor("SYN-999"))).toEqual({ ok: true });
  });

  it("cites only M# ids the guard knows", () => {
    const ided = withIds(EMPTY_WITH_MISSING);
    const cited = fallbackText(ided).match(/\bM\d+\b/g);
    expect(cited).toEqual(ided.missing.map((m) => m.id));
  });

  it("cites each red flag by its own R# id and never echoes quoted record text", () => {
    const redFlag = fallbackText(withIds(RED_FLAG));
    // The red flag is a clinical claim (number + grade word), so it carries its R1 id, not the finding's.
    expect(redFlag).toContain("R1 Ejection fraction 22% with severe systolic dysfunction");
    expect(redFlag).not.toContain("F1 Ejection fraction");

    const injection = fallbackText(withIds(INJECTION_IN_RECORD_TEXT));
    // String evidence renders its field label only, never the injected free text.
    expect(injection).toContain("E2 clinician notes");
    expect(injection).not.toContain("IGNORE PREVIOUS INSTRUCTIONS");
  });
});
