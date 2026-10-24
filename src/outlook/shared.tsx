"use client";
// Pieces shared by the heart and brain outlook views: horizon/pace controls, the evidence list, the caveat line.
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Segmented } from "@/components/ui/primitives";
import { SOURCES } from "@/domain/outlook/evidence";
import { PACE_LABEL, type Pace } from "@/domain/outlook/project";
import { MAX_YEARS, useOutlook } from "./outlookStore";

export function HorizonControls({ paceHint }: { paceHint: string }) {
  const years = useOutlook((s) => s.years);
  const pace = useOutlook((s) => s.pace);
  const set = useOutlook((s) => s.set);
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="flex items-baseline justify-between text-[12px]">
          <span className="text-muted">Time from today</span>
          <span className="num text-[15px] font-medium text-ink" data-testid="outlook-years">{years === 0 ? "Today" : `+${years} year${years > 1 ? "s" : ""}`}</span>
        </span>
        <input type="range" min={0} max={MAX_YEARS} step={1} value={years} onChange={(e) => set({ years: Number(e.target.value) })}
          aria-label="Years from today" className="mt-1 w-full" />
        <span className="flex justify-between text-[10px] text-faint num"><span>0</span><span>{MAX_YEARS / 2}</span><span>{MAX_YEARS} y</span></span>
      </label>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] text-muted" title={paceHint}>Pace of change</span>
        <Segmented<Pace> label="Pace of change" value={pace} onChange={(v) => set({ pace: v })}
          options={(["slow", "mean", "fast"] as const).map((p) => ({ value: p, label: PACE_LABEL[p], title: paceHint }))} />
      </div>
    </div>
  );
}

export function SourceList({ ids }: { ids: string[] }) {
  return (
    <ol className="space-y-1.5 text-[11px] leading-snug">
      {ids.map((id) => {
        const s = SOURCES[id];
        return (
          <li key={id}>
            <a href={`https://doi.org/${s.doi}`} target="_blank" rel="noreferrer" className="group inline-flex items-start gap-1 text-ink hover:text-accent">
              <span><span className="font-medium">{s.cite}</span> · {s.title}</span>
              <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-faint group-hover:text-accent" aria-hidden />
            </a>
            <span className="block text-faint">{s.journal} · {s.design}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function OutlookCaveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-warn/30 bg-warn/10 px-2.5 py-2 text-[11px] leading-snug text-ink" data-testid="outlook-caveat">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

export const fmtSigned = (x: number, digits = 1) => `${x >= 0 ? "+" : ""}${x.toFixed(digits)}`;
