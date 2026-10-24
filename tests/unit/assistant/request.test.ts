import { describe, expect, it } from "vitest";
import {
  AssistantRequest,
  MAX_BODY_BYTES,
  parseRequest,
  type ParseResult,
} from "@/app/api/assistant/request";

/**
 * A minimal, schema-valid `PatientRecord` input. `PatientRecordSchema` requires only
 * `patientId` and `studyId` (non-empty, trimmed strings); every other namespace is
 * optional. Keeping the record minimal isolates `parseRequest`'s own behavior from
 * the record schema's many optional branches.
 */
const validRecord = { patientId: "SYN-004", studyId: "STUDY-1" };

/** Build a POST Request to the assistant route with a JSON-serialized body. */
function jsonRequest(body: unknown): Request {
  return new Request("https://x/api/assistant", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Narrowing helper: fail loudly with the actual result if it is not `ok: false`. */
function expectRejected(
  result: ParseResult,
): asserts result is Extract<ParseResult, { ok: false }> {
  expect(result.ok).toBe(false);
}

describe("parseRequest — valid body", () => {
  it("accepts a well-formed body and returns the parsed value", async () => {
    const result = await parseRequest(
      jsonRequest({
        question: "What does the aortic velocity indicate?",
        record: validRecord,
        history: [{ role: "user", text: "hello" }],
        sessionId: "session-abc",
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.question).toBe("What does the aortic velocity indicate?");
    expect(result.body.history).toEqual([{ role: "user", text: "hello" }]);
    expect(result.body.sessionId).toBe("session-abc");
    expect(result.body.record.patientId).toBe("SYN-004");
    expect(result.body.record.studyId).toBe("STUDY-1");
  });

  it("defaults history to [] when omitted", async () => {
    const result = await parseRequest(
      jsonRequest({ question: "Why the wall thickening?", record: validRecord }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.history).toEqual([]);
  });

  it("trims surrounding whitespace off the question", async () => {
    const result = await parseRequest(
      jsonRequest({ question: "  trim me  ", record: validRecord }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.question).toBe("trim me");
  });
});

describe("parseRequest — bad request", () => {
  it("rejects a whitespace-only question (trims to empty)", async () => {
    const result = await parseRequest(
      jsonRequest({ question: "   ", record: validRecord }),
    );

    expectRejected(result);
    expect(result.code).toBe("bad_request");
  });

  it("rejects a history with more than ten turns", async () => {
    const history = Array.from({ length: 11 }, (_, i) => ({
      role: "user" as const,
      text: `turn ${i}`,
    }));
    const result = await parseRequest(
      jsonRequest({ question: "ok", record: validRecord, history }),
    );

    expectRejected(result);
    expect(result.code).toBe("bad_request");
  });

  it("rejects a record that fails PatientRecordSchema", async () => {
    // Missing the required `studyId`.
    const result = await parseRequest(
      jsonRequest({ question: "ok", record: { patientId: "SYN-004" } }),
    );

    expectRejected(result);
    expect(result.code).toBe("bad_request");
  });

  it("rejects a body that is not JSON with a JSON-specific message", async () => {
    const result = await parseRequest(
      new Request("https://x/api/assistant", {
        method: "POST",
        body: "this is not json {",
      }),
    );

    expectRejected(result);
    expect(result.code).toBe("bad_request");
    expect(result.message).toBe("Invalid JSON");
  });
});

describe("parseRequest — size cap (413 path)", () => {
  it("rejects a real body that exceeds MAX_BODY_BYTES", async () => {
    // A question longer than the 1 MB cap guarantees the serialized body is oversized.
    const oversizedQuestion = "a".repeat(MAX_BODY_BYTES + 1);
    const result = await parseRequest(
      jsonRequest({ question: oversizedQuestion, record: validRecord }),
    );

    expectRejected(result);
    expect(result.code).toBe("too_large");
  });

  it("rejects early when the declared content-length header exceeds the cap", async () => {
    // A tiny body, but a dishonest oversized content-length header: the early header
    // check must reject it before the body is even read.
    const result = await parseRequest(
      new Request("https://x/api/assistant", {
        method: "POST",
        body: JSON.stringify({ question: "ok", record: validRecord }),
        headers: { "content-length": String(MAX_BODY_BYTES + 1) },
      }),
    );

    expectRejected(result);
    expect(result.code).toBe("too_large");
  });
});

describe("parseRequest — privacy of error messages", () => {
  it("does not echo a sensitive input value in a schema-failure message", async () => {
    const secretToken = "SENSITIVE-7f3a9c2e-DO-NOT-LEAK";
    // `studyId` expects a non-empty string. Supplying the secret as the *value* of a
    // wrong-typed field (an object instead of a string) forces a schema failure whose
    // offending input carries the secret. The summarized message must report only the
    // field path and reason — never the value — so the token must not appear.
    const result = await parseRequest(
      jsonRequest({
        question: "ok",
        record: { patientId: "SYN-004", studyId: { leak: secretToken } },
      }),
    );

    expectRejected(result);
    expect(result.code).toBe("bad_request");
    expect(result.message).not.toContain(secretToken);
  });
});

describe("AssistantRequest schema", () => {
  it("is exported and parses a minimal valid body", () => {
    const parsed = AssistantRequest.safeParse({
      question: "hi",
      record: validRecord,
    });
    expect(parsed.success).toBe(true);
  });
});
