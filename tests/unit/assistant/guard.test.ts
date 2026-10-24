import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  extractNumbers,
  guard,
  matchNumber,
  type NumberToken,
} from "@/app/api/assistant/guard";
import { withIds } from "@/app/api/assistant/ids";
import { AORTIC_STENOSIS } from "@/app/api/assistant/__fixtures__/assess";
import type { Assessment } from "@/app/api/assistant/engine";
import type {
  NormalizedObservation,
  NormalizedPatient,
} from "@/domain/types";
import type { PatientRecord } from "@/domain/schema/record";

// ---------------------------------------------------------------------------
// Fixtures: a focused Assessment + a matching minimal NormalizedPatient.
// ---------------------------------------------------------------------------

// A small inline Assessment whose evidence exposes the numbers the guard must
// allow: a velocity (1.3 m/s), a gradient (55 mmHg), a valve area (0.8 cm²), an
// LV mass index (90 g/m²) and a stroke-volume index (40 mL/m²). `withIds` stamps
// F1/E1.. so the citation tests have real known ids to cite.
const ASSESSMENT: Assessment = {
  findings: [
    {
      condition: "aortic-stenosis",
      label: "Aortic stenosis, severe",
      grade: "severe",
      basis: "rule-defined",
      organ: "heart",
      target: "aortic_valve",
      evidence: [
        {
          field: "valveFindings[valve=aortic_valve].peakVelocity",
          value: 1.3,
          unit: "m/s",
          rule: "R-VALVE-STEN-01",
          source: "guideline",
        },
        {
          field: "valveFindings[valve=aortic_valve].meanGradient",
          value: 55,
          unit: "mmHg",
          rule: "R-VALVE-STEN-01",
          source: "guideline",
        },
        {
          field: "valveFindings[valve=aortic_valve].valveArea",
          value: 0.8,
          unit: "cm2",
          rule: "R-VALVE-STEN-01",
          source: "guideline",
        },
      ],
    },
  ],
  differential: [],
  // One missing item → M1, so the `[M#]` citation cases have a known id.
  missing: [
    {
      field: "observations.aorticValveAreaIndexed",
      why: "Indexed valve area confirms severe grading in small-body patients.",
    },
  ],
  redFlags: [],
  disclaimer: "Not a diagnosis.",
};

const IDED = withIds(ASSESSMENT);

/** Build a minimal `NormalizedObservation` carrying just a value + unit. */
function obs(
  path: string,
  value: number | null,
  unit: string,
): NormalizedObservation {
  return {
    path,
    label: path,
    short: path,
    category: "hemodynamics",
    rendering: "display_only",
    original: { value, unit },
    value,
    unit,
    status: "ok",
    evidence: "reported_measurement",
  };
}

/**
 * A `NormalizedPatient` whose collections expose the values the tests assert as
 * allowed. These are deliberately varied across sources so the number check
 * draws from observations, derived values, valve measurements, coronary
 * percentages and AHA segment numbers — the full set `allowedNumbers()` reads.
 */
function patient(): NormalizedPatient {
  const record = { patientId: "SYN-TEST", studyId: "STUDY-1" } as PatientRecord;
  return {
    key: "SYN-TEST::STUDY-1",
    patientId: "SYN-TEST",
    studyId: "STUDY-1",
    synthetic: true,
    original: record,
    record,
    observations: {
      // 90 g/m² for the g/m2 ≡ g/m² alias case.
      lvMassIndex: obs("observations.lvMassIndex", 90, "g/m\u00B2"),
      // Range ends 40 and 50 so "40–50"/"40 to 50" both-ends check passes.
      edvLow: obs("observations.edvLow", 40, "mL"),
      edvHigh: obs("observations.edvHigh", 50, "mL"),
    },
    derived: [
      // 40 mL/m² for the mL/m2 ≡ mL/m² alias case (also an unlabelled 40).
      {
        id: "svi",
        label: "Stroke volume index",
        value: 40,
        unit: "mL/m\u00B2",
        formula: "sv / bsa",
        inputs: [],
        evidence: "derived",
      },
    ],
    valveFindings: [
      {
        valve: "aortic_valve" as NormalizedPatient["valveFindings"][number]["valve"],
        condition: "aortic-stenosis",
        severity: null,
        measurements: [
          { label: "valve area", value: 0.8, unit: "cm\u00B2", status: "ok" },
        ],
        evidence: "reported_assessment",
      },
    ],
    // 55% stenosis so "55%" matches as a percentage.
    coronaryFindings: [
      {
        vessel: "LAD",
        stenosisPercent: 55,
      } as NormalizedPatient["coronaryFindings"][number],
    ],
    // AHA segment 7 present so a bare "7" is an allowed segment number.
    wallMotion: [
      {
        segment: 7,
        motion: "normal" as NormalizedPatient["wallMotion"][number]["motion"],
        evidence: "reported_assessment",
      },
    ],
    wallThickness: [],
    issues: [],
    unrecognizedFields: [],
  };
}

