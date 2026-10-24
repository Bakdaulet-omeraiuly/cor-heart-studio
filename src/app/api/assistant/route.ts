// POST /api/assistant — the thin server route that turns a clinician's question
// plus the selected record into a checked, cited answer (Requirements 2.1, 2.5,
// 3.1, 4.2, 4.3, 4.6, 6.6, 7.1, 7.2, 7.3, 8.1, 8.3, 9.1, 9.2, 9.3).
//
// Next.js 16.4.2 notes (from node_modules/next/dist/docs/, confirmed against
// next.config.ts where `cacheComponents: true`): a route handler is this
// `route.ts` exporting `POST(request: Request)`; non-GET handlers are never
// cached. With Cache Components enabled, the segment options `dynamic`,
// `revalidate` and `fetchCache` are REMOVED, and `runtime` is rejected too (the
// Node.js runtime is the fixed default). So this file exports only `maxDuration`.
//
// Every numbered pipeline step below is a pure function living in its own module
// (except runChat, which takes an injected client), so the whole route is unit
// testable without a network. The only side effect at module scope is the
// `clientFactory` seam described under "Testability seam".
//
// ---------------------------------------------------------------------------
// Pipeline order (design.md "Route") and why it is THIS order
// ---------------------------------------------------------------------------
// design.md lists "rate limit → parse → (no key → 503) → normalize → assess →
// withIds → runChat → guard → response". But the rate-limit KEY needs the
// `sessionId`, which lives in the request body and is only known after parsing.
// We therefore parse FIRST (which also enforces the 413/400 size-and-shape caps),
// then rate-limit using `ip + sessionId`. This is the order the route uses:
//
//   1. parse           → 413 too_large / 400 bad_request
//   2. rate limit      → 429 rate_limited        (key = x-forwarded-for[0] + sessionId)
//   3. key check       → 503 not_configured      (no ANTHROPIC_API_KEY)
//   4. normalize       → 400 bad_request on a hard failure
//   5. assess          → the engine's Assessment  (assess takes PatientRecord)
//   6. withIds / refs  → F#/E# ids + the id→Ref lookup
//   7. runChat (45 s)  → 502 model_error / 504 timeout / 429 rate_limited (API 429)
//   8. first-call rule → 200 fallback (log reason no_tool) when the first model
//                        response did not call get_assessment
//      guard           → 200 ok (guard passes) | 200 fallback (guard fails)
//
// Rationale for parse-before-rate-limit (vs. the literal "rate limit → parse"):
//   - The limiter is keyed by session, and the session comes from the body, so a
//     useful key is impossible before parsing.
//   - Parsing is cheap and bounded (the 1 MB cap is enforced inside parseRequest
//     before any JSON work), so it is safe to do first.
//   - The route test (task 7.3) exercises "429 after 10 requests" by sending the
//     SAME valid body 11 times with the same `sessionId`; because parsing a valid
//     body always succeeds and is deterministic, the 11th call deterministically
//     trips the limiter on step 2. (A 413/400 body never reaches step 2, so a
//     malformed request never consumes a rate-limit slot.)

import Anthropic from "@anthropic-ai/sdk";
import { APIUserAbortError, RateLimitError } from "@anthropic-ai/sdk";
import { normalizeRecord } from "@/domain/normalization/normalize";
import { parseRequest } from "./request";
import { assess } from "./engine";
import { withIds, refsFor, type IdedAssessment, type Ref } from "./ids";
import { assessmentForModel } from "./prompt";
import { runChat, ModelError } from "./chat";
import { guard } from "./guard";
import { fallbackText } from "./fallback";
import { rateLimit, rateLimitKey } from "./rateLimit";

// --- Segment config (Requirement 2.1; Next 16.4.2 + cacheComponents) ----------
// The Node.js runtime is needed for Buffer (size check) and the Anthropic SDK;
// `maxDuration = 60` is the platform function ceiling. The inner model call is
// bounded more tightly to 45 s (see RUN_CHAT_TIMEOUT_MS) so a timeout still
// leaves headroom to build and return the 504 response within the 60 s budget.
// Do NOT add `dynamic`/`revalidate`/`fetchCache`: they are removed under
// cacheComponents and would be a build error.
// No `runtime` export either: with cacheComponents, Next 16.4.2 rejects it at
// build time — even `runtime = "nodejs"` — and always uses the Node.js runtime
// (node_modules/next/dist/docs/.../02-route-segment-config/runtime.md).
export const maxDuration = 60;

/** Model-call timeout. The route aborts runChat at 45 s (design.md "runChat"). */
const RUN_CHAT_TIMEOUT_MS = 45_000;

