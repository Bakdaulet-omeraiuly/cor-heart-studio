// Pure chat state for the assistant panel (Requirements 1.3, 1.4, 1.5, 1.6).
//
// No React, no store, no I/O: `useAssistant` wraps this reducer in `useReducer`, so the chat lives only in
// component memory for the current tab and is never written to URLs, storage, cookies, analytics or the
// console. Kept separate from the hook so it can be unit-tested in the node Vitest environment.
//
// Response types are imported from the server route as TYPES ONLY (erased at compile time), so no server
// code reaches the client bundle.
import type { AssistantResponse } from "@/app/api/assistant/route";
import type { IdedAssessment, Ref } from "@/app/api/assistant/ids";

/** Request caps mirrored from `src/app/api/assistant/request.ts` (Requirement 2.2). */
export const MAX_QUESTION_CHARS = 2000;
export const MAX_HISTORY_TURNS = 10;
export const MAX_TURN_CHARS = 4000;

/** A successful (or guard-withheld) answer exactly as the route returned it. */
export interface AssistantReply {
  status: "ok" | "fallback";
  text: string;
  assessment: IdedAssessment;
  refs: Record<string, Ref>;
  disclaimer: string;
}

/** Server error codes plus `network` for a failed fetch or a non-JSON reply (e.g. a platform 504 page). */
export type AssistantErrorCode = Extract<AssistantResponse, { status: "error" }>["code"] | "network";

export interface AssistantError {
  status: "error";
  code: AssistantErrorCode;
  message: string;
}

/** What happened to one question. `cancelled` = the clinician pressed Cancel while it was pending. */
export type TurnOutcome =
  | { status: "pending" }
  | { status: "cancelled" }
  | AssistantReply
  | AssistantError;

/** One question and its outcome. The panel renders turns in order. */
export interface ChatTurnView {
  id: string;
  question: string;
  outcome: TurnOutcome;
}

export interface ChatState {
  turns: ChatTurnView[];
}

export type ChatAction =
  | { type: "send"; turnId: string; question: string }
  | { type: "resolve"; turnId: string; outcome: AssistantReply | AssistantError }
  | { type: "cancel"; turnId: string }
  /** Drop a failed or cancelled turn so its question can be sent again (Retry). */
  | { type: "discard"; turnId: string }
  | { type: "reset" };

export const initialChatState: ChatState = { turns: [] };

/** The turn currently waiting for a reply, if any (at most one at a time). */
export function pendingTurn(state: ChatState): ChatTurnView | undefined {
  return state.turns.find((t) => t.outcome.status === "pending");
}

/**
 * Pure reducer. Actions for a turn id that is not (or no longer) pending are ignored, so a late reply for a
 * cancelled request, or for a chat that was reset because the record changed, can never write stale results.
 */
export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      // One request at a time; the hook also guards this.
      if (pendingTurn(state)) return state;
      return { turns: [...state.turns, { id: action.turnId, question: action.question, outcome: { status: "pending" } }] };
    case "resolve":
    case "cancel": {
      const i = state.turns.findIndex((t) => t.id === action.turnId && t.outcome.status === "pending");
      if (i < 0) return state;
      const outcome: TurnOutcome = action.type === "resolve" ? action.outcome : { status: "cancelled" };
      const turns = state.turns.slice();
      turns[i] = { ...turns[i], outcome };
      return { turns };
    }
    case "discard": {
      const turns = state.turns.filter(
        (t) => !(t.id === action.turnId && (t.outcome.status === "error" || t.outcome.status === "cancelled")),
      );
      return turns.length === state.turns.length ? state : { turns };
    }
    case "reset":
      return state.turns.length === 0 ? state : initialChatState;
  }
}

/**
 * History sent with the next question: only completed exchanges, i.e. the clinician's question followed by
 * the server's already-guarded text (`ok`) or the engine-only fallback (`fallback`). Errors, cancelled and
 * pending turns are skipped, so roles always alternate user → assistant. Keeps the most recent
 * MAX_HISTORY_TURNS entries and caps each text at MAX_TURN_CHARS so the request always passes the route's
 * schema (Requirement 2.2).
 */
export function buildHistory(turns: readonly ChatTurnView[]): { role: "user" | "assistant"; text: string }[] {
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const t of turns) {
    if (t.outcome.status !== "ok" && t.outcome.status !== "fallback") continue;
    out.push({ role: "user", text: t.question.slice(0, MAX_TURN_CHARS) });
    out.push({ role: "assistant", text: t.outcome.text.slice(0, MAX_TURN_CHARS) });
  }
  // MAX_HISTORY_TURNS is even, so the kept window still starts with a user turn.
  return out.slice(-MAX_HISTORY_TURNS);
}

/** Trimmed question if it can be sent, otherwise null (empty or longer than the route accepts). */
export function prepareQuestion(raw: string): string | null {
  const q = raw.trim();
  return q.length > 0 && q.length <= MAX_QUESTION_CHARS ? q : null;
}

const NETWORK_MESSAGE = "Could not reach the assistant. Check the connection and retry.";

/**
 * Turn an HTTP status and an already-parsed JSON body (or `undefined` when the body was not JSON) into a
 * turn outcome. Anything that is not a well-formed route response becomes an error; nothing from an
 * unexpected body is echoed to the panel.
 */
export function toOutcome(httpStatus: number, body: unknown): AssistantReply | AssistantError {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (
      (b.status === "ok" || b.status === "fallback") &&
      typeof b.text === "string" &&
      typeof b.disclaimer === "string" &&
      b.assessment && typeof b.assessment === "object" &&
      b.refs && typeof b.refs === "object"
    ) {
      return {
        status: b.status,
        text: b.text,
        assessment: b.assessment as IdedAssessment,
        refs: b.refs as Record<string, Ref>,
        disclaimer: b.disclaimer,
      };
    }
    if (b.status === "error" && typeof b.code === "string" && typeof b.message === "string") {
      return { status: "error", code: b.code as AssistantErrorCode, message: b.message };
    }
  }
  // Not a route response (e.g. a platform timeout page): classify by HTTP status only.
  if (httpStatus === 504) return { status: "error", code: "timeout", message: "The assistant took too long to respond. Please try again." };
  if (httpStatus === 429) return { status: "error", code: "rate_limited", message: "Too many requests. Please retry shortly." };
  return { status: "error", code: "network", message: NETWORK_MESSAGE };
}

export const networkError: AssistantError = { status: "error", code: "network", message: NETWORK_MESSAGE };
