// Request schema and parsing for POST /api/assistant (Requirements 2.2, 2.3, 2.4).
//
// This module is the single validated entry point for the assistant route. It
// rejects oversized and malformed bodies *before* any model call:
//   - body > 1 MB → `too_large` (the route maps this to HTTP 413)
//   - invalid JSON or schema failure → `bad_request` (HTTP 400)
//   - otherwise → the parsed, typed body
//
// Privacy note (design.md "Error Handling" / Requirement 9): error messages never
// echo the request body or any record contents. Zod's default error message can
// include the offending input value, so on a schema failure we summarize only the
// first issue's path and message — never the value — to avoid leaking record text.
import { z } from "zod";
import { PatientRecordSchema } from "@/domain/schema/record";

/** Hard cap on the request body: 1 MB = 1,048,576 bytes (Requirement 2.3). */
export const MAX_BODY_BYTES = 1_048_576;

/**
 * One prior turn of the conversation. Only `user` turns and the assistant's
 * already-guarded replies are ever sent back to the model, so the 4,000-character
 * cap (Requirement 2.2) is an upper bound on any single turn's text.
 */
const ChatTurn = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().max(4000),
});

/** Inferred type for a single chat turn; imported by `chat.ts`. */
export type ChatTurn = z.infer<typeof ChatTurn>;

/**
 * The validated request body (Requirement 2.2):
 *   - `question`  non-empty after trimming, at most 2,000 characters
 *   - `history`   at most 10 prior turns, defaulting to an empty array
 *   - `record`    validated and normalized by the app's `PatientRecordSchema`
 *   - `sessionId` optional, used (with the client IP) as the rate-limit key
 */
export const AssistantRequest = z.object({
  question: z.string().trim().min(1).max(2000),
  history: z.array(ChatTurn).max(10).default([]),
  record: PatientRecordSchema,
  sessionId: z.string().max(64).optional(),
});

/** Inferred type of the parsed request body. */
export type AssistantRequestBody = z.infer<typeof AssistantRequest>;

/**
 * Discriminated result the route turns into an HTTP response:
 *   - `{ ok: true, body }`                       → 200 pipeline continues
 *   - `{ ok: false, code: "too_large", … }`      → 413
 *   - `{ ok: false, code: "bad_request", … }`    → 400
 * The `message` is a short, content-free reason safe to return to the client.
 */
export type ParseResult =
  | { ok: true; body: AssistantRequestBody }
  | { ok: false; code: "too_large" | "bad_request"; message: string };

/**
 * Summarize a Zod error into a short, content-free reason. We report only the
 * first issue's path and message, never the offending value, so record contents
 * are not echoed back to the client (Requirement 9 / design.md "Error Handling").
 */
function summarizeIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request body";
  const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  return `Invalid request body: ${path} — ${issue.message}`;
}

/**
 * Parse and validate an incoming request.
 *
 * Size is checked twice. First the `content-length` header (when present) lets us
 * reject an oversized body early, before reading it. Because that header can be
 * absent or lie, we also measure the real UTF-8 byte length of the body we read.
 * Only then do we attempt `JSON.parse`, and finally `AssistantRequest.safeParse`.
 *
 * Never throws: every failure path returns a typed `ParseResult`.
 */
export async function parseRequest(req: Request): Promise<ParseResult> {
  // 1. Early size check from the declared content-length, if any.
  const declaredLength = req.headers.get("content-length");
  if (declaredLength !== null) {
    const declared = Number(declaredLength);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return { ok: false, code: "too_large", message: "Request body too large" };
    }
  }

  // 2. Read the raw body. A failure here (e.g. a broken stream) is treated as a
  //    bad request rather than surfacing an internal error.
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, code: "bad_request", message: "Could not read request body" };
  }

  // 3. Real byte-length check: catches a missing or dishonest content-length.
  //    `Buffer.byteLength` measures UTF-8 bytes (the route runs on Node.js).
  const actualBytes = Buffer.byteLength(text, "utf8");
  if (actualBytes > MAX_BODY_BYTES) {
    return { ok: false, code: "too_large", message: "Request body too large" };
  }

  // 4. Parse JSON. Malformed JSON is a bad request; the parser's message may
  //    quote the input, so we return a fixed reason instead.
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, code: "bad_request", message: "Invalid JSON" };
  }

  // 5. Validate against the schema. On failure, return a summarized reason that
  //    never includes the offending value (see `summarizeIssue`).
  const result = AssistantRequest.safeParse(json);
  if (!result.success) {
    return { ok: false, code: "bad_request", message: summarizeIssue(result.error) };
  }

  return { ok: true, body: result.data };
}
