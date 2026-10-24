"use client";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { EVIDENCE_LABEL, type EvidenceClass } from "@/domain/types";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "ghost" | "outline" | "subtle" | "danger";
export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md"; pressed?: boolean }>(
  function Button({ variant = "outline", size = "md", pressed, className, ...p }, ref) {
    return (
      <button
        ref={ref}
        aria-pressed={pressed}
        className={cx(
          "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-45 disabled:pointer-events-none select-none",
          size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8.5 px-3 text-[13px]",
          variant === "primary" && "bg-accent text-accent-ink hover:brightness-110",
          variant === "outline" && "border border-line bg-panel-2 text-ink hover:border-line-strong hover:bg-panel-3",
          variant === "ghost" && "text-muted hover:text-ink hover:bg-panel-3",
          variant === "subtle" && "bg-panel-3 text-ink hover:brightness-110",
          variant === "danger" && "text-error hover:bg-panel-3",
          pressed && "!border-accent !text-ink bg-panel-3",
          className,
        )}
        {...p}
      />
    );
  },
);

export function IconButton({ label, children, className, pressed, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; pressed?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cx("inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-panel-3 hover:text-ink", pressed && "bg-panel-3 text-ink ring-1 ring-accent/60", className)}
      {...p}
    >
      {children}
    </button>
  );
}

const EV_SYMBOL: Record<EvidenceClass, string> = {
  reported_measurement: "●",
  reported_assessment: "◆",
  derived: "▲",
  illustrative_inference: "◌",
  default_unknown: "?",
};
export function EvidenceBadge({ evidence, compact }: { evidence: EvidenceClass; compact?: boolean }) {
  return (
    <span className={cx("ev", `ev-${evidence}`)} title={EVIDENCE_LABEL[evidence]}>
      <span aria-hidden>{EV_SYMBOL[evidence]}</span>
      {compact ? <span className="sr-only">{EVIDENCE_LABEL[evidence]}</span> : EVIDENCE_LABEL[evidence]}
    </span>
  );
}

/**
 * ⓘ that reveals detail on hover or keyboard focus. Detail stays in the DOM (readable by screen readers
 * and tests); only the primary value sits on screen. Provenance moves here, it is never deleted.
 */
export function InfoTip({ children, label = "Details", align = "left", side = "top", className }: { children: ReactNode; label?: string; align?: "left" | "right"; side?: "top" | "bottom"; className?: string }) {
  return (
    <span className={cx("group relative inline-flex align-middle", className)}>
      <button type="button" aria-label={label} className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none text-faint hover:text-ink focus-visible:text-ink focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent">
        ⓘ
      </button>
      <span
        role="tooltip"
        className={cx(
          "invisible absolute z-50 w-max max-w-[22rem] rounded-md border border-line bg-panel-2 px-2.5 py-2 text-left text-[11px] font-normal normal-case leading-snug tracking-normal text-muted opacity-0 shadow-lg transition-opacity",
          "group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100",
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
          align === "left" ? "left-0" : "right-0",
        )}
      >
        {children}
      </span>
    </span>
  );
}

export function Pill({ children, tone = "neutral", title }: { children: ReactNode; tone?: "neutral" | "warn" | "error" | "info" | "ok" | "accent"; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap",
        tone === "neutral" && "bg-panel-3 text-muted",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "error" && "bg-error/15 text-error",
        tone === "info" && "bg-info/15 text-info",
        tone === "ok" && "bg-ok/15 text-ok",
        tone === "accent" && "bg-accent/15 text-accent",
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label, size = "sm" }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; size?: "sm" | "md" }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-line bg-panel-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx("rounded-md px-2.5 font-medium transition-colors", size === "sm" ? "h-6 text-[12px]" : "h-7.5 text-[13px]", value === o.value ? "bg-panel-3 text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1 text-[13px]">
      <span className="flex flex-col">
        <span>{label}</span>
        {hint && <span className="text-[11px] text-faint">{hint}</span>}
      </span>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-accent" : "bg-panel-3 ring-1 ring-line-strong")}
      >
        <span className={cx("absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4.5" : "translate-x-0.5")} />
      </button>
    </label>
  );
}

/** Docked panel header: micro label on the left, controls on the right (see docs/design-system.md). */
export function PanelHeader({ title, aside, count, className }: { title: string; aside?: ReactNode; count?: number; className?: string }) {
  return (
    <div className={cx("flex h-9 shrink-0 items-center gap-2 border-b border-line bg-panel px-3", className)}>
      <h2 className="whitespace-nowrap text-[11px] font-medium uppercase tracking-wider text-muted">{title}</h2>
      {count !== undefined && <span className="num text-[11px] text-faint">{count}</span>}
      {aside && <div className="ml-auto flex min-w-0 items-center gap-3">{aside}</div>}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center justify-between first:mt-0">
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{children}</h3>
      {aside}
    </div>
  );
}

export function download(name: string, content: string | Blob, type = "application/json") {
  const blob = typeof content === "string" ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
