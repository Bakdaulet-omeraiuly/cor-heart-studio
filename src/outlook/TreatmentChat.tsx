"use client";
// Ask Claude which treatment options to consider; each proposal becomes a button that toggles the model.
// The server only ever returns ids from the evidence file. No API key on the server: the chat says so and the buttons still work.
import { useId, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button, InfoTip } from "@/components/ui/primitives";
import { EVIDENCE } from "@/domain/treatments/load";
import type { Proposal } from "@/domain/treatments/propose";
import type { ConditionId } from "@/domain/treatments/types";
import type { PatientRecord } from "@/domain/schema/record";
import { useOutlook } from "./outlookStore";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "unavailable" } | { kind: "error"; code: string } | { kind: "done"; proposals: Proposal[]; note: string };

const ERROR_TEXT: Record<string, string> = {
  rate_limited: "Too many questions; try again in a minute.",
  timeout: "The assistant took too long; try again.",
  too_large: "The record is too large to send.",
};

export function TreatmentChat({ condition, record }: { condition: ConditionId; record?: PatientRecord }) {
  const active = useOutlook((s) => s.active);
  const toggle = useOutlook((s) => s.toggle);
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const sessionId = useId();

  const ask = async () => {
    const q = question.trim();
    if (!q) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/treatments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ condition, question: q, record, sessionId }),
      });
      const body = await res.json();
      if (body.ok) setState({ kind: "done", proposals: body.proposals, note: body.note });
      else setState(body.code === "not_configured" ? { kind: "unavailable" } : { kind: "error", code: String(body.code) });
    } catch {
      setState({ kind: "error", code: "network" });
    }
  };

  if (state.kind === "unavailable") return <p className="text-[11px] text-faint" data-testid="treatment-chat-unavailable">Chat unavailable on this server. The buttons below still work.</p>;
  return (
    <div className="space-y-2" data-testid="treatment-chat">
      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} placeholder="Ask what to consider…" aria-label="Ask the assistant which treatments to consider"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 text-[12px] outline-none focus:border-accent" />
        <Button size="sm" type="submit" disabled={state.kind === "loading" || !question.trim()}>
          {state.kind === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Ask
        </Button>
        <InfoTip label="About the assistant" side="bottom" align="right">Claude proposes options from the list of buttons only. It is decision support, not a diagnosis; the numbers come from the cited studies, never from the assistant.</InfoTip>
      </form>
      {state.kind === "error" && <p className="text-[11px] text-error" role="alert">{ERROR_TEXT[state.code] ?? "The assistant could not answer."}</p>}
      {state.kind === "done" && (
        <div className="space-y-1" data-testid="treatment-proposals">
          {state.proposals.length === 0 && <p className="text-[11px] text-muted">No option from the list fits this question.</p>}
          {state.proposals.map((p) => {
            const entry = EVIDENCE.entries.find((e) => e.id === p.id);
            if (!entry) return null;
            return (
              <div key={p.id} className="flex items-center gap-1.5">
                <Button size="sm" pressed={active.includes(p.id)} data-testid={`proposal-${p.id}`} onClick={() => toggle(p.id)}>{entry.label}</Button>
                <span className="min-w-0 truncate text-[11px] text-muted" title={p.reason}>{p.reason}</span>
              </div>
            );
          })}
          <p className="text-[10px] text-faint">{state.note}</p>
        </div>
      )}
    </div>
  );
}
