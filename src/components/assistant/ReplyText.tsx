"use client";
// Renders one assistant reply (Requirements 10.3, 10.4, 10.8).
//
// - `ok`: the guarded model text, first stripped of stray `**` and leading `- ` bullets (`stripMarkdown`), with every `[F#]` / `[E#]` / `[M#]` / `[R#]` citation turned into a small id button.
//   Hover or keyboard focus shows the ref (label · field = value unit · rule · source; for an `M#` missing item:
//   field · why; for an `R#` red flag: label · text); activating it calls `onActivate(ref)` (the panel highlights
//   the ref and calls `focusTarget`, which moves the 3D view for `F#`/`E#` and does nothing for `M#`/`R#`).
// - `fallback`: the engine's Assessment as a plain list with the same id buttons (each followed by a space before
//   its label), plus the "answer withheld" note. Rendered from the structured `assessment`, not by parsing the
//   fallback prose.
import { useId } from "react";
import type { Ref } from "@/app/api/assistant/ids";
import type { Evidence } from "@/app/api/assistant/engine";
import { cx } from "../ui/primitives";
import type { AssistantReply } from "./chatState";
import { refAccessibleName, refDetails, refValue, splitReply, stripMarkdown } from "./replyParts";

export const WITHHELD_NOTE = "Generated answer withheld — showing the engine result.";

export interface ReplyTextProps {
  reply: AssistantReply;
  /** Id of the ref last activated in the panel; its buttons are highlighted. */
  activeId?: string | null;
  onActivate?: (ref: Ref) => void;
}

export function ReplyText({ reply, activeId, onActivate }: ReplyTextProps) {
  return reply.status === "fallback"
    ? <FallbackList reply={reply} activeId={activeId} onActivate={onActivate} />
    : (
      <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink">
        {splitReply(stripMarkdown(reply.text)).map((part, i) =>
          part.kind === "text"
            ? <span key={i}>{part.text}</span>
            : <RefButton key={i} id={part.id} ref_={reply.refs[part.id]} active={activeId === part.id} onActivate={onActivate} />,
        )}
      </p>
    );
}

function FallbackList({ reply, activeId, onActivate }: ReplyTextProps) {
  const a = reply.assessment;
  const groups = [
    { title: "Findings", items: a.findings },
    { title: "Differential", items: a.differential },
  ].filter((g) => g.items.length > 0);
  const btn = (id: string) => <RefButton id={id} ref_={reply.refs[id]} active={activeId === id} onActivate={onActivate} />;
  return (
    <div className="text-[12px] leading-relaxed">
      <p className="text-[11px] text-warn">{WITHHELD_NOTE}</p>
      {groups.map((g) => (
        <section key={g.title} className="mt-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-faint">{g.title}</h4>
          <ul className="mt-0.5 space-y-1">
            {g.items.map((f) => (
              <li key={f.id}>
                {/* Inline flow with real spaces (not flex gaps), so id and label never run together in copied
                    text or for screen readers. */}
                <div>
                  {btn(f.id)}{" "}
                  <span className="text-ink">{f.label}</span>{" "}
                  <span className="text-faint">({f.basis})</span>
                </div>
                {f.evidence.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5 pl-3">
                    {/* `Finding & { evidence: Ided<Evidence>[] }` widens `map`'s element to Evidence; the ids are there. */}
                    {(f.evidence as (Evidence & { id: string })[]).map((e) => {
                      const ref = reply.refs[e.id];
                      const value = ref ? refValue(ref) : typeof e.value === "number" ? `${e.value}${e.unit ? ` ${e.unit}` : ""}` : null;
                      return (
                        <li key={e.id} className="text-muted">
                          {btn(e.id)}{" "}
                          <span className="num">{e.field}</span>
                          {value && <>{" "}<span className="num text-ink">= {value}</span></>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {groups.length === 0 && <p className="mt-1 text-muted">The engine reported no findings for this record.</p>}
      {a.missing.length > 0 && (
        <section className="mt-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-faint">Missing</h4>
          <ul className="mt-0.5 space-y-0.5">
            {a.missing.map((m) => (
              <li key={m.id} className="text-muted">
                {btn(m.id)}{" "}
                <span className="num text-ink">{m.field}</span>{" "}
                <span>— {m.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {a.redFlags.length > 0 && (
        <section className="mt-1.5">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-error">Red flags</h4>
          <ul className="mt-0.5 space-y-0.5">
            {a.redFlags.map((r) => (
              <li key={r.id} className="text-error">
                {btn(r.id)}{" "}
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * A cited id as a small button. The tooltip follows `InfoTip` in `ui/primitives` (same surface, hover or
 * keyboard focus, kept in the DOM) but uses the id itself as the trigger, so each citation is one tab stop.
 */
function RefButton({ id, ref_, active, onActivate }: { id: string; ref_: Ref | undefined; active: boolean; onActivate?: (ref: Ref) => void }) {
  const tipId = useId();
  return (
    <span className="group relative inline-flex align-baseline">
      <button
        type="button"
        aria-label={refAccessibleName(id, ref_)}
        aria-describedby={tipId}
        aria-pressed={ref_ ? active : undefined}
        disabled={!ref_}
        data-ref-id={id}
        onClick={() => { if (ref_) onActivate?.(ref_); }}
        className={cx(
          "num mx-0.5 inline-flex h-4 items-center rounded border px-1 text-[10px] leading-none transition-colors",
          "focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent",
          active ? "border-accent bg-accent/15 text-ink" : "border-line-strong bg-panel-2 text-muted hover:border-accent hover:text-ink",
          !ref_ && "opacity-60",
        )}
      >
        {id}
      </button>
      <span
        id={tipId}
        role="tooltip"
        className={cx(
          "invisible absolute bottom-full left-0 z-50 mb-1.5 w-max max-w-[18rem] rounded-md border border-line bg-panel-2 px-2.5 py-2 text-left text-[11px] font-normal leading-snug text-muted opacity-0 shadow-lg transition-opacity",
          "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
        )}
      >
        {ref_
          ? refDetails(ref_).map((line, i) => <span key={i} className={cx("block", i === 0 && "text-ink", i === 1 && ref_.field && "num")}>{line}</span>)
          : "Not in the assessment."}
      </span>
    </span>
  );
}
