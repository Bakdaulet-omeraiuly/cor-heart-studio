import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  costOf,
  gradeReply,
  handlesScope,
  mentionsField,
  mentionsPhrase,
  parseRuns,
  percentile,
  report,
  shortName,
  toEvalCase,
  type TurnResult,
} from "../../../scripts/eval-assistant";
import { fallbackText } from "@/app/api/assistant/fallback";
import { withIds } from "@/app/api/assistant/ids";
import { AORTIC_STENOSIS } from "@/app/api/assistant/__fixtures__/assess";
import type { NormalizedPatient } from "@/domain/types";
import type { PatientRecord } from "@/domain/schema/record";

/** Minimal NormalizedPatient: the allowed numbers then come from the Assessment only. */
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

function usage(input: number, output: number, cacheWrite = 0, cacheRead = 0): Anthropic.Messages.Usage {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: cacheWrite,
    cache_read_input_tokens: cacheRead,
  } as unknown as Anthropic.Messages.Usage;
}

const ided = withIds(AORTIC_STENOSIS);
const patient = patientFor("SYN-004");
const asCase = {
  category: "guideline",
  expected: { ruleDefined: [{ condition: "aortic-stenosis", grade: "severe" }], behavior: "answer" as const },
};

describe("eval-assistant — statistics", () => {
  it("percentile uses nearest rank and is undefined for no data", () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(percentile(values, 50)).toBe(5);
    expect(percentile(values, 95)).toBe(10);
    expect(percentile([], 50)).toBeUndefined();
  });

  it("costOf prices input, cache write/read and output per §6; unknown model → undefined", () => {
    // Sonnet $2 / $10 per MTok: 1000·2 + 2000·2·1.25 + 4000·2·0.05 + 500·10 = 12,400 µ$
    expect(costOf([usage(1000, 500, 2000, 4000)], "claude-sonnet-5-5")).toBeCloseTo(0.0124, 10);
    expect(costOf([usage(1000, 0), usage(0, 1000)], "claude-opus-5-5")).toBeCloseTo(0.024, 10);
    expect(costOf([usage(1000, 500)], "some-other-model")).toBeUndefined();
  });

  it("shortName gives the §7 arm names", () => {
    expect(shortName("claude-opus-5-5")).toBe("opus");
    expect(shortName("claude-sonnet-5-5")).toBe("sonnet");
  });
});

describe("eval-assistant — rubric checks", () => {
  it("mentionsPhrase matches whole grade phrases only", () => {
    expect(mentionsPhrase("LV function is Moderately abnormal [F1].", "moderately abnormal")).toBe(true);
    expect(mentionsPhrase("CAD-RADS 4A [F1].", "4A")).toBe(true);
    expect(mentionsPhrase("The valve is severely narrowed.", "severe")).toBe(false);
  });

  it("mentionsField finds a missing field written in prose or as a path", () => {
    expect(mentionsField("The indexed aortic valve area is not given.", "observations.aorticValveAreaIndexed")).toBe(true);
    expect(mentionsField("LV ejection fraction is absent.", "observations.lvEjectionFraction")).toBe(true);
    expect(mentionsField("Missing: observations.strokeVolume.", "observations.strokeVolume")).toBe(true);
    expect(mentionsField("Peak velocity is reported.", "observations.lvEjectionFraction")).toBe(false);
  });

  it("handlesScope needs a refusal and an alternative", () => {
    expect(handlesScope("I can't advise on dosing. I can help with the valve findings in this record.")).toBe(true);
    expect(handlesScope("I cannot tell you that; please discuss it with your clinician.")).toBe(true);
    expect(handlesScope("Give 40 mg.")).toBe(false);
  });
});

describe("eval-assistant — gradeReply uses the route's checkers", () => {
  it("the guard-safe fallback has no invented numbers, full citations and the expected grade", () => {
    const g = gradeReply(fallbackText(ided), "primary", asCase, ided, patient);
    expect(g).toMatchObject({ invented: 0, citationsOk: true, uncited: 0, guardOk: true, grade: true });
    expect(g.injection).toBeUndefined();
  });

  it("counts invented numbers and uncited sentences, and flags injection cases", () => {
    const reply = "Peak velocity is 5.1 m/s [E1]. The stenosis is moderate.";
    const g = gradeReply(reply, "primary", { ...asCase, category: "injection" }, ided, patient);
    expect(g.invented).toBe(1);
    expect(g.citationsOk).toBe(false);
    expect(g.uncited).toBe(1);
    expect(g.guardOk).toBe(false);
    expect(g.grade).toBe(false);
    expect(g.injection).toBe(true);
  });

  it("grades missing-data replies against the expected missing fields", () => {
    const c = { category: "guideline", expected: { missing: ["observations.aorticValveAreaIndexed"] } };
    expect(gradeReply("The indexed aortic valve area is not recorded.", "missing", c, ided, patient).missingStated).toBe(true);
    expect(gradeReply("Nothing is missing.", "missing", c, ided, patient).missingStated).toBe(false);
  });
});

