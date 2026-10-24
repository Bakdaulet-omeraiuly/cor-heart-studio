"use client";
// Chat state and transport for the assistant panel (Requirements 1.3, 1.4, 1.5, 1.6).
//
// - State lives in `useReducer` inside the component that calls this hook: not the global store, not
//   storage, URLs, cookies, analytics or the console. Closing the tab forgets it.
// - The chat resets whenever the selected record changes or is removed (a different key, or the same key
//   with an edited record), and any request in flight is aborted.
// - One request at a time; `cancel()` aborts it. Late replies for cancelled or reset turns are ignored by
//   the reducer (turn ids are unique for the lifetime of the hook).
import { useEffect, useReducer, useRef, useState } from "react";
import { useApp } from "@/state/store";
import {
  buildHistory,
  chatReducer,
  initialChatState,
  networkError,
  pendingTurn,
  prepareQuestion,
  toOutcome,
  type ChatTurnView,
} from "./chatState";

export type { ChatTurnView, TurnOutcome, AssistantReply, AssistantError, AssistantErrorCode } from "./chatState";
export { MAX_QUESTION_CHARS } from "./chatState";

export interface UseAssistant {
  /** Questions and their outcomes, oldest first. */
  turns: ChatTurnView[];
  /** A record is selected, so questions can be asked (Requirement 1.2 disables the input otherwise). */
  hasRecord: boolean;
  /** A reply is pending (Requirement 1.4: show progress, offer Cancel). */
  pending: boolean;
  /** Send a question about the selected record. Returns false if it was not sent (no record, pending, empty or too long). */
  send: (question: string) => boolean;
  /** Abort the pending request, if any. */
  cancel: () => void;
  /** Re-send the question of a failed or cancelled turn, replacing that turn. */
  retry: (turnId: string) => boolean;
}

/** Random per-panel session id for the server's rate-limit key; memory only, ≤ 64 chars. */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function useAssistant(selectedKey: string | null): UseAssistant {
  const patient = useApp((s) => (selectedKey ? s.entries[selectedKey]?.patient : undefined));
  const [state, dispatch] = useReducer(chatReducer, initialChatState);

  // Reset when the record changes: adjust state during render (React's pattern for "reset on prop change"),
  // so the old chat is never painted for the new record.
  const [seen, setSeen] = useState({ key: selectedKey, patient });
  if (seen.key !== selectedKey || seen.patient !== patient) {
    setSeen({ key: selectedKey, patient });
    dispatch({ type: "reset" });
  }

  const controllerRef = useRef<AbortController | null>(null);
  const sessionRef = useRef<string | null>(null);
  const nextIdRef = useRef(1);

  // Abort the request in flight when the record changes and on unmount.
  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
  }, [selectedKey, patient]);

  const pending = pendingTurn(state) !== undefined;

  function sendFrom(turns: readonly ChatTurnView[], raw: string): boolean {
    const question = prepareQuestion(raw);
    if (!question || !patient || controllerRef.current) return false;

    const turnId = `t${nextIdRef.current++}`;
    sessionRef.current ??= newSessionId();
    const controller = new AbortController();
    controllerRef.current = controller;
    const body = JSON.stringify({
      question,
      history: buildHistory(turns),
      record: patient.record,
      sessionId: sessionRef.current,
    });
    dispatch({ type: "send", turnId, question });

    void (async () => {
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          signal: controller.signal,
          cache: "no-store",
        });
        let json: unknown;
        try {
          json = await res.json();
        } catch {
          json = undefined;
        }
        if (!controller.signal.aborted) dispatch({ type: "resolve", turnId, outcome: toOutcome(res.status, json) });
      } catch {
        // Aborted (cancel / record change / unmount): the turn is already cancelled or gone. Otherwise a network failure.
        if (!controller.signal.aborted) dispatch({ type: "resolve", turnId, outcome: networkError });
      } finally {
        if (controllerRef.current === controller) controllerRef.current = null;
      }
    })();
    return true;
  }

  function send(raw: string): boolean {
    if (pending) return false;
    return sendFrom(state.turns, raw);
  }

  function cancel(): void {
    const turn = pendingTurn(state);
    controllerRef.current?.abort();
    controllerRef.current = null;
    if (turn) dispatch({ type: "cancel", turnId: turn.id });
  }

  function retry(turnId: string): boolean {
    if (pending) return false;
    const turn = state.turns.find((t) => t.id === turnId);
    if (!turn || (turn.outcome.status !== "error" && turn.outcome.status !== "cancelled")) return false;
    const rest = state.turns.filter((t) => t.id !== turnId);
    if (!sendFrom(rest, turn.question)) return false;
    dispatch({ type: "discard", turnId });
    return true;
  }

  return { turns: state.turns, hasRecord: patient !== undefined, pending, send, cancel, retry };
}
