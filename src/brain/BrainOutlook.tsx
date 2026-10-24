"use client";
// Brain outlook: today's measured volumes projected with published cohort rates; drives the 3D deformation.
import { useMemo } from "react";
import { PanelHeader, Segmented } from "@/components/ui/primitives";
import { BRAIN_SCENARIOS, SOURCES, SPREAD_LABEL, type BrainScenarioId, type BrainTarget } from "@/domain/outlook/evidence";
import { cortexShiftMm, projectBrain, type BrainProjection } from "@/domain/outlook/project";
import { useOutlook } from "@/outlook/outlookStore";
import { HorizonControls, OutlookCaveat, SourceList, fmtSigned } from "@/outlook/shared";
import type { BrainManifest } from "./types";

/** Structure keys whose meshes each outlook target deforms. */
export const OUTLOOK_TARGET_KEYS: Record<Exclude<BrainTarget, "cortex">, (key: string) => boolean> = {
  hippocampus: (k) => k.startsWith("hippocampus_"),
  ventricles: (k) => k.startsWith("lateral_ventricle_") || k === "third_ventricle",
};

const TARGET_LABEL: Record<BrainTarget, { name: string; detail: string }> = {
  hippocampus: { name: "Hippocampi", detail: "left + right" },
  ventricles: { name: "Ventricles", detail: "lateral + third" },
  cortex: { name: "Cortex", detail: "both hemispheres" },
};

export function brainBaseline(m: BrainManifest): Record<BrainTarget, number> {
  const sum = (ok: (k: string) => boolean) => m.structures.filter((s) => ok(s.key)).reduce((a, b) => a + b.volumeMl, 0);
  return {
    hippocampus: sum(OUTLOOK_TARGET_KEYS.hippocampus),
    ventricles: sum(OUTLOOK_TARGET_KEYS.ventricles),
    cortex: m.totals.cortexLeftMl + m.totals.cortexRightMl,
  };
}

/** Current projection, or null while the outlook is closed (3D stays at baseline). */
export function useBrainProjection(m: BrainManifest): Record<BrainTarget, BrainProjection> | null {
  const open = useOutlook((s) => s.open);
  const years = useOutlook((s) => s.years);
  const pace = useOutlook((s) => s.pace);
  const scenario = useOutlook((s) => s.brainScenario);
  return useMemo(() => (open ? projectBrain(brainBaseline(m), scenario, years, pace) : null), [m, open, years, pace, scenario]);
}

export function BrainOutlookPanel({ manifest }: { manifest: BrainManifest }) {
  const scenario = useOutlook((s) => s.brainScenario);
  const years = useOutlook((s) => s.years);
  const set = useOutlook((s) => s.set);
  const proj = useBrainProjection(manifest);
  const sc = BRAIN_SCENARIOS[scenario];
  if (!proj) return null;
  const ids = [...new Set(Object.values(sc.rates).map((r) => r.source))];
  return (
    <aside className="flex h-full min-h-0 flex-col bg-panel" aria-label="Brain outlook" data-testid="brain-outlook">
      <PanelHeader title="Outlook · published rates" />
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 scroll-thin">
        <div>
          <Segmented<BrainScenarioId> label="Scenario" size="md" value={scenario} onChange={(v) => set({ brainScenario: v })}
            options={Object.values(BRAIN_SCENARIOS).map((s) => ({ value: s.id, label: s.label }))} />
          <p className="mt-1.5 text-[11px] text-faint">Rates from: {sc.cohort}.</p>
        </div>
        <HorizonControls paceHint="Slower and faster ends of each source's reported spread (see the column note)." />

        <table className="w-full text-[12px]" data-testid="brain-outlook-table">
          <thead className="text-left text-[10px] uppercase tracking-wider text-faint">
            <tr><th className="pb-1 font-medium">Structure</th><th className="pb-1 text-right font-medium">Today</th><th className="pb-1 text-right font-medium">{years ? `+${years} y` : "—"}</th><th className="pb-1 text-right font-medium">Change</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(Object.keys(proj) as BrainTarget[]).map((t) => {
              const p = proj[t];
              const pct = (p.ratio - 1) * 100;
              return (
                <tr key={t} className="align-top">
                  <td className="py-1.5">
                    <span className="text-ink">{TARGET_LABEL[t].name}</span>
                    <span className="block text-[10px] text-faint">{TARGET_LABEL[t].detail} · {fmtSigned(p.ratePct, 2)} %/y ({SOURCES[p.rate.source].cite})</span>
                  </td>
                  <td className="num py-1.5 text-right text-muted">{p.baselineMl.toFixed(t === "cortex" ? 0 : 2)} mL</td>
                  <td className="num py-1.5 text-right text-ink">
                    {p.projectedMl.toFixed(t === "cortex" ? 0 : 2)} mL
                    {p.rate.spread !== "none_reported" && years > 0 && (
                      <span className="block text-[10px] text-faint" title={SPREAD_LABEL[p.rate.spread]}>{p.rangeMl[0].toFixed(t === "cortex" ? 0 : 2)}–{p.rangeMl[1].toFixed(t === "cortex" ? 0 : 2)}</span>
                    )}
                  </td>
                  <td className={`num py-1.5 text-right ${Math.abs(pct) < 0.05 ? "text-faint" : "text-ink"}`}>{fmtSigned(pct)} %</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <ul className="space-y-1 text-[11px] leading-snug text-muted">
          {(Object.keys(sc.rates) as BrainTarget[]).map((t) => {
            const r = sc.rates[t];
            return <li key={t}><span className="text-ink">{TARGET_LABEL[t].name}:</span> range = {SPREAD_LABEL[r.spread]}.{r.caveat ? ` ${r.caveat}` : ""}</li>;
          })}
        </ul>

        <OutlookCaveat>
          The anatomy is one healthy adult volunteer ({manifest.subject}); the rates are averages from older cohorts. This shows what the
          published average change would look like on this anatomy. It is not a forecast for this person, and it is not a diagnosis.
        </OutlookCaveat>

        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">How the 3D model changes</h3>
          <p className="text-[11px] leading-snug text-muted">
            Hippocampi and ventricles are scaled about their own centre by the cube root of the volume ratio (shape kept). The cortex moves
            inward by the thinning that its volume change implies at a mean thickness of 2.5 mm (now {cortexShiftMm(proj.cortex.ratio).toFixed(2)} mm).
            The MRI slices are not shown here because they stay at today&apos;s scan.
          </p>
        </div>

        <div>
          <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">Sources</h3>
          <SourceList ids={ids} />
        </div>
      </div>
    </aside>
  );
}
