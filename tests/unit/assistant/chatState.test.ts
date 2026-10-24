import { describe, expect, it } from "vitest";
import {
  MAX_HISTORY_TURNS,
  MAX_QUESTION_CHARS,
  MAX_TURN_CHARS,
  buildHistory,
  chatReducer,
  initialChatState,
  pendingTurn,
  prepareQuestion,
  toOutcome,
  type AssistantReply,
  type ChatState,
} from "@/components/assistant/chatState";

const reply = (text: string, status: "ok" | "fallback" = "ok"): AssistantReply => ({
  status,
  text,
  assessment: { findings: [], differential: [], missing: [], redFlags: [], disclaimer: "Not a diagnosis." },
  refs: {},
  disclaimer: "Not a diagnosis.",
});

const sent = (id: string, question: string, s: ChatState = initialChatState) =>
  chatReducer(s, { type: "send", turnId: id, question });

describe("chatReducer", () => {
  it("adds a pending turn and resolves it", () => {
    let s = sent("t1", "What grade is the AS?");
    expect(pendingTurn(s)?.id).toBe("t1");
    s = chatReducer(s, { type: "resolve", turnId: "t1", outcome: reply("Severe [F1].") });
    expect(pendingTurn(s)).toBeUndefined();
    expect(s.turns[0].outcome).toMatchObject({ status: "ok", text: "Severe [F1]." });
  });

  it("allows only one pending turn", () => {
    const s = sent("t1", "a");
    expect(sent("t2", "b", s)).toBe(s);
  });

  it("ignores a late reply after cancel", () => {
    let s = chatReducer(sent("t1", "a"), { type: "cancel", turnId: "t1" });
    expect(s.turns[0].outcome.status).toBe("cancelled");
    s = chatReducer(s, { type: "resolve", turnId: "t1", outcome: reply("late") });
    expect(s.turns[0].outcome.status).toBe("cancelled");
  });

  it("ignores a stale reply after reset (record changed)", () => {
    let s = chatReducer(sent("t1", "a"), { type: "reset" });
    expect(s.turns).toEqual([]);
    s = chatReducer(s, { type: "resolve", turnId: "t1", outcome: reply("stale") });
    expect(s.turns).toEqual([]);
  });

  it("discards only failed or cancelled turns", () => {
    let s = chatReducer(sent("t1", "a"), { type: "resolve", turnId: "t1", outcome: reply("ok [F1].") });
    expect(chatReducer(s, { type: "discard", turnId: "t1" })).toBe(s);
    s = chatReducer(sent("t2", "b", s), {
      type: "resolve",
      turnId: "t2",
      outcome: { status: "error", code: "timeout", message: "x" },
    });
    expect(chatReducer(s, { type: "discard", turnId: "t2" }).turns.map((t) => t.id)).toEqual(["t1"]);
  });
});

describe("buildHistory", () => {
  it("keeps only completed exchanges, alternating user/assistant", () => {
    let s = chatReducer(sent("t1", "q1"), { type: "resolve", turnId: "t1", outcome: reply("a1 [F1].") });
    s = chatReducer(sent("t2", "q2", s), { type: "resolve", turnId: "t2", outcome: { status: "error", code: "model_error", message: "x" } });
    s = chatReducer(sent("t3", "q3", s), { type: "cancel", turnId: "t3" });
    s = chatReducer(sent("t4", "q4", s), { type: "resolve", turnId: "t4", outcome: reply("F1 list", "fallback") });
    s = sent("t5", "q5", s);
    expect(buildHistory(s.turns)).toEqual([
      { role: "user", text: "q1" },
      { role: "assistant", text: "a1 [F1]." },
      { role: "user", text: "q4" },
      { role: "assistant", text: "F1 list" },
    ]);
  });

  it("keeps the most recent turns within the route's caps", () => {
    let s = initialChatState;
    for (let i = 0; i < 8; i++) {
      s = chatReducer(sent(`t${i}`, `q${i}`, s), { type: "resolve", turnId: `t${i}`, outcome: reply("x".repeat(MAX_TURN_CHARS + 50)) });
    }
    const h = buildHistory(s.turns);
    expect(h).toHaveLength(MAX_HISTORY_TURNS);
    expect(h[0]).toEqual({ role: "user", text: "q3" });
    expect(h.every((t) => t.text.length <= MAX_TURN_CHARS)).toBe(true);
  });
});

describe("prepareQuestion", () => {
  it("trims and rejects empty or oversized questions", () => {
    expect(prepareQuestion("  hi  ")).toBe("hi");
    expect(prepareQuestion("   ")).toBeNull();
    expect(prepareQuestion("a".repeat(MAX_QUESTION_CHARS))).not.toBeNull();
    expect(prepareQuestion("a".repeat(MAX_QUESTION_CHARS + 1))).toBeNull();
  });
});

describe("toOutcome", () => {
  it("passes through ok, fallback and error bodies", () => {
    expect(toOutcome(200, reply("t [F1]."))).toMatchObject({ status: "ok", text: "t [F1]." });
    expect(toOutcome(200, reply("list", "fallback")).status).toBe("fallback");
    expect(toOutcome(503, { status: "error", code: "not_configured", message: "Assistant is not configured" })).toEqual({
      status: "error",
      code: "not_configured",
      message: "Assistant is not configured",
    });
  });

  it("maps non-route bodies by HTTP status without echoing them", () => {
    expect(toOutcome(504, undefined)).toMatchObject({ status: "error", code: "timeout" });
    expect(toOutcome(429, "<html>")).toMatchObject({ status: "error", code: "rate_limited" });
    const e = toOutcome(500, { status: "ok", text: 1 });
    expect(e).toMatchObject({ status: "error", code: "network" });
  });
});