/**
 * Output token cap per model call. A single grounded, cited answer is short
 * (design.md rule 9: "keep answers short"); 1024 tokens is comfortably enough and
 * keeps a runaway generation cheap. Env-overridable for the eval script / tuning.
 */
const DEFAULT_MAX_TOKENS = 1024;

/**
 * The model id. Env-overridable (`ASSISTANT_MODEL`) so the eval script and future
 * tuning can swap models without a code change; defaults to the current Sonnet.
 */
const DEFAULT_MODEL = process.env.ASSISTANT_MODEL ?? "claude-sonnet-5-5";

/**
 * The JSON response shapes the route returns (design.md "Data Models").
 * Success and fallback share one shape; errors carry a stable `code`.
 */
export type AssistantResponse =
  | {
      status: "ok" | "fallback";
      text: string;
      assessment: IdedAssessment;
      refs: Record<string, Ref>;
      disclaimer: string;
    }
  | {
      status: "error";
      code:
        | "bad_request"
        | "too_large"
        | "rate_limited"
        | "not_configured"
        | "model_error"
        | "timeout";
      message: string;
    };

// ---------------------------------------------------------------------------
// Testability seam (for task 7.3)
// ---------------------------------------------------------------------------
// The route creates the real Anthropic client, which the route test must replace
// with a fake (the test injects canned tool_use / end_turn responses to exercise
// the ok / fallback paths). Two ways in are supported, in order of preference:
//
//   A) `vi.mock("@anthropic-ai/sdk", …)` — the default `Anthropic` import is
//      mocked so `new Anthropic({ apiKey })` returns the fake. Works because the
//      route constructs the client through `clientFactory`, which calls the
//      imported constructor.
//
//   B) `__setClientFactoryForTests(fn)` — a TEST-ONLY hook that replaces the
//      factory outright with `(apiKey) => fakeClient`. Simpler than module
//      mocking when the test already has a fake object. Call
//      `__resetClientFactoryForTests()` in `afterEach` to restore the default.
//
// Either way the client is only ever BUILT when `ANTHROPIC_API_KEY` is set, so the
// "503 without key" test needs no client at all.
type ClientFactory = (apiKey: string) => Pick<Anthropic, "messages">;

/** The default factory builds the real SDK client. Replaced only by tests. */
const defaultClientFactory: ClientFactory = (apiKey) => new Anthropic({ apiKey });

/** Current factory; module-level `let` so a test can swap it (seam B). */
let clientFactory: ClientFactory = defaultClientFactory;

/** TEST ONLY: install a fake client factory (see seam B above). */
export function __setClientFactoryForTests(factory: ClientFactory): void {
  clientFactory = factory;
}

