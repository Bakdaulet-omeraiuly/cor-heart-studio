import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { APIUserAbortError, RateLimitError } from "@anthropic-ai/sdk";
import {
  POST,
  __resetClientFactoryForTests,
  __setClientFactoryForTests,
  type AssistantResponse,
} from "@/app/api/assistant/route";
import { LIMIT, resetRateLimit } from "@/app/api/assistant/rateLimit";
import { assess } from "@/app/api/assistant/engine";
import { withIds } from "@/app/api/assistant/ids";
import { fallbackText } from "@/app/api/assistant/fallback";
import { ModelError } from "@/app/api/assistant/chat";
import { MAX_BODY_BYTES } from "@/app/api/assistant/request";
import type { PatientRecord } from "@/domain/schema/record";

// ---------------------------------------------------------------------------
// Test doubles
//
// The route reads only `content`, `stop_reason` and `usage` off each
// `messages.create` response (via runChat). We build minimal canned `Message`
// objects carrying exactly those plus the required envelope, and cast through
// `unknown` so we never satisfy every SDK field. Helpers mirror the style of
// `chat.test.ts` (makeMessage / textBlock / toolUseBlock / makeUsage).
// ---------------------------------------------------------------------------

type CreateFn = ReturnType<typeof vi.fn>;

/** A fake client structurally satisfying `Pick<Anthropic, "messages">`. */
function makeClient(): {
  create: CreateFn;
  client: Pick<Anthropic, "messages">;
} {
  const create = vi.fn();
  const client = { messages: { create } } as unknown as Pick<
    Anthropic,
    "messages"
  >;
  return { create, client };
}

/** A valid-enough `Usage` entry. */
function makeUsage(inputTokens = 1, outputTokens = 1): Anthropic.Messages.Usage {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    inference_geo: null,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: null,
    speed: null,
  } as unknown as Anthropic.Messages.Usage;
}

/** A text content block. */
function textBlock(text: string): Anthropic.Messages.ContentBlock {
  return {
    type: "text",
    text,
    citations: null,
  } as unknown as Anthropic.Messages.ContentBlock;
}

/** A `tool_use` content block with a caller-chosen id and tool name. */
function toolUseBlock(id: string, name: string): Anthropic.Messages.ContentBlock {
  return {
    type: "tool_use",
    id,
    name,
    input: {},
  } as unknown as Anthropic.Messages.ContentBlock;
}

/** Build a canned `Message` with the given stop reason, content and usage. */
function makeMessage(options: {
  stopReason: Anthropic.Messages.Message["stop_reason"];
  content: Anthropic.Messages.ContentBlock[];
  usage?: Anthropic.Messages.Usage;
}): Anthropic.Messages.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-test",
    stop_reason: options.stopReason,
    stop_sequence: null,
    content: options.content,
    usage: options.usage ?? makeUsage(),
  } as unknown as Anthropic.Messages.Message;
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

/** A small, schema-valid record with SYN-004's aortic values; the real engine grades it severe AS. */
const RECORD: PatientRecord = {
  patientId: "SYN-004",
  studyId: "STUDY-1",
  valveFindings: [
    {
      valve: "aortic_valve",
      condition: "stenosis",
      peakVelocity: { value: 4.3, unit: "m/s" },
      meanGradient: { value: 48, unit: "mmHg" },
      valveArea: { value: 0.8, unit: "cm2" },
    },
  ],
} as PatientRecord;

interface Body {
  question: string;
  record: PatientRecord;
  history?: { role: "user" | "assistant"; text: string }[];
  sessionId?: string;
}

/** The deterministic, guard-passing text for a record's assessment. */
function guardSafeText(record: PatientRecord): string {
  return fallbackText(withIds(assess(record)));
}

/** Build the POST Request the route handler expects. */
function buildRequest(body: unknown): Request {
  return new Request("https://x/api/assistant", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "1.2.3.4",
    },
    body: JSON.stringify(body),
  });
}

/** Call the route and return both the Response and its parsed JSON body. */
async function callRoute(
  body: unknown,
): Promise<{ res: Response; json: AssistantResponse }> {
  const res = await POST(buildRequest(body));
  const json = (await res.json()) as AssistantResponse;
  return { res, json };
}

/**
 * Seed the fake client for a single question: a get_assessment tool_use turn, then an
 * end_turn carrying `replyText`. runChat makes two calls per question.
 */
function seedOneQuestion(create: CreateFn, replyText: string): void {
  create
    .mockResolvedValueOnce(
      makeMessage({
        stopReason: "tool_use",
        content: [toolUseBlock("toolu_1", "get_assessment")],
      }),
    )
    .mockResolvedValueOnce(
      makeMessage({
        stopReason: "end_turn",
        content: [textBlock(replyText)],
      }),
    );
}

