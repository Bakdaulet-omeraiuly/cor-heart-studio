import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  allowedNumbers,
  checkCitations,
  extractNumbers,
  guard,
  hasClinicalTerm,
  matchNumber,
  type NumberToken,
} from "@/app/api/assistant/guard";
import { withIds } from "@/app/api/assistant/ids";
import { assess } from "@/app/api/assistant/engine";
import { normalizeRecord } from "@/domain/normalization/normalize";
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
  // One red flag → R1, so the `[R#]` citation cases have a known id.
  redFlags: ["Severe aortic stenosis with reported symptoms: urgent specialist review."],
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

  it("ignores digits inside red-flag ids ([R1], bare R2)", () => {
    expect(extractNumbers("Referral advised [R1]; see also R2.")).toEqual([]);
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
      name: "a known [R#] counts as the citation of a red-flag sentence",
      text: "Severe aortic stenosis is flagged, so urgent specialist referral is advised [R1].",
      expected: { ok: true },
    },
    {
      name: "an unknown R# is an unknown id (and does not cite the sentence)",
      text: "Severe aortic stenosis is flagged, so urgent specialist referral is advised [R2].",
      expected: { ok: false, reasons: ["unknown_id", "uncited"] },
    },
    {
      name: "an R# citation after the full stop cites the sentence before it",
      text: "Severe aortic stenosis is flagged. [R1]\nPeak velocity is 1.3 m/s [E1].",
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

// ---------------------------------------------------------------------------
// Clinical terms (task 14.3, Requirement 6.4)
// ---------------------------------------------------------------------------

describe("hasClinicalTerm — whole words, sensible forms", () => {
  it.each([
    "QT", "QTc", "QT/QTc", "PR interval", "QRS", "EF", "LVEF", "ejection fraction",
    "ventricle", "ventricles", "ventricular", "atrium", "atria", "atrial", "valve", "valves",
    "stenosis", "stenoses", "regurgitation", "hypertrophy", "coronary", "oxygen saturation",
    "Blood Pressure", "heart rate", "hippocampus", "hippocampal", "atrophy",
  ])("matches %s", (text) => {
    expect(hasClinicalTerm(text)).toBe(true);
  });

  it.each([
    "prior", "effect", "previous", "pr", "ef", "qt", "Prior results", "the effect of time",
    "QTxyz", "valveFindings", "ventriclesque",
  ])("does not match %s", (text) => {
    expect(hasClinicalTerm(text)).toBe(false);
  });
});

describe("guard — clinical terms need a citation", () => {
  const cases: {
    name: string;
    text: string;
    expected: { ok: true } | { ok: false; reasons: ("number" | "unknown_id" | "uncited")[] };
  }[] = [
    {
      name: "an uncited QT / oxygen-saturation claim is rejected",
      text: "Low oxygen saturation can strain the heart and lengthen the QT interval.",
      expected: { ok: false, reasons: ["uncited"] },
    },
    {
      name: "a refusal that only names the topic is accepted",
      text: "Oxygen saturation is not something I assess.",
      expected: { ok: true },
    },
    {
      name: "an I-first refusal naming the topic is accepted",
      text: "I don't assess blood pressure here.",
      expected: { ok: true },
    },
    {
      name: "a 'what I can help with' list of clinical terms is accepted",
      text: "I can help with aortic stenosis, LV function, coronary stenosis and QTc.",
      expected: { ok: true },
    },
    {
      name: "refusal plus help list in one reply is accepted",
      text: "Oxygen saturation is not something I assess. I can help with aortic stenosis, LV function, coronary stenosis and QTc.",
      expected: { ok: true },
    },
    {
      name: "a claim dressed as a refusal is still rejected",
      text: "Low oxygen saturation lengthens the QT interval, which is not something I assess.",
      expected: { ok: false, reasons: ["uncited"] },
    },
    {
      name: "a claim tacked onto a help list is still rejected",
      text: "I can help with coronary stenosis because it causes heart failure.",
      expected: { ok: false, reasons: ["uncited"] },
    },
    {
      name: "an uncited EF sentence is rejected",
      text: "The EF looks preserved.",
      expected: { ok: false, reasons: ["uncited"] },
    },
    {
      name: "an uncited ventricle sentence is rejected",
      text: "The left ventricle appears enlarged.",
      expected: { ok: false, reasons: ["uncited"] },
    },
    {
      name: "an uncited hippocampus atrophy sentence is rejected",
      text: "There is hippocampus atrophy on this scan.",
      expected: { ok: false, reasons: ["uncited"] },
    },
    {
      name: "a cited clinical-term sentence is accepted",
      text: "The aortic valve is the main finding [F1].",
      expected: { ok: true },
    },
    {
      name: "ordinary words like prior / effect / previous do not trigger",
      text: "The prior answer had no effect on the previous summary.",
      expected: { ok: true },
    },
  ];

  it.each(cases)("$name", ({ text, expected }) => {
    expect(guard(text, IDED, PATIENT)).toEqual(expected);
  });
});

describe("guard — real engine on the SYN-004 sample", () => {
  const samples = (
    JSON.parse(readFileSync(resolve(process.cwd(), "public/samples/synthetic-patients.json"), "utf8")) as {
      patients: { patientId?: string }[];
    }
  ).patients;
  const n = normalizeRecord(samples.find((p) => p.patientId === "SYN-004"));
  if (!n.ok) throw new Error("SYN-004 sample does not normalize");
  const ided = withIds(assess(n.patient.record));

  it("the engine raises a red flag for SYN-004, stamped R1", () => {
    expect(ided.redFlags.map((f) => f.id)).toEqual(["R1"]);
  });

  it("accepts a referral sentence cited by its R1 red flag", () => {
    expect(guard("Urgent specialist referral is advised [R1].", ided, n.patient)).toEqual({ ok: true });
  });

  it("rejects the same sentence citing a red flag that does not exist", () => {
    // Referral terms are clinical (task 15.2), so an unknown R2 also leaves the
    // sentence uncited.
    expect(guard("Urgent specialist referral is advised [R2].", ided, n.patient)).toEqual({
      ok: false,
      reasons: ["unknown_id", "uncited"],
    });
  });

  it("rejects an uncited valve claim for SYN-004", () => {
    expect(guard("The aortic valve needs replacing soon.", ided, n.patient)).toEqual({
      ok: false,
      reasons: ["uncited"],
    });
  });
});

// ---------------------------------------------------------------------------
// Referral terms are clinical (task 15.2, Requirements 5.5, 6.4, 6.5)
// ---------------------------------------------------------------------------

describe("guard — referral terms need a citation", () => {
  const syn004 = (() => {
    const samples = (
      JSON.parse(readFileSync(resolve(process.cwd(), "public/samples/synthetic-patients.json"), "utf8")) as {
        patients: { patientId?: string }[];
      }
    ).patients;
    const n = normalizeRecord(samples.find((p) => p.patientId === "SYN-004"));
    if (!n.ok) throw new Error("SYN-004 sample does not normalize");
    return { ided: withIds(assess(n.patient.record)), patient: n.patient };
  })();
  const contexts = [
    { name: "inline fixture", ided: IDED, patient: PATIENT },
    { name: "real engine SYN-004", ...syn004 },
  ];

  it.each(["refer", "Refers", "REFERRED", "referring", "Referral", "referrals"])(
    "hasClinicalTerm matches %s",
    (word) => {
      expect(hasClinicalTerm(`We ${word} now`)).toBe(true);
    },
  );

  it.each(["reference", "preference", "referee", "References", "deferral", "referendum"])(
    "hasClinicalTerm does not match %s",
    (word) => {
      expect(hasClinicalTerm(`A ${word} here`)).toBe(false);
    },
  );

  describe.each(contexts)("$name", ({ ided, patient }) => {
    it.each([
      "Urgent specialist referral is advised.",
      "Please refer to a valve specialist.",
      "The patient should be referred urgently.",
      "We are referring this case onward.",
      "Two referrals are advised.",
    ])("rejects uncited %s", (text) => {
      const result = guard(text, ided, patient);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reasons).toContain("uncited");
    });

    it.each([
      "See the reference section for details.",
      "Your preference is noted.",
      "The referee made a call.",
    ])("accepts non-referral words: %s", (text) => {
      expect(guard(text, ided, patient)).toEqual({ ok: true });
    });

    it("accepts a refusal that names referral decisions as not assessed", () => {
      // Names the topic and says it is not assessed, so the refusal exception
      // applies (Requirement 6.4): no citation needed.
      expect(guard("Referral decisions are not something I assess.", ided, patient)).toEqual({ ok: true });
    });
  });

  it("the uncited referral sentence is reported for the inline fixture", () => {
    expect(checkCitations("Urgent specialist referral is advised.", IDED).uncitedSentences).toEqual([
      "Urgent specialist referral is advised.",
    ]);
  });

  it("accepts the referral sentence cited [R1] for SYN-004", () => {
    expect(guard("Urgent specialist referral is advised [R1].", syn004.ided, syn004.patient)).toEqual({ ok: true });
  });

  it("the SYN-004 red-flag line from the engine passes when it starts with its R id", () => {
    const [flag] = syn004.ided.redFlags;
    expect(flag.id).toBe("R1");
    expect(guard(`${flag.id} ${flag.text}`, syn004.ided, syn004.patient)).toEqual({ ok: true });
  });
});

describe("extractNumbers — units do not swallow the start of a word", () => {
  it("reads '2020 guideline' as a unitless 2020", () => {
    const [token] = extractNumbers("ACC/AHA 2020 guideline");
    expect(token.value).toBe(2020);
    expect(token.unit).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scope topics in refusal / "what I can help with" sentences (task 15.1,
// Requirements 5.6, 6.2, 6.4)
// ---------------------------------------------------------------------------

/** Normalize a record, run the real engine and stamp ids, as route.ts does. */
function realEngine(record: unknown): { ided: ReturnType<typeof withIds>; patient: NormalizedPatient } {
  const n = normalizeRecord(record);
  if (!n.ok) throw new Error("record does not normalize");
  return { ided: withIds(assess(n.patient.record)), patient: n.patient };
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(resolve(process.cwd(), path), "utf8"));

const SYN004 = realEngine(
  (readJson("public/samples/synthetic-patients.json") as { patients: { patientId?: string }[] }).patients.find(
    (p) => p.patientId === "SYN-004",
  ),
);
// ecg-01: QTc 449 ms → the engine's finding has condition "qtc", which used to
// match the "QTc" item of a help list as a finding mention.
const ECG01 = realEngine((readJson("tests/assistant/cases/ecg-01.json") as { record: unknown }).record);

const SCOPE_CONTEXTS = [
  { name: "inline fixture", ided: IDED, patient: PATIENT },
  { name: "real engine SYN-004 (aortic stenosis)", ...SYN004 },
  { name: "real engine ecg-01 (QTc)", ...ECG01 },
];

describe("guard — scope topics in a help list", () => {
  it("the real-engine Assessments overlap the scope topics", () => {
    expect(SYN004.ided.findings.map((f) => f.condition)).toContain("aortic-stenosis");
    expect(ECG01.ided.findings.map((f) => f.condition)).toContain("qtc");
  });

  describe.each(SCOPE_CONTEXTS)("$name", ({ ided, patient }) => {
    it.each([
      "I can help with aortic stenosis, LV function and QTc.",
      "I can help with coronary stenosis graded by CAD-RADS 2.0.",
      "I can help with QTc.",
      "Oxygen saturation is not something I assess. I can help with coronary stenosis graded by CAD-RADS 2.0, ECG intervals and QTc.",
    ])("accepts %s", (text) => {
      expect(checkCitations(text, ided).uncitedSentences).toEqual([]);
      expect(guard(text, ided, patient)).toEqual({ ok: true });
    });

    it("rejects an uncited QT claim", () => {
      expect(guard("Low oxygen saturation can lengthen the QT interval.", ided, patient)).toEqual({
        ok: false,
        reasons: ["uncited"],
      });
    });

    it("still checks a non-scope claim item in the list", () => {
      expect(
        guard("I can help with QTc and low oxygen saturation lengthening the QT interval.", ided, patient),
      ).toEqual({ ok: false, reasons: ["uncited"] });
    });

    it("still flags the sentence after '… CAD-RADS 2.0.'", () => {
      const text = "I can help with coronary stenosis graded by CAD-RADS 2.0. The valve is severe.";
      expect(checkCitations(text, ided).uncitedSentences).toEqual(["The valve is severe."]);
      expect(guard(text, ided, patient)).toEqual({ ok: false, reasons: ["uncited"] });
    });
  });

  it.each([
    { name: "a grade word in a non-scope item", text: "I can help with QTc and severe valve disease." },
    { name: "a claim word after a scope topic", text: "I can help with QTc, which is prolonged." },
    { name: "a scope topic followed by more words", text: "I can help with aortic stenosis that is severe." },
  ])("rejects $name", ({ text }) => {
    expect(guard(text, ECG01.ided, ECG01.patient)).toEqual({ ok: false, reasons: ["uncited"] });
  });

  it("checks a number in a non-scope item", () => {
    expect(guard("I can help with QTc and the 9.9 m/s jet.", IDED, PATIENT)).toEqual({
      ok: false,
      reasons: ["number", "uncited"],
    });
  });

  it("checks the '2.0' when it is written outside a help list", () => {
    expect(guard("I can help with QTc. The scale used is CAD-RADS 2.0 [F1].", IDED, PATIENT)).toEqual({
      ok: false,
      reasons: ["number"],
    });
  });

  it("splits after '… CAD-RADS 2.0.' so a citation on the next sentence covers only that one", () => {
    expect(
      guard("I can help with coronary stenosis graded by CAD-RADS 2.0. The valve is severe [F1].", IDED, PATIENT),
    ).toEqual({ ok: true });
  });
});