/** TEST ONLY: restore the real client factory. Call in `afterEach`. */
export function __resetClientFactoryForTests(): void {
  clientFactory = defaultClientFactory;
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

/**
 * Build a JSON `Response` with the given status and body. EVERY response from
 * this route sets `cache-control: no-store` (Requirement 9.3 / design.md): a
 * per-patient clinical answer must never be cached by the browser or any proxy.
 * `content-type` is set explicitly so the single header object is the one source
 * of truth for the response headers.
 */
function json(status: number, body: AssistantResponse): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** Build the error-shaped body + HTTP status for a given error `code`. */
function errorResponse(
  httpStatus: number,
  code: Extract<AssistantResponse, { status: "error" }>["code"],
  message: string,
): Response {
  return json(httpStatus, { status: "error", code, message });
}

// ---------------------------------------------------------------------------
// Logging (Requirement 9.1/9.2: exactly one content-free line per request)
// ---------------------------------------------------------------------------

/**
 * Fields for the single `console.info` line. NEVER contains content: no question,
 * no record, no reply text, no ids. Only an outcome label, the HTTP status,
 * elapsed ms, token counts, the model, and — on a fallback — the guard reasons
 * (which are enum strings like "number"/"uncited", not content).
 */
interface LogLine {
  route: "assistant";
  outcome: AssistantResponse["status"] | "error";
  code?: string;
  http: number;
  ms: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
  guardReasons?: string[];
}

/** Emit the one structured log line for this request. */
function logOnce(line: LogLine): void {
  // Single call → exactly one line per request (Requirement 9.1).
  console.info(JSON.stringify(line));
}

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

/**
 * Handle one assistant request end to end. Never throws: every failure path
 * returns a typed error `Response` with a fixed, content-free `message`
 * (Requirement 9 / design.md "Error Handling" — no stack traces, SDK messages or
 * input text are ever echoed, since any of those could leak record contents).
 */
export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  // Capture the client IP immediately from the proxy header (first address is the
  // originating client; see rateLimitKey). Used for the rate-limit key once we
  // also know the sessionId from the parsed body.
  const forwardedFor = req.headers.get("x-forwarded-for");

  const elapsed = () => Date.now() - startedAt;

  // --- Step 1: parse (size + shape) -----------------------------------------
  // Enforces the 1 MB cap and the Zod schema BEFORE any work. Maps to:
  //   too_large   → 413   (error table: "Body > 1 MB")
  //   bad_request → 400   (error table: "Invalid input")
  const parsed = await parseRequest(req);
  if (!parsed.ok) {
    const http = parsed.code === "too_large" ? 413 : 400;
    logOnce({
      route: "assistant",
      outcome: "error",
      code: parsed.code,
      http,
      ms: elapsed(),
      model: DEFAULT_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    });
    return errorResponse(http, parsed.code, parsed.message);
  }
  const body = parsed.body;

  // --- Step 2: rate limit (our limiter) -------------------------------------
  // Key = first x-forwarded-for address + sessionId (design.md "Rate limit").
  // A blocked request is NOT recorded (see rateLimit), so a throttled client
  // cannot starve itself. Maps to: rate_limited → 429 ("Rate limit (ours …)").
  const key = rateLimitKey(forwardedFor, body.sessionId);
  const limit = rateLimit(key);
  if (!limit.allowed) {
    logOnce({
      route: "assistant",
      outcome: "error",
      code: "rate_limited",
      http: 429,
      ms: elapsed(),
      model: DEFAULT_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    });
    return errorResponse(429, "rate_limited", "Too many requests. Please retry shortly.");
  }

  // --- Step 3: API key check (before any model work) ------------------------
  // No key configured → 503 not_configured. Done AFTER parse so a malformed or
  // oversized request still gets its precise 400/413, and after rate limiting so
  // a misconfigured server cannot be used to bypass the limiter.
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logOnce({
      route: "assistant",
      outcome: "error",
      code: "not_configured",
      http: 503,
      ms: elapsed(),
      model: DEFAULT_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    });
    return errorResponse(503, "not_configured", errorMessageFor("not_configured"));
  }

  // --- Step 4: normalize ----------------------------------------------------
  // `normalizeRecord` validates and unit-normalizes the record. Per design.md,
  // normalize ISSUES do not block the chat (the engine reports what is missing),
  // but a HARD failure ({ ok: false }) means we cannot build the NormalizedPatient
  // that `guard`/`allowedNumbers` need, so it is treated as bad input → 400.
  // (In practice parseRequest already ran the record through PatientRecordSchema,
  // so a hard failure here is unlikely; this keeps the route total and safe.)
  const normalized = normalizeRecord(body.record);
  if (!normalized.ok) {
    logOnce({
      route: "assistant",
      outcome: "error",
      code: "bad_request",
      http: 400,
      ms: elapsed(),
      model: DEFAULT_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    });
    return errorResponse(400, "bad_request", "The record could not be processed.");
  }
  const patient = normalized.patient;

  // --- Step 5: assess -------------------------------------------------------
  // The engine is deterministic and offline. Its signature takes a
  // `PatientRecord` (`Assess` in src/domain/diagnosis/types.ts), so we pass
  // `patient.record` — the schema-validated record carried on the normalized
  // patient.
  const assessment = assess(patient.record);

  // --- Step 6: ids + refs ---------------------------------------------------
  const ided = withIds(assessment);
  const refs = refsFor(ided);

  // --- Step 7: runChat (45 s) -----------------------------------------------
  // Build the real client via the seam (only now that we have a key), run the
  // tool loop (`tool_choice: auto` on every call), and bound the whole loop with a 45 s abort signal. The
  // history is forwarded as-is: it already holds only user turns and the
  // assistant's already-guarded texts from the client (design.md "Request").
  const client = clientFactory(apiKey);
  const maxTokens = DEFAULT_MAX_TOKENS;

  let chatResult: Awaited<ReturnType<typeof runChat>>;
  try {
    chatResult = await runChat(
      {
        client,
        model: DEFAULT_MODEL,
        maxTokens,
        // AbortSignal.timeout fires a "TimeoutError" at 45 s; runChat passes it to
        // every SDK call so the whole loop cancels at once.
        signal: AbortSignal.timeout(RUN_CHAT_TIMEOUT_MS),
      },
      body.question,
      body.history,
      assessmentForModel(ided),
    );
  } catch (error) {
    // Error mapping table (design.md "Data Models"). Order matters: check the
    // most specific causes first.
    //
    //   timeout       → 504   the 45 s AbortSignal fired, or the SDK surfaced the
    //                         abort (TimeoutError / AbortError / APIUserAbortError).
    //   rate_limited  → 429   the SDK returned HTTP 429 (RateLimitError) — the
    //                         API's own limit, mapped to the same code as ours.
    //   model_error   → 502   ModelError (incl. max_tokens on the final call) and
    //                         ANY other SDK / API error. Nothing from the error is
    //                         echoed; a fixed message is returned.
    const { httpStatus, code } = mapChatError(error);
    logOnce({
      route: "assistant",
      outcome: "error",
      code,
      http: httpStatus,
      ms: elapsed(),
      model: DEFAULT_MODEL,
      inputTokens: 0,
      outputTokens: 0,
      calls: 0,
    });
    return errorResponse(httpStatus, code, errorMessageFor(code));
  }

  // --- Step 8: first-call rule, then guard → ok | fallback ------------------
  // If the first response skipped `get_assessment` (assessmentCalled: false),
  // runChat already stopped without a further call; the reply was written
  // without the engine's facts, so it is never shown → status "fallback" with
  // log reason "no_tool" (Requirement 3.3; error table row "First response
  // without get_assessment").
  // Otherwise the guard checks numbers, citations and unknown ids against the
  // Assessment and the normalized patient. Pass → status "ok" with the model's
  // text. Fail → status "fallback" (HTTP 200). Every fallback carries the
  // deterministic, guard-safe fallbackText.
  let reasons: string[] = ["no_tool"];
  if (chatResult.assessmentCalled) {
    const verdict = guard(chatResult.text, ided, patient);
    reasons = verdict.ok ? [] : verdict.reasons;
  }
  const status: "ok" | "fallback" = reasons.length === 0 ? "ok" : "fallback";
  const text = status === "ok" ? chatResult.text : fallbackText(ided);

  const inputTokens = sumUsage(chatResult.usage, "input");
  const outputTokens = sumUsage(chatResult.usage, "output");

  logOnce({
    route: "assistant",
    outcome: status,
    http: 200,
    ms: elapsed(),
    model: DEFAULT_MODEL,
    inputTokens,
    outputTokens,
    calls: chatResult.calls,
    // Reasons are enum strings ("no_tool", "number", "uncited", …), never content.
    ...(status === "fallback" ? { guardReasons: reasons } : {}),
  });

  return json(200, {
    status,
    text,
    assessment: ided,
    refs,
    disclaimer: ided.disclaimer,
  });
}