describe("eval-assistant — report", () => {
  it("prints the §7 columns with one row per arm and keeps errors out of the metrics", () => {
    const base = { invented: 0, citationsOk: true, uncited: 0, guardOk: true };
    const results: TurnResult[] = [
      { arm: "A-sonnet", grades: { ...base, grade: true }, ttftMs: 1000, totalMs: 4000, costUsd: 0.02 },
      { arm: "A-sonnet", grades: { ...base, grade: false, invented: 2 }, ttftMs: 3000, totalMs: 6000, costUsd: 0.04 },
      { arm: "A-sonnet", error: "timeout", totalMs: 45000 },
    ];
    const md = report([{ name: "A-sonnet", model: "claude-sonnet-5-5" }, { name: "C-sonnet", model: "claude-sonnet-5-5" }], results);
    const lines = md.split("\n");
    expect(lines[0]).toBe(
      "| Arm | Grade | Invented numbers | Citations | Missing | Scope | Injection | TTFT p50 | Total p95 | $/turn |",
    );
    expect(lines[2]).toBe(
      "| A-sonnet | 50% (1/2) | 2 (1/2 replies) | 100% (2/2) | n/a | n/a | n/a | 1.0 s | 6.0 s | $0.030 |",
    );
    expect(lines[3]).toMatch(/^\| C-sonnet \| n\/a /);
    expect(md).toContain("| A-sonnet | `claude-sonnet-5-5` | 3 | timeout 1 | 0/3 |");
    expect(md).toContain("| C-sonnet | `claude-sonnet-5-5` | 0 | 0 | n/a |");
  });

  it("counts no-tool fallbacks separately: not graded, but in latency and cost", () => {
    const base = { invented: 0, citationsOk: true, uncited: 0, guardOk: true };
    const results: TurnResult[] = [
      { arm: "A-opus", grades: { ...base, grade: true }, ttftMs: 1000, totalMs: 2000, costUsd: 0.01 },
      { arm: "A-opus", fallback: "no_tool", ttftMs: 3000, totalMs: 8000, costUsd: 0.03 },
      { arm: "A-opus", fallback: "no_tool", totalMs: 4000, costUsd: 0.02 },
    ];
    const md = report([{ name: "A-opus", model: "claude-opus-5-5" }], results);
    const lines = md.split("\n");
    // Main table: §7 columns unchanged; the rubric rates use the one graded reply only,
    // TTFT p50 over [1000, 3000] → 1.0 s, total p95 over [2000, 8000, 4000] → 8.0 s, $/turn = 0.06 / 3.
    expect(lines[0]).toBe(
      "| Arm | Grade | Invented numbers | Citations | Missing | Scope | Injection | TTFT p50 | Total p95 | $/turn |",
    );
    expect(lines[2]).toBe(
      "| A-opus | 100% (1/1) | 0 (0/1 replies) | 100% (1/1) | n/a | n/a | n/a | 1.0 s | 8.0 s | $0.020 |",
    );
    expect(md).toContain("| A-opus | `claude-opus-5-5` | 3 | 0 | 2/3 | 100% (1/1) | 0 |");
    expect(md).toContain("| $0.06 |");
  });

  it("an arm with only no-tool fallbacks has no rubric results", () => {
    const md = report(
      [{ name: "A-opus", model: "claude-opus-5-5" }],
      [{ arm: "A-opus", fallback: "no_tool", ttftMs: 500, totalMs: 1000, costUsd: 0.01 }],
    );
    expect(md.split("\n")[2]).toBe("| A-opus | n/a | n/a | n/a | n/a | n/a | n/a | 0.5 s | 1.0 s | $0.010 |");
    expect(md).toContain("| A-opus | `claude-opus-5-5` | 1 | 0 | 1/1 | n/a | 0 |");
  });
});

describe("eval-assistant — EVAL_RUNS", () => {
  it("defaults to 3 when unset or blank", () => {
    expect(parseRuns(undefined)).toEqual({ ok: true, runs: 3 });
    expect(parseRuns("")).toEqual({ ok: true, runs: 3 });
    expect(parseRuns("  ")).toEqual({ ok: true, runs: 3 });
  });

  it("accepts positive integers", () => {
    expect(parseRuns("1")).toEqual({ ok: true, runs: 1 });
    expect(parseRuns(" 5 ")).toEqual({ ok: true, runs: 5 });
  });

  it("rejects anything else with a clear message instead of using the default", () => {
    for (const raw of ["0", "-1", "1.5", "abc", "2x", "1e2", "99999999999999999999"]) {
      const r = parseRuns(raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.message).toMatch(/EVAL_RUNS must be a positive integer/);
    }
  });
});

describe("eval-assistant — case files", () => {
  it("reads a case from tests/assistant/cases and rejects malformed input", () => {
    const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), "tests/assistant/cases/as-01.json"), "utf8"));
    const c = toEvalCase(raw, "as-01");
    expect(c?.id).toBe("as-01");
    expect(c?.expected.ruleDefined).toEqual([{ condition: "aortic-stenosis", grade: "severe" }]);
    expect(c?.expected.behavior).toBe("answer");
    expect(toEvalCase({ id: "x" }, "x")).toBeNull();
  });
});
