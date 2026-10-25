import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { handleExplain } from "@/app/api/treatments/explain/handler";
import { resetRateLimit } from "@/app/api/assistant/rateLimit";
import { allowedNumbers, evidenceBrief, inventedNumbers, sanitizeAnswer, withheldAnswer } from "@/domain/treatments/explain";

const request = (over: Record<string, unknown> = {}) =>
  new Request("http://localhost/api/treatments/explain", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ condition: "lvh", question: "What does losartan do to LV mass?", sessionId: "s1", ...over }),
  });
const reply = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn" });
const deps = (create: ReturnType<typeof vi.fn>, apiKey: string | undefined = "key") => ({ apiKey, makeClient: () => ({ messages: { create } }) as unknown as Pick<Anthropic, "messages"> });

beforeEach(() => resetRateLimit());
afterEach(() => vi.restoreAllMocks());

describe("sanitizeAnswer", () => {
  it("numbers known citations, links them to the file's DOI, and drops unknown ones", () => {
    const { answer, sources } = sanitizeAnswer("Losartan regressed mass [S:devereux2004]. Made up [S:nope]. Again [S:devereux2004].", "lvh");
    expect(answer).toBe("Losartan regressed mass [1]. Made up. Again [1].");
    expect(sources).toHaveLength(1);
    expect(sources[0].doi).toBe("10.1161/01.CIR.0000141573.44737.5A");
  });
  it("refuses a source that belongs to another condition", () => {
    expect(sanitizeAnswer("x [S:devereux2004]", "ad").sources).toEqual([]);
  });
});

describe("number guard", () => {
  it("allows numbers that are in the evidence, with either sign and a decimal comma", () => {
    expect(allowedNumbers("lvh", "")).toContain(21.7);
    expect(inventedNumbers("Losartan lowered LVMI by 21,7 g/m² over 4.8 years [S:devereux2004].", "lvh", "")).toEqual([]);
    expect(inventedNumbers("It changed by -21.7 g/m².", "lvh", "")).toEqual([]);
  });
  it("flags a number that no study reported, including a rounded or derived one", () => {
    expect(inventedNumbers("Losartan lowers LV mass by 47% in most patients.", "lvh", "")).toEqual(["47"]);
    expect(inventedNumbers("About 22 g/m² less.", "lvh", "")).toEqual(["22"]);
  });
  it("ignores the digits inside a [S:id] marker", () => {
    expect(inventedNumbers("Seen in LIFE [S:devereux2004] and [S:gerdts2009].", "lvh", "")).toEqual([]);
  });
  it("allows a number the clinician typed in the question", () => {
    expect(inventedNumbers("At 37 g/m² the answer is the same.", "lvh", "My patient has an LVMI of 37 g/m².")).toEqual([]);
  });
  it("withheldAnswer is written by code and lists only this condition's studies", () => {
    const w = withheldAnswer("ad");
    expect(w.answer).toMatch(/withheld/);
    expect(w.answer).not.toMatch(/\d/);
    expect(w.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["alves2023", "smith2010"]));
    expect(w.sources.map((s) => s.id)).not.toContain("devereux2004");
  });
});

describe("handleExplain", () => {
  it("withholds a reply that holds an invented number and answers with the studies instead", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockResolvedValue(reply("Losartan lowers LV mass by 47% [S:devereux2004]."));
    const body = await (await handleExplain(request(), deps(create))).json();
    expect(body.ok).toBe(true);
    expect(body.withheld).toBe(true);
    expect(body.answer).not.toContain("47");
    expect(body.sources.length).toBeGreaterThan(1);
  });
  it("lets a reply through that only restates the evidence", async () => {
    const create = vi.fn().mockResolvedValue(reply("In LIFE, losartan lowered LV mass index by 21.7 g/m² [S:devereux2004]."));
    const body = await (await handleExplain(request(), deps(create))).json();
    expect(body.withheld).toBeUndefined();
    expect(body.answer).toContain("21.7");
  });
  it("puts the condition's evidence in the system prompt and returns the cited answer", async () => {
    const create = vi.fn().mockResolvedValue(reply("Losartan lowered LV mass in an RCT [S:devereux2004]."));
    const res = await handleExplain(request(), deps(create));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.answer).toBe("Losartan lowered LV mass in an RCT [1].");
    expect(body.sources[0].id).toBe("devereux2004");
    expect(create.mock.calls[0][0].system).toContain(evidenceBrief("lvh"));
  });
  it("without a key answers not_configured and never calls the model", async () => {
    const create = vi.fn();
    const res = await handleExplain(request(), deps(create, ""));
    expect(res.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });
  it("rejects a bad condition", async () => {
    expect((await handleExplain(request({ condition: "xx" }), deps(vi.fn()))).status).toBe(400);
  });
  it("maps a model failure to model_error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleExplain(request(), deps(vi.fn().mockRejectedValue(new Error("boom"))));
    expect(res.status).toBe(502);
  });
});