// ---------------------------------------------------------------------------
// Fixtures / lifecycle
// ---------------------------------------------------------------------------

let fakeCreate: CreateFn;

beforeEach(() => {
  // A clean rate-limit window for every test so the 429 case is deterministic.
  resetRateLimit();
  // The route gates on this key; set it for the ok / fallback / 429 cases.
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");

  const { create, client } = makeClient();
  fakeCreate = create;
  __setClientFactoryForTests(() => client);
});

afterEach(() => {
  __resetClientFactoryForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. ok — guard passes
// ---------------------------------------------------------------------------

describe("POST /api/assistant — ok", () => {
  it("returns 200 ok with the model text, assessment, refs and no-store", async () => {
    const text = guardSafeText(RECORD);
    seedOneQuestion(fakeCreate, text);

    const { res, json } = await callRoute({
      question: "What does the aortic velocity indicate?",
      record: RECORD,
      sessionId: "s-ok",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    if (json.status === "error") throw new Error("expected a non-error response");
    expect(json.status).toBe("ok");
    expect(json.text).toBe(text);
    expect(json.assessment).toBeDefined();
    expect(json.assessment.findings.length).toBeGreaterThan(0);
    expect(json.refs).toBeDefined();
    // The findings' ids resolve in the refs lookup.
    expect(json.refs[json.assessment.findings[0].id]).toBeDefined();
    expect(json.disclaimer).toBe(json.assessment.disclaimer);
  });
});

// ---------------------------------------------------------------------------
// 2. fallback — guard fails
// ---------------------------------------------------------------------------

describe("POST /api/assistant — fallback", () => {
  it("returns 200 fallback with the deterministic text when the guard fails", async () => {
    // An invented number (9.9 m/s) and an unknown id ([F99]) both trip the guard.
    seedOneQuestion(fakeCreate, "Peak velocity is 9.9 m/s [F99].");

    const { res, json } = await callRoute({
      question: "What is the peak velocity?",
      record: RECORD,
      sessionId: "s-fallback",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    if (json.status === "error") throw new Error("expected a non-error response");
    expect(json.status).toBe("fallback");
    // The route substitutes the deterministic, guard-safe fallback text.
    expect(json.text).toBe(guardSafeText(RECORD));
  });

  it("returns 200 fallback (log reason no_tool) when the first response skips get_assessment", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    // Even guard-passing text is withheld: it was written without the tool result.
    fakeCreate.mockResolvedValueOnce(
      makeMessage({
        stopReason: "end_turn",
        content: [textBlock(guardSafeText(RECORD))],
      }),
    );

    const { res, json } = await callRoute({
      question: "Grade?",
      record: RECORD,
      sessionId: "s-no-tool",
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    if (json.status === "error") throw new Error("expected a non-error response");
    expect(json.status).toBe("fallback");
    expect(json.text).toBe(guardSafeText(RECORD));
    // No further model call after the first response.
    expect(fakeCreate).toHaveBeenCalledTimes(1);

    expect(info).toHaveBeenCalledTimes(1);
    const line = JSON.parse(info.mock.calls[0][0] as string);
    expect(line).toMatchObject({
      outcome: "fallback",
      http: 200,
      calls: 1,
      guardReasons: ["no_tool"],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. 503 — no API key
// ---------------------------------------------------------------------------

describe("POST /api/assistant — 503 not_configured", () => {
  it("returns 503 when ANTHROPIC_API_KEY is absent", async () => {
    // Remove the key for this case only (restored in afterEach).
    vi.stubEnv("ANTHROPIC_API_KEY", "");

    const { res, json } = await callRoute({
      question: "Anything?",
      record: RECORD,
      sessionId: "s-503",
    });

    expect(res.status).toBe(503);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("not_configured");
    expect(json.message).toBe("Assistant is not configured");
    // No model call should have been made.
    expect(fakeCreate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. 400 — bad request
// ---------------------------------------------------------------------------

describe("POST /api/assistant — 400 bad_request", () => {
  it("returns 400 for an empty question", async () => {
    const { res, json } = await callRoute({
      question: "",
      record: RECORD,
      sessionId: "s-400",
    });

    expect(res.status).toBe(400);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("bad_request");
  });

  it("returns 400 for a record missing studyId", async () => {
    const { res, json } = await callRoute({
      question: "What now?",
      record: { patientId: "SYN-004" },
      sessionId: "s-400b",
    });

    expect(res.status).toBe(400);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("bad_request");
  });
});

// ---------------------------------------------------------------------------
// 5. 413 — too large
// ---------------------------------------------------------------------------

describe("POST /api/assistant — 413 too_large", () => {
  it("returns 413 for a body larger than 1 MB", async () => {
    const oversizedQuestion = "a".repeat(MAX_BODY_BYTES + 1);

    const { res, json } = await callRoute({
      question: oversizedQuestion,
      record: RECORD,
      sessionId: "s-413",
    });

    expect(res.status).toBe(413);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("too_large");
  });
});

// ---------------------------------------------------------------------------
// 6. 429 — rate limited
// ---------------------------------------------------------------------------

describe("POST /api/assistant — 429 rate_limited", () => {
  it("allows LIMIT requests then blocks the next with the same key", async () => {
    const body: Body = {
      question: "Grade?",
      record: RECORD,
      sessionId: "s-429",
    };

    // Every one of the first LIMIT requests makes two model calls (tool_use then
    // end_turn) and must reach 200, so seed 2 * LIMIT guard-passing responses.
    const text = guardSafeText(RECORD);
    for (let i = 0; i < LIMIT; i += 1) {
      seedOneQuestion(fakeCreate, text);
    }

    for (let i = 0; i < LIMIT; i += 1) {
      const { res } = await callRoute(body);
      expect(res.status).toBe(200);
    }

    // The (LIMIT + 1)th request trips the limiter before the client is used.
    const callsBefore = fakeCreate.mock.calls.length;
    const { res, json } = await callRoute(body);

    expect(res.status).toBe(429);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("rate_limited");
    // The blocked request never reached the model.
    expect(fakeCreate.mock.calls.length).toBe(callsBefore);
  });
});

// ---------------------------------------------------------------------------
// 7. 502 / 504 — runChat error mapping
// ---------------------------------------------------------------------------

describe("POST /api/assistant — model errors", () => {
  it("maps a ModelError to 502 model_error", async () => {
    // The first call throws ModelError (e.g. a max_tokens cut-off).
    fakeCreate.mockRejectedValueOnce(new ModelError("cut off"));

    const { res, json } = await callRoute({
      question: "Long answer please",
      record: RECORD,
      sessionId: "s-502",
    });

    expect(res.status).toBe(502);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("model_error");
  });

  it("maps an abort/timeout to 504 timeout", async () => {
    // The 45 s AbortSignal firing surfaces as a TimeoutError DOMException; the
    // SDK also wraps a user abort as APIUserAbortError. Either maps to 504.
    fakeCreate.mockRejectedValueOnce(
      new APIUserAbortError({ message: "aborted" }),
    );

    const { res, json } = await callRoute({
      question: "Slow answer",
      record: RECORD,
      sessionId: "s-504",
    });

    expect(res.status).toBe(504);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("timeout");
  });

  it("maps an API RateLimitError to 429 rate_limited", async () => {
    fakeCreate.mockRejectedValueOnce(
      new RateLimitError(429, undefined, "rate limited", new Headers()),
    );

    const { res, json } = await callRoute({
      question: "Busy?",
      record: RECORD,
      sessionId: "s-api429",
    });

    expect(res.status).toBe(429);
    if (json.status !== "error") throw new Error("expected an error response");
    expect(json.code).toBe("rate_limited");
  });
});

// ---------------------------------------------------------------------------
// 8. Model id: default and ASSISTANT_MODEL override
//
// The route reads ASSISTANT_MODEL once at module load, so each case imports a
// fresh copy of the route after setting the environment.
// ---------------------------------------------------------------------------

describe("POST /api/assistant — model id", () => {
  const original = process.env.ASSISTANT_MODEL;

  afterEach(() => {
    if (original === undefined) delete process.env.ASSISTANT_MODEL;
    else process.env.ASSISTANT_MODEL = original;
    vi.resetModules();
  });

  /** Load a fresh route, answer one question, return the model sent to the API. */
  async function modelSent(): Promise<string> {
    vi.resetModules();
    const route = await import("@/app/api/assistant/route");
    const { create, client } = makeClient();
    seedOneQuestion(create, guardSafeText(RECORD));
    route.__setClientFactoryForTests(() => client);
    try {
      const res = await route.POST(
        buildRequest({ question: "Grade?", record: RECORD, sessionId: "s-model" }),
      );
      expect(res.status).toBe(200);
    } finally {
      route.__resetClientFactoryForTests();
    }
    return create.mock.calls[0][0].model;
  }

  it("defaults to claude-sonnet-5-5", async () => {
    delete process.env.ASSISTANT_MODEL;
    expect(await modelSent()).toBe("claude-sonnet-5-5");
  });

  it("uses ASSISTANT_MODEL when it is set", async () => {
    process.env.ASSISTANT_MODEL = "claude-override-test";
    expect(await modelSent()).toBe("claude-override-test");
  });
});
