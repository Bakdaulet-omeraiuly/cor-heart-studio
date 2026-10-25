"use client";
// Assistant chat panel, docked at the bottom of the inspector column (Requirements 1.1, 1.2, 7.2, 10.1–10.7).
//
// Takes no props so the inspector column mounts it as a single `<AssistantPanel />`: the selected record key
// comes from the app store, the chat state from `useAssistant` (memory only, reset on record change).
// Layout follows docs/design-system.md: 36 px header with a micro label and controls on the right, details
// behind ⓘ, the disclaimer always on screen, numbers in tabular mono digits.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, ChevronUp, Loader2, RotateCcw, Send, Square } from "lucide-react";
import type { Ref } from "@/app/api/assistant/ids";
import { EVIDENCE } from "@/domain/treatments/load";
import type { ConditionId } from "@/domain/treatments/types";
import { useOutlook } from "@/outlook/outlookStore";
import { useApp } from "@/state/store";
import { Button, IconButton, InfoTip } from "../ui/primitives";
import { focusTarget } from "./focusTarget";
import { ReplyText } from "./ReplyText";
import { MAX_QUESTION_CHARS, useAssistant, type ChatTurnView, type OutlookReply } from "./useAssistant";

export const ASSISTANT_DISCLAIMER = "Not a diagnosis — decision support for clinicians";

export interface AssistantPanelProps {
  /**
   * Called when the clinician activates a cited id, after the ref is highlighted in the panel. Defaults to
   * `focusTarget`, which moves the 3D view to the ref's target or does nothing when there is none.
   */
  onActivateRef?: (ref: Ref) => void;
}

/** The condition the open Outlook shows, or null (Outlook closed, or a brain scenario with no treatment buttons). */
function useOutlookCondition(): ConditionId | null {
  const organ = useApp((s) => s.module);
  const open = useOutlook((s) => s.open);
  const heart = useOutlook((s) => s.heartScenario);
  const brain = useOutlook((s) => s.brainScenario);
  if (!open) return null;
  if (organ === "heart") return heart;
  return brain === "alzheimers" ? "ad" : null;
}