const PATIENT = patient();

// ---------------------------------------------------------------------------
// extractNumbers — parsed tokens (value, unit, rangeWith)
// ---------------------------------------------------------------------------

describe("extractNumbers — parsing", () => {
  const cases: {
    name: string;
    text: string;
    expected: Partial<NumberToken>[];
  }[] = [
    {
      name: "plain decimal with a unit",
      text: "peak velocity 1.3 m/s",
      expected: [{ value: 1.3, unit: "m/s" }],
    },
    {
      name: "integer with a unit",
      text: "gradient 55 mmHg",
      expected: [{ value: 55, unit: "mmHg" }],
    },
    {
      name: "percentage attaches % as the unit",
      text: "stenosis 55%",
      expected: [{ value: 55, unit: "%" }],
    },
    {
      name: "European decimal comma parses as a dot",
      text: "area 1,3",
      expected: [{ value: 1.3 }],
    },
    {
      name: "thousands separator does not corrupt the value",
      text: "count 1,200",
      expected: [{ value: 1200 }],
    },
    {
      name: "en-dash range captures both ends",
      text: "ef 40\u201350",
      expected: [{ value: 40, rangeWith: 50 }],
    },
    {
      name: "hyphen range captures both ends",
      text: "ef 40-50",
      expected: [{ value: 40, rangeWith: 50 }],
    },
    {
      name: "word range captures both ends",
      text: "ef 40 to 50",
      expected: [{ value: 40, rangeWith: 50 }],
    },
    {
      name: "cm2 unit captured verbatim",
      text: "valve area 0.8 cm2",
      expected: [{ value: 0.8, unit: "cm2" }],
    },
  ];

  it.each(cases)("$name", ({ text, expected }) => {
    const tokens = extractNumbers(text);
    expect(tokens).toHaveLength(expected.length);
    expected.forEach((want, i) => {
      expect(tokens[i].value).toBe(want.value);
      expect(tokens[i].unit).toBe(want.unit);
      expect(tokens[i].rangeWith).toBe(want.rangeWith);
    });
  });

  it("ignores digits inside id tokens ([F12], bare E3)", () => {
    expect(extractNumbers("As cited [F12] and E3, nothing numeric here.")).toEqual(
      [],
    );
  });

  it("ignores digits inside missing-item ids ([M2], bare M1)", () => {
    expect(extractNumbers("Not recorded [M2]; see also M1.")).toEqual([]);
  });

  it("keeps a real number alongside stripped ids", () => {
    const tokens = extractNumbers("[F1] peak velocity 1.3 m/s [E2]");
    expect(tokens).toHaveLength(1);
    expect(tokens[0].value).toBe(1.3);
    expect(tokens[0].unit).toBe("m/s");
  });

  it("ignores leading list markers (1. / 2) / - )", () => {
    const text = ["1. first point", "2) second point", "- third point"].join(
      "\n",
    );
    expect(extractNumbers(text)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// matchNumber — precision rule + unit aliases against a small allowed array
// ---------------------------------------------------------------------------

describe("matchNumber — precision and units", () => {
  const num = (
    value: number,
    unit?: string,
    rangeWith?: number,
    raw?: string,
  ): NumberToken => ({
    raw: raw ?? (rangeWith !== undefined ? `${value}-${rangeWith}` : `${value}`),
    value,
    ...(unit !== undefined ? { unit } : {}),
    ...(rangeWith !== undefined ? { rangeWith } : {}),
  });

  const cases: {
    name: string;
    token: NumberToken;
    allowed: { value: number; unit?: string }[];
    want: boolean;
  }[] = [
    {
      name: "1.3 matches a stored 1.30 (trailing zero)",
      token: num(1.3, undefined, undefined, "1.3"),
      allowed: [{ value: 1.3 }],
      want: true,
    },
    {
      name: "55 matches allowed 55.0 (zero decimals written)",
      token: num(55, undefined, undefined, "55"),
      allowed: [{ value: 55.0 }],
      want: true,
    },
    {
      name: "the exact stored value matches (0.8 vs 0.8)",
      token: num(0.8, undefined, undefined, "0.8"),
      allowed: [{ value: 0.8 }],
      want: true,
    },
    {
      name: "a different value is rejected (0.85 vs 0.8)",
      token: num(0.85, undefined, undefined, "0.85"),
      allowed: [{ value: 0.8 }],
      want: false,
    },
    {
      name: "1.30 matches a stored 1.3 (trailing zero written)",
      token: num(1.3, undefined, undefined, "1.30"),
      allowed: [{ value: 1.3 }],
      want: true,
    },
    {
      name: "55.0 matches a stored 55 (trailing zero written)",
      token: num(55, undefined, undefined, "55.0"),
      allowed: [{ value: 55 }],
      want: true,
    },
    {
      name: "rounding down is rejected (4 m/s vs stored 4.3 m/s)",
      token: num(4, "m/s", undefined, "4"),
      allowed: [{ value: 4.3, unit: "m/s" }],
      want: false,
    },
    {
      name: "rounding up is rejected (0.9 vs stored 0.85)",
      token: num(0.9, undefined, undefined, "0.9"),
      allowed: [{ value: 0.85 }],
      want: false,
    },
    {
      name: "cm2 matches an allowed cm² (alias fold)",
      token: num(0.8, "cm2", undefined, "0.8"),
      allowed: [{ value: 0.8, unit: "cm\u00B2" }],
      want: true,
    },
    {
      name: "mL/m2 matches an allowed mL/m² (alias fold)",
      token: num(40, "mL/m2", undefined, "40"),
      allowed: [{ value: 40, unit: "mL/m\u00B2" }],
      want: true,
    },
    {
      name: "g/m2 matches an allowed g/m² (alias fold)",
      token: num(90, "g/m2", undefined, "90"),
      allowed: [{ value: 90, unit: "g/m\u00B2" }],
      want: true,
    },
    {
      name: "a wrong unit fails even when the value matches",
      token: num(55, "mmHg", undefined, "55"),
      allowed: [{ value: 55, unit: "m/s" }],
      want: false,
    },
    {
      name: "a unitless token matches any allowed value with that number",
      token: num(55, undefined, undefined, "55"),
      allowed: [{ value: 55, unit: "mmHg" }],
      want: true,
    },
    {
      name: "a range passes only when both ends match",
      token: num(40, undefined, 50, "40-50"),
      allowed: [{ value: 40 }, { value: 50 }],
      want: true,
    },
    {
      name: "a range fails when one end is unmatched",
      token: num(40, undefined, 51, "40-51"),
      allowed: [{ value: 40 }, { value: 50 }],
      want: false,
    },
    {
      name: "an invented value matches nothing",
      token: num(99, undefined, undefined, "99"),
      allowed: [{ value: 55 }],
      want: false,
    },
  ];

  it.each(cases)("$name", ({ token, allowed, want }) => {
    expect(matchNumber(token, allowed)).toBe(want);
  });
});

// ---------------------------------------------------------------------------
// guard — end-to-end { ok } / { ok: false, reasons }
// ---------------------------------------------------------------------------

describe("guard — end to end", () => {
  const cases: {
    name: string;
    text: string;
    expected:
      | { ok: true }
      | { ok: false; reasons: ("number" | "unknown_id" | "uncited")[] };
  }[] = [
    {
      name: "cited sentence with an allowed number passes",
      text: "Peak velocity is 1.3 m/s [E1].",
      expected: { ok: true },
    },
    {
      name: "a stored decimal restated exactly passes",
      text: "Peak velocity 1.3 m/s [E1].",
      expected: { ok: true },
    },
    {
      name: "European decimal comma is read as the allowed value",
      text: "Peak velocity 1,3 m/s [E1].",
      expected: { ok: true },
    },
    {
      name: "a percentage matching a coronary stenosis passes",
      text: "There is 55% stenosis [E1].",
      expected: { ok: true },
    },
    {
      name: "cm2 alias matches the allowed cm² valve area",
      text: "Valve area is 0.8 cm2 [E3].",
      expected: { ok: true },
    },
    {
      name: "an AHA segment number is allowed",
      text: "Wall motion of segment 7 is reported [E1].",
      expected: { ok: true },
    },
    {
      name: "a refusal sentence needs no citation",
      text: "I can only summarize numbers already in the record.",
      expected: { ok: true },
    },
    {
      name: "an invented number is rejected",
      text: "Peak velocity is 9.9 m/s [E1].",
      expected: { ok: false, reasons: ["number"] },
    },
    {
      name: "an unknown id is rejected",
      text: "Peak velocity is 1.3 m/s [F99].",
      expected: { ok: false, reasons: ["unknown_id", "uncited"] },
    },
    {
      name: "a clinical sentence with no known id is uncited",
      text: "The findings are severe.",
      expected: { ok: false, reasons: ["uncited"] },
    },
    {
      name: "a known [M#] counts as the citation of a missing-data sentence",
      text: "The indexed valve area is not recorded, so severe grading cannot be confirmed [M1].",
      expected: { ok: true },
    },
    {
      name: "an unknown M# is an unknown id (and does not cite the sentence)",
      text: "The indexed valve area is not recorded, so severe grading cannot be confirmed [M2].",
      expected: { ok: false, reasons: ["unknown_id", "uncited"] },
    },
    {
      name: "a bracketed M# id is not read as a number",
      text: "Indexed valve area is missing [M1].",
      expected: { ok: true },
    },
    {
      // Live check (task 7.4): the model writes the citation after the full stop.
      name: "a citation after the full stop cites the sentence before it",
      text: "The findings are severe. [E1]\nPeak velocity is 1.3 m/s. [E1]",
      expected: { ok: true },
    },
    {
      name: "a citation after the full stop covers only the sentence directly before it",
      text: "The findings are severe. Peak velocity is 1.3 m/s. [E1]",
      expected: { ok: false, reasons: ["uncited"] },
    },
  ];

  it.each(cases)("$name", ({ text, expected }) => {
    expect(guard(text, IDED, PATIENT)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Fixture cases: no rounded thresholds; citation numbers are allowed
// ---------------------------------------------------------------------------

describe("guard — SYN-004 aortic stenosis fixture", () => {
  const ided = withIds(AORTIC_STENOSIS);
  // No record values at all, so only the Assessment itself supplies numbers.
  const empty: NormalizedPatient = {
    ...PATIENT,
    observations: {},
    derived: [],
    valveFindings: [],
    coronaryFindings: [],
    wallMotion: [],
    wallThickness: [],
  };

  it("blocks a rounded threshold the model supplied (4 m/s vs stored 4.3 m/s)", () => {
    expect(guard("severe is Vmax of at least 4 m/s [E1]", ided, empty)).toEqual({
      ok: false,
      reasons: ["number"],
    });
  });

  it("passes the guideline year quoted from the evidence source", () => {
    expect(guard("Graded per ACC/AHA 2020 guideline [F1].", ided, empty)).toEqual({
      ok: true,
    });
  });

  it("allows numbers from evidence sources and rule ids", () => {
    const values = allowedNumbers(ided, empty).map((n) => n.value);
    expect(values).toContain(2020); // "ACC/AHA 2020 …" source
    expect(values).toContain(1); // "R-VALVE-STEN-01" rule id
    expect(values).not.toContain(4);
  });
});

describe("extractNumbers — units do not swallow the start of a word", () => {
  it("reads '2020 guideline' as a unitless 2020", () => {
    const [token] = extractNumbers("ACC/AHA 2020 guideline");
    expect(token.value).toBe(2020);
    expect(token.unit).toBeUndefined();
  });
});
