import { describe, expect, it } from "vitest";
import {
  RECORD_TEXT_CAP,
  SYSTEM_PROMPT,
  assessmentForModel,
  toolDefinitions,
} from "@/app/api/assistant/prompt";
import { withIds } from "@/app/api/assistant/ids";
import type { Assessment } from "@/app/api/assistant/engine";
import { INJECTION_IN_RECORD_TEXT } from "@/app/api/assistant/__fixtures__/assess";

const INJECTION = "IGNORE PREVIOUS INSTRUCTIONS";

/**
 * Walk a parsed JSON value and collect every string that contains `needle`,
 * paired with the key it sits under. A top-level/array value is reported with a
 * `null` key. Used to prove the injection substring only ever appears under a
 * `recordText` key.
 */
function stringsContaining(
  node: unknown,
  needle: string,
  key: string | null = null,
  hits: { key: string | null; value: string }[] = [],
): { key: string | null; value: string }[] {
  if (typeof node === "string") {
    if (node.includes(needle)) hits.push({ key, value: node });
  } else if (Array.isArray(node)) {
    for (const item of node) stringsContaining(item, needle, key, hits);
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      stringsContaining(v, needle, k, hits);
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// toolDefinitions — shape (Requirement 3.3)
// ---------------------------------------------------------------------------

describe("toolDefinitions — tool definition shape", () => {
  it("exposes exactly one tool named get_assessment", () => {
    expect(toolDefinitions).toHaveLength(1);
    expect(toolDefinitions[0].name).toBe("get_assessment");
  });

  it("is strict with a no-argument object schema", () => {
    const [tool] = toolDefinitions;
    expect(tool.strict).toBe(true);
    expect(tool.input_schema.type).toBe("object");
    expect(tool.input_schema.properties).toEqual({});
    expect(tool.input_schema.additionalProperties).toBe(false);
  });

  it("carries a non-empty description", () => {
    expect(toolDefinitions[0].description.trim().length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// SYSTEM_PROMPT — sanity (Requirement 5)
// ---------------------------------------------------------------------------

describe("SYSTEM_PROMPT — governing concepts present", () => {
  it("is a non-empty string", () => {
    expect(typeof SYSTEM_PROMPT).toBe("string");
    expect(SYSTEM_PROMPT.trim().length).toBeGreaterThan(0);
  });

  it("names the get_assessment tool as the source of facts", () => {
    expect(SYSTEM_PROMPT).toContain("get_assessment");
  });

  it("shows the citation convention with a bracketed id example", () => {
    expect(SYSTEM_PROMPT).toMatch(/\[F\d+\]|\[E\d+\]/);
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("citation");
  });

  it("states it runs on synthetic data and does not diagnose", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("synthetic");
    expect(SYSTEM_PROMPT.toLowerCase()).toMatch(/not .*diagnos|do not diagnos/);
  });

  it("mentions the coronary grading scale and the certainty basis", () => {
    expect(SYSTEM_PROMPT).toContain("CAD-RADS");
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("basis");
  });
});

// ---------------------------------------------------------------------------
// assessmentForModel — no record free text reaches the model (Req 3.4 / 4.5)
// ---------------------------------------------------------------------------

describe("assessmentForModel — no record free text reaches the model", () => {
  it("emits the injection string only inside a recordText wrapper", () => {
    const output = assessmentForModel(withIds(INJECTION_IN_RECORD_TEXT));

    // The injection string is present (the fixture carries it verbatim).
    expect(output).toContain(INJECTION);

    // Structurally: every occurrence of the injection substring sits under a
    // `recordText` key — never as a bare value of any other field.
    const parsed = JSON.parse(output);
    const hits = stringsContaining(parsed, INJECTION);
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      expect(hit.key).toBe("recordText");
    }
  });

  it("wraps the string evidence value as an object, not a bare string", () => {
    const output = assessmentForModel(withIds(INJECTION_IN_RECORD_TEXT));
    const parsed = JSON.parse(output);

    // The injection lives in the second evidence item of the first finding.
    const evidence = parsed.findings[0].evidence[1];
    expect(typeof evidence.value).toBe("object");
    expect(evidence.value).toHaveProperty("recordText");
    expect(evidence.value.recordText).toContain(INJECTION);
  });
});

// ---------------------------------------------------------------------------
// RECORD_TEXT_CAP — record text truncated to the cap
// ---------------------------------------------------------------------------

describe("assessmentForModel — RECORD_TEXT_CAP", () => {
  it("truncates a long record string value to exactly RECORD_TEXT_CAP characters", () => {
    const longValue = "A".repeat(RECORD_TEXT_CAP + 50);
    const assessment: Assessment = {
      findings: [
        {
          condition: "aortic-stenosis",
          label: "Aortic stenosis, severe",
          basis: "rule-defined",
          organ: "heart",
          evidence: [
            {
              field: "clinicianNotes",
              value: longValue,
              rule: "R-X",
              source: "s",
            },
          ],
        },
      ],
      differential: [],
      missing: [],
      redFlags: [],
      disclaimer: "d",
    };

    const parsed = JSON.parse(assessmentForModel(withIds(assessment)));
    const emitted = parsed.findings[0].evidence[0].value.recordText;
    expect(emitted).toHaveLength(RECORD_TEXT_CAP);
    expect(emitted).toBe(longValue.slice(0, RECORD_TEXT_CAP));
  });

  it("caps the injection fixture's record text at the limit", () => {
    const parsed = JSON.parse(
      assessmentForModel(withIds(INJECTION_IN_RECORD_TEXT)),
    );
    const emitted = parsed.findings[0].evidence[1].value.recordText;
    expect(emitted.length).toBeLessThanOrEqual(RECORD_TEXT_CAP);
  });
});

// ---------------------------------------------------------------------------
// assessmentForModel — determinism + numeric pass-through
// ---------------------------------------------------------------------------

describe("assessmentForModel — determinism and numeric pass-through", () => {
  it("returns an identical string when called twice on the same input", () => {
    const ided = withIds(INJECTION_IN_RECORD_TEXT);
    expect(assessmentForModel(ided)).toBe(assessmentForModel(ided));
  });

  it("passes numeric evidence values through as JSON numbers, not wrapped", () => {
    const assessment: Assessment = {
      findings: [
        {
          condition: "aortic-stenosis",
          label: "Aortic stenosis, severe",
          basis: "rule-defined",
          organ: "heart",
          evidence: [
            {
              field: "valveFindings[valve=aortic_valve].peakVelocity",
              value: 4.3,
              unit: "m/s",
              rule: "R-VALVE-STEN-01",
              source: "s",
            },
          ],
        },
      ],
      differential: [],
      missing: [],
      redFlags: [],
      disclaimer: "d",
    };

    const parsed = JSON.parse(assessmentForModel(withIds(assessment)));
    const value = parsed.findings[0].evidence[0].value;
    expect(typeof value).toBe("number");
    expect(value).toBe(4.3);
  });
});