export function AssistantPanel({ onActivateRef = focusTarget }: AssistantPanelProps = {}) {
  const selectedKey = useApp((s) => s.selectedKey);
  const outlook = useOutlookCondition();
  const { turns, canAsk, pending, send, cancel, retry } = useAssistant(selectedKey, outlook);
  const [open, setOpen] = useState(true);
  const [draft, setDraft] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // A new record means a new chat: forget the highlighted id and the unsent question with it.
  const [seenKey, setSeenKey] = useState(selectedKey);
  if (seenKey !== selectedKey) {
    setSeenKey(selectedKey);
    setActiveId(null);
    setDraft("");
  }

  // Keep the latest turn in view.
  const last = turns[turns.length - 1];
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, last?.outcome.status]);

  const canSend = canAsk && !pending && draft.trim().length > 0;

  function submit() {
    if (!canSend) return;
    if (send(draft)) setDraft("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a new line; never send while an IME composition is open.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && pending) {
      e.preventDefault();
      cancel();
    }
  }

  function activate(ref: Ref) {
    // Always highlight in the panel; the 3D move is best-effort and must never break the chat.
    setActiveId(ref.id);
    try {
      onActivateRef(ref);
    } catch {
      /* the highlight above is the fallback */
    }
  }

  function onCancel() {
    cancel();
    inputRef.current?.focus();
  }

  return (
    <section aria-label="Assistant" data-testid="assistant-panel" className="mt-auto flex max-h-[55%] min-h-0 shrink-0 flex-col border-t border-line bg-panel">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <h2 className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-muted">Assistant</h2>
        <InfoTip label="About the assistant" side="bottom">
          <span className="block text-ink">Claude explains the rules engine&apos;s result for the selected record.</span>
          <span className="mt-1 block">With the Outlook open it also proposes treatment options. Each is a button from the evidence list only; pressing it changes the model, and the numbers come from the cited studies, never from the assistant.</span>
          <span className="mt-1 block">Model: Claude via the server route (default claude-sonnet-5-5, set by ASSISTANT_MODEL).</span>
          <span className="mt-1 block">Every grade and number comes from the engine; replies with invented numbers or missing citations are withheld and the engine result is shown instead.</span>
          <span className="mt-1 block">Limits: questions up to <span className="num">{MAX_QUESTION_CHARS}</span> characters, the last <span className="num">10</span> turns as context, <span className="num">10</span> requests per minute (counted per server instance), <span className="num">45</span> s per answer.</span>
          <span className="mt-1 block">Privacy: the chat is kept in this tab&apos;s memory only and cleared when the record changes. The record is assessed on the server; only your questions and the engine result (no record free text) go to the Claude API. Nothing is logged or stored.</span>
        </InfoTip>
        <div className="ml-auto flex items-center">
          <IconButton
            label={open ? "Collapse assistant" : "Expand assistant"}
            aria-expanded={open}
            aria-controls="assistant-body"
            className="h-7 w-7"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </IconButton>
        </div>
      </div>
      <p className="shrink-0 border-b border-line px-3 py-1 text-[11px] text-warn" data-testid="assistant-disclaimer">{ASSISTANT_DISCLAIMER}</p>

      <div id="assistant-body" className={open ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-relevant="additions text"
          aria-label="Assistant conversation"
          className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2"
        >
          {turns.length === 0 && (
            <p className="text-[12px] text-faint">
              {outlook
                ? "Ask what to consider, e.g. “Which treatments slow this down?” Proposed options appear as buttons that change the model."
                : canAsk
                  ? "Ask about the selected record, e.g. “Why is the aortic stenosis graded severe?”"
                  : "Select a patient record to ask the assistant."}
            </p>
          )}
          {turns.map((t) => (
            <Turn key={t.id} turn={t} activeId={activeId} onActivate={activate} onRetry={() => retry(t.id)} retryDisabled={pending || !canAsk} />
          ))}
        </div>

        <form
          className="shrink-0 border-t border-line p-2"
          onSubmit={(e) => { e.preventDefault(); submit(); }}
        >
          <label htmlFor="assistant-input" className="sr-only">Question about the selected record</label>
          <textarea
            id="assistant-input"
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={!canAsk}
            maxLength={MAX_QUESTION_CHARS}
            rows={2}
            aria-describedby="assistant-input-hint"
            placeholder={outlook ? "Ask what to consider…" : canAsk ? "Ask about this record…" : "Select a record first"}
            className="block w-full resize-none rounded-lg border border-line bg-panel-2 px-2.5 py-1.5 text-[12px] text-ink placeholder:text-faint focus:border-line-strong focus:outline-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent disabled:opacity-60"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <span id="assistant-input-hint" className="min-w-0 truncate text-[10px] text-faint">
              {canAsk ? "Enter to send · Shift+Enter new line" : "A record must be selected to ask questions."}
            </span>
            {pending ? (
              <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={onCancel}>
                <Square className="h-3 w-3" aria-hidden />Cancel
              </Button>
            ) : (
              <Button type="submit" size="sm" variant="primary" className="ml-auto" disabled={!canSend}>
                <Send className="h-3 w-3" aria-hidden />Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

function Turn({ turn, activeId, onActivate, onRetry, retryDisabled }: {
  turn: ChatTurnView;
  activeId: string | null;
  onActivate: (ref: Ref) => void;
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  const o = turn.outcome;
  return (
    <article className="space-y-1" aria-label="Question and answer">
      <p className="ml-6 whitespace-pre-wrap break-words rounded-lg bg-panel-3 px-2.5 py-1.5 text-[12px] text-ink">
        <span className="sr-only">You asked: </span>{turn.question}
      </p>
      {o.status === "pending" && (
        <p className="flex items-center gap-1.5 text-[12px] text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Checking the engine result…
        </p>
      )}
      {(o.status === "ok" || o.status === "fallback") && (
        <div>
          <span className="sr-only">Assistant: </span>
          <ReplyText reply={o} activeId={activeId} onActivate={onActivate} />
          {o.disclaimer && <p className="mt-1 text-[10px] text-faint">{o.disclaimer}</p>}
        </div>
      )}
      {o.status === "outlook" && <OutlookAnswer reply={o} />}
      {(o.status === "error" || o.status === "cancelled") && (
        <div className="flex items-center gap-2 text-[12px]">
          <span className={o.status === "error" ? "min-w-0 truncate text-error" : "min-w-0 truncate text-muted"} title={o.status === "error" ? o.message : undefined}>
            {o.status === "error" ? o.message : "Cancelled."}
          </span>
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-6 shrink-0 px-2" onClick={onRetry} disabled={retryDisabled}>
            <RotateCcw className="h-3 w-3" aria-hidden />Retry
          </Button>
        </div>
      )}
    </article>
  );
}

/** Cited explanation and the proposed treatment buttons; a button toggles the same scenario as the Outlook's own buttons. */
function OutlookAnswer({ reply }: { reply: OutlookReply }) {
  const active = useOutlook((s) => s.active);
  const toggle = useOutlook((s) => s.toggle);
  return (
    <div className="space-y-1.5" data-testid="assistant-outlook-reply">
      <span className="sr-only">Assistant: </span>
      {reply.answer && <p className="text-[12px] leading-snug text-ink" data-testid="treatment-explanation">{reply.answer}</p>}
      {reply.sources.length > 0 && (
        <ol className="space-y-0.5 text-[10px] text-muted">
          {reply.sources.map((src, i) => (
            <li key={src.id}>[{i + 1}] <a className="underline" href={`https://doi.org/${src.doi}`} target="_blank" rel="noreferrer">{src.cite}</a> · {src.studyType} · {src.journal}</li>
          ))}
        </ol>
      )}
      <div className="space-y-1" data-testid="treatment-proposals">
        {reply.proposals.length === 0 && <p className="text-[11px] text-muted">No option from the list fits this question.</p>}
        {reply.proposals.map((p) => {
          const entry = EVIDENCE.entries.find((e) => e.id === p.id);
          if (!entry) return null;
          return (
            <div key={p.id} className="flex items-center gap-1.5">
              <Button size="sm" pressed={active.includes(p.id)} data-testid={`proposal-${p.id}`} onClick={() => toggle(p.id)}>{entry.label}</Button>
              <span className="min-w-0 truncate text-[11px] text-muted" title={p.reason}>{p.reason}</span>
            </div>
          );
        })}
      </div>
      {reply.note && <p className="text-[10px] text-faint">{reply.note}</p>}
    </div>
  );
}
