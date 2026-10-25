import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { handleExplain } from "@/app/api/treatments/explain/handler";
import { resetRateLimit } from "@/app/api/assistant/rateLimit";
import { evidenceBrief, sanitizeAnswer } from "@/domain/treatments/explain";

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

describe("handleExplain", () => {
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
