import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { handleTreatments } from "@/app/api/treatments/handler";
import { LIMIT, resetRateLimit } from "@/app/api/assistant/rateLimit";
import { EVIDENCE } from "@/domain/treatments/load";
import { samplePatients } from "../helpers";

const record = samplePatients().find((p) => p.patientId === "SYN-008")!;

const request = (over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/treatments", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ condition: "lvh", question: "What would you consider for this wall thickening?", record, sessionId: "s1", ...over }),
  });

const toolUse = (proposals: unknown) => ({ content: [{ type: "tool_use", id: "t1", name: "propose_treatments", input: { proposals } }], stop_reason: "tool_use" });

function deps(create: ReturnType<typeof vi.fn>, apiKey: string | undefined = "key") {
  return { apiKey, makeClient: () => ({ messages: { create } }) as unknown as Pick<Anthropic, "messages"> };
}

beforeEach(() => resetRateLimit());
afterEach(() => vi.restoreAllMocks());

describe("handleTreatments", () => {
  it("without an API key answers not_configured and never builds a client", async () => {
    const create = vi.fn();
    const res = await handleTreatments(request(), deps(create, ""));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, code: "not_configured" });
    expect(create).not.toHaveBeenCalled();
  });

  it("maps the model's tool call to sanitized proposals", async () => {
    const create = vi.fn().mockResolvedValue(toolUse([
      { id: "lvh-losartan", reason: "Regresses mass in the LIFE trial." },
      { id: "bogus", reason: "Not a button." },
      { id: "lvh-atenolol", reason: "Cuts mass by 12 g/m2." },
    ]));
    const res = await handleTreatments(request(), deps(create));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.proposals.map((p: { id: string }) => p.id)).toEqual(["lvh-losartan", "lvh-atenolol"]);
    expect(body.proposals[1].reason).toBe(EVIDENCE.entries.find((e) => e.id === "lvh-atenolol")!.why);
    expect(body.note).toMatch(/decision support/i);
  });

  it("forces the propose_treatments tool with an enum of this condition's buttons only", async () => {
    const create = vi.fn().mockResolvedValue(toolUse([]));
    await handleTreatments(request({ condition: "ad" }), deps(create));
    const arg = create.mock.calls[0][0];
    // claude-sonnet-5-5 rejects a forced tool_choice with HTTP 400 (see assistant/chat.ts)
    expect(arg.tool_choice).toEqual({ type: "auto" });
    const ids = arg.tools[0].input_schema.properties.proposals.items.properties.id.enum;
    expect(ids.sort()).toEqual(["ad-antiamyloid", "ad-bvitamins", "ad-exercise"]);
    // an off-topic question must get no button (found by scripts/eval-outlook.ts: "best pizza in Boston" used to get five)
    expect(arg.system).toMatch(/off-topic[\s\S]*empty proposals list/);
    // the API rejects maxItems / maxLength in a strict tool schema (HTTP 400)
    expect(JSON.stringify(arg.tools[0].input_schema)).not.toMatch(/maxItems|maxLength/);
  });

  it("rejects a record that fails the schema without calling the model", async () => {
    const create = vi.fn();
    const res = await handleTreatments(request({ record: { patientId: 5 } }), deps(create));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("works without a record (the brain module has none) and sends no findings", async () => {
    const create = vi.fn().mockResolvedValue(toolUse([{ id: "ad-exercise", reason: "Studied for hippocampal volume." }]));
    const res = await handleTreatments(request({ condition: "ad", record: undefined }), deps(create));
    expect(res.status).toBe(200);
    expect((await res.json()).proposals.map((p: { id: string }) => p.id)).toEqual(["ad-exercise"]);
    expect(create.mock.calls[0][0].messages[0].content).toContain("Engine findings: none");
  });

  it("rejects an unknown condition", async () => {
    const res = await handleTreatments(request({ condition: "cancer" }), deps(vi.fn()));
    expect(res.status).toBe(400);
  });

  it("returns model_error when the model call fails, without echoing its message", async () => {
    const create = vi.fn().mockRejectedValue(new Error("secret upstream detail"));
    const res = await handleTreatments(request(), deps(create));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("secret");
  });

  it("answers rate_limited after the per-minute limit", async () => {
    const create = vi.fn().mockResolvedValue(toolUse([]));
    for (let i = 0; i < LIMIT; i++) expect((await handleTreatments(request({}, { "x-forwarded-for": "9.9.9.9" }), deps(create))).status).toBe(200);
    const res = await handleTreatments(request({}, { "x-forwarded-for": "9.9.9.9" }), deps(create));
    expect(res.status).toBe(429);
  });
});