// ---------------------------------------------------------------------------
// runChat error → (HTTP status, code) mapping
// ---------------------------------------------------------------------------

/**
 * Classify an error thrown by `runChat` into an HTTP status and response `code`,
 * following the error table. Never inspects or returns the error's message.
 */
function mapChatError(error: unknown): {
  httpStatus: number;
  code: Extract<AssistantResponse, { status: "error" }>["code"];
} {
  // Timeout / abort → 504. `AbortSignal.timeout` rejects with a DOMException named
  // "TimeoutError"; a manual abort would be "AbortError"; the SDK wraps a user
  // abort as `APIUserAbortError`. Any of these means the 45 s budget was hit.
  if (error instanceof APIUserAbortError) {
    return { httpStatus: 504, code: "timeout" };
  }
  if (
    error instanceof DOMException &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return { httpStatus: 504, code: "timeout" };
  }
  if (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return { httpStatus: 504, code: "timeout" };
  }

  // API 429 → 429 rate_limited (error table: "Rate limit (ours or API 429)").
  if (error instanceof RateLimitError) {
    return { httpStatus: 429, code: "rate_limited" };
  }

  // ModelError (includes a max_tokens stop on the final call) and every other
  // SDK/API error → 502 model_error. We deliberately do NOT branch on other SDK
  // error subclasses: they are all surfaced as a generic model failure so no
  // upstream detail leaks.
  if (error instanceof ModelError) {
    return { httpStatus: 502, code: "model_error" };
  }
  return { httpStatus: 502, code: "model_error" };
}

/** Fixed, content-free client message for each error code (never echoes input). */
function errorMessageFor(
  code: Extract<AssistantResponse, { status: "error" }>["code"],
): string {
  switch (code) {
    case "timeout":
      return "The assistant took too long to respond. Please try again.";
    case "rate_limited":
      return "Too many requests. Please retry shortly.";
    case "model_error":
      return "The assistant could not produce an answer. Please try again.";
    case "not_configured":
      return "Assistant is not configured";
    case "too_large":
      return "Request body too large";
    case "bad_request":
      return "Invalid request.";
  }
}

/**
 * Sum one side of the token usage across every `messages.create` call. The SDK's
 * `Usage` carries `input_tokens` / `output_tokens`; we sum defensively (treating
 * a missing count as 0) so the log line is always a finite number.
 */
function sumUsage(
  usage: Anthropic.Messages.Usage[],
  side: "input" | "output",
): number {
  return usage.reduce((total, u) => {
    const value = side === "input" ? u.input_tokens : u.output_tokens;
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}
