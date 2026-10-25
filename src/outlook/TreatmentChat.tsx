"use client";
// Ask Claude which treatment options to consider; each proposal becomes a button that toggles the model.
// The server only ever returns ids from the evidence file. No API key on the server: the chat says so and the buttons still work.
import { useId, useState } from "react";
import { BookOpen, Loader2, Sparkles } from "lucide-react";
import { Button, InfoTip } from "@/components/ui/primitives";
import { EVIDENCE } from "@/domain/treatments/load";
import type { CitedSource } from "@/domain/treatments/explain";
import type { Proposal } from "@/domain/treatments/propose";
import type { ConditionId } from "@/domain/treatments/types";
import type { PatientRecord } from "@/domain/schema/record";
import { useOutlook } from "./outlookStore";

type State = { kind: "idle" } | { kind: "loading" } | { kind: "unavailable" } | { kind: "error"; code: string } | { kind: "done"; proposals: Proposal[]; note: string }
  | { kind: "explained"; answer: string; sources: CitedSource[]; note: string };

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

  const ask = async (mode: "propose" | "explain" = "propose") => {
    const q = question.trim();
    if (!q) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch(mode === "explain" ? "/api/treatments/explain" : "/api/treatments", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "explain" ? { condition, question: q, sessionId } : { condition, question: q, record, sessionId }),
      });
      const body = await res.json();
      if (body.ok && mode === "explain") setState({ kind: "explained", answer: body.answer, sources: body.sources, note: body.note });
      else if (body.ok) setState({ kind: "done", proposals: body.proposals, note: body.note });
      else setState(body.code === "not_configured" ? { kind: "unavailable" } : { kind: "error", code: String(body.code) });
    } catch {
      setState({ kind: "error", code: "network" });
    }
  };

  if (state.kind === "unavailable") return <p className="text-[11px] text-faint" data-testid="treatment-chat-unavailable">Chat unavailable on this server. The buttons below still work.</p>;
  return (
    <div className="space-y-2" data-testid="treatment-chat">
      <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} placeholder="Ask what to consider, or explain the disease…" aria-label="Ask the assistant which treatments to consider"
          className="h-8 min-w-0 flex-1 rounded-md border border-line bg-panel-2 px-2 text-[12px] outline-none focus:border-accent" />
        <Button size="sm" type="submit" disabled={state.kind === "loading" || !question.trim()}>
          {state.kind === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Ask
        </Button>
        <Button size="sm" type="button" disabled={state.kind === "loading" || !question.trim()} onClick={() => void ask("explain")}>
          <BookOpen className="h-3.5 w-3.5" /> Explain
        </Button>
        <InfoTip label="About the assistant" side="bottom" align="right">Ask proposes options from the list of buttons only. Explain answers from the cited studies only and links each one. It is decision support, not a diagnosis; the numbers come from the cited studies, never from the assistant.</InfoTip>
      </form>
      {state.kind === "error" && <p className="text-[11px] text-error" role="alert">{ERROR_TEXT[state.code] ?? "The assistant could not answer."}</p>}
      {state.kind === "explained" && (
        <div className="space-y-1" data-testid="treatment-explanation">
          <p className="text-[12px] leading-snug text-ink">{state.answer}</p>
          <ol className="space-y-0.5 text-[10px] text-muted">
            {state.sources.map((src, i) => (
              <li key={src.id}>[{i + 1}] <a className="underline" href={`https://doi.org/${src.doi}`} target="_blank" rel="noreferrer">{src.cite}</a> · {src.studyType} · {src.journal}</li>
            ))}
          </ol>
          <p className="text-[10px] text-faint">{state.note}</p>
        </div>
      )}
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
