import { describe, expect, it } from "vitest";
import type { Ref } from "@/app/api/assistant/ids";
import { refAccessibleName, refDetails, refValue, splitReply, stripMarkdown } from "@/components/assistant/replyParts";

const evidence: Ref = {
  id: "E1",
  kind: "evidence",
  label: "Aortic stenosis, severe",
  field: "valves.aortic.peakVelocity",
  value: 4.3,
  unit: "m/s",
  rule: "R-VALVE-STEN-01",
  source: "ACC/AHA 2020",
  target: "aortic_valve",
  organ: "heart",
};
const finding: Ref = { id: "F1", kind: "finding", label: "Aortic stenosis, severe", organ: "heart", target: "aortic_valve" };
const missing: Ref = {
  id: "M1",
  kind: "missing",
  label: "Missing data",
  field: "observations.aorticValveAreaIndexed",
  why: "Indexed valve area confirms severe grading.",
};
const redFlag: Ref = {
  id: "R1",
  kind: "redFlag",
  label: "Red flag",
  text: "Severe aortic stenosis with reported symptoms: urgent specialist review.",
};

describe("splitReply", () => {
  it("splits bracketed ids into ref parts and keeps the text around them", () => {
    expect(splitReply("Severe AS [F1]. Peak velocity 4.3 m/s [E1].")).toEqual([
      { kind: "text", text: "Severe AS " },
      { kind: "ref", id: "F1" },
      { kind: "text", text: ". Peak velocity 4.3 m/s " },
      { kind: "ref", id: "E1" },
      { kind: "text", text: "." },
    ]);
  });

  it("splits a grouped citation into one ref per id", () => {
    expect(splitReply("LVH [F2, E5,E6]")).toEqual([
      { kind: "text", text: "LVH " },
      { kind: "ref", id: "F2" },
      { kind: "ref", id: "E5" },
      { kind: "ref", id: "E6" },
    ]);
  });

  it("splits [M#] citations, alone and grouped, into ref parts", () => {
    expect(splitReply("Indexed area not recorded [M1]. Grade [F1, M2].")).toEqual([
      { kind: "text", text: "Indexed area not recorded " },
      { kind: "ref", id: "M1" },
      { kind: "text", text: ". Grade " },
      { kind: "ref", id: "F1" },
      { kind: "ref", id: "M2" },
      { kind: "text", text: "." },
    ]);
  });

  it("splits [R#] citations, alone and grouped, into ref parts", () => {
    expect(splitReply("Urgent specialist referral is advised [R1]. Severe AS [F1, R2].")).toEqual([
      { kind: "text", text: "Urgent specialist referral is advised " },
      { kind: "ref", id: "R1" },
      { kind: "text", text: ". Severe AS " },
      { kind: "ref", id: "F1" },
      { kind: "ref", id: "R2" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves bare ids, other brackets and plain text untouched", () => {
    expect(splitReply("See E1 and [note] or [X1].")).toEqual([{ kind: "text", text: "See E1 and [note] or [X1]." }]);
    expect(splitReply("")).toEqual([]);
  });

  it("round-trips single-id citations", () => {
    const text = "[F1] at start, middle [E12], end [E3]";
    const back = splitReply(text).map((p) => (p.kind === "text" ? p.text : `[${p.id}]`)).join("");
    expect(back).toBe(text);
  });
});

describe("stripMarkdown", () => {
  it("removes every ** marker", () => {
    expect(stripMarkdown("**Severe** aortic stenosis [F1]. **")).toBe("Severe aortic stenosis [F1]. ");
  });

  it("removes a leading '- ' bullet on each line, including indented ones", () => {
    expect(stripMarkdown("- Severe AS [F1].\n  - Peak velocity 4.3 m/s [E1].\nNo bullet here.")).toBe(
      "Severe AS [F1].\nPeak velocity 4.3 m/s [E1].\nNo bullet here.",
    );
  });

  it("keeps hyphens and minus signs inside text and at line start without a space", () => {
    const text = "LVEF 40-50% [E2]. Strain -2.5 [E3].\n-2.5 is the value [E3]. Left - right shunt absent.";
    expect(stripMarkdown(text)).toBe(text);
  });

  it("leaves citations splittable after stripping", () => {
    expect(splitReply(stripMarkdown("- **Severe** AS [F1].\n- Area not recorded [M1]."))).toEqual([
      { kind: "text", text: "Severe AS " },
      { kind: "ref", id: "F1" },
      { kind: "text", text: ".\nArea not recorded " },
      { kind: "ref", id: "M1" },
      { kind: "text", text: "." },
    ]);
  });
});

describe("ref formatting", () => {
  it("formats evidence as label · field = value unit · rule · source", () => {
    expect(refValue(evidence)).toBe("4.3 m/s");
    expect(refDetails(evidence)).toEqual([
      "Aortic stenosis, severe",
      "valves.aortic.peakVelocity = 4.3 m/s",
      "Rule R-VALVE-STEN-01",
      "ACC/AHA 2020",
    ]);
  });

  it("formats a finding as its label only", () => {
    expect(refValue(finding)).toBeNull();
    expect(refDetails(finding)).toEqual(["Aortic stenosis, severe"]);
  });

  it("handles unitless and string values", () => {
    expect(refValue({ ...evidence, value: 3, unit: undefined })).toBe("3");
    expect(refValue({ ...evidence, value: "hypokinetic", unit: undefined })).toBe("hypokinetic");
    expect(refDetails({ ...evidence, value: undefined, unit: undefined })[1]).toBe("valves.aortic.peakVelocity");
  });

  it("formats a missing-data ref as label · field · why", () => {
    expect(refDetails(missing)).toEqual([
      "Missing data",
      "observations.aorticValveAreaIndexed",
      "Indexed valve area confirms severe grading.",
    ]);
  });

  it("formats a red-flag ref as label · text", () => {
    expect(refValue(redFlag)).toBeNull();
    expect(refDetails(redFlag)).toEqual(["Red flag", "Severe aortic stenosis with reported symptoms: urgent specialist review."]);
  });

  it("names id buttons by kind", () => {
    expect(refAccessibleName("R1", redFlag)).toBe("Red flag R1");
    expect(refAccessibleName("M1", missing)).toBe("Missing data M1");
    expect(refAccessibleName("E1", evidence)).toBe("Evidence E1");
    expect(refAccessibleName("F1", finding)).toBe("Finding F1");
    expect(refAccessibleName("F9", undefined)).toBe("Citation F9");
  });
});
