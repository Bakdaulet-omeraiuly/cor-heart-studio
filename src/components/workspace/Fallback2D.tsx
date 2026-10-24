"use client";
import { AlertTriangle } from "lucide-react";
import type { StructureId } from "@/domain/mapping/types";
import type { PatientEntry } from "@/lib/patients";
import { useApp } from "@/state/store";
import { Button } from "../ui/primitives";

const STATUS_FILL: Record<string, string> = {
  measured_driven: "var(--measured)", derived: "var(--derived)", assessment_driven: "var(--assessed)", default_unknown: "var(--panel-3)", display_only: "var(--panel-3)",
};

/** Clearly labelled 2D schematic + data fallback. It is NOT a rendering of the 3D model. */
export function Fallback2D({ entry, reason, onRetry }: { entry: PatientEntry; reason: string; onRetry?: () => void }) {
  const select = useApp((s) => s.selectStructure);
  const st = entry.visual.structureStatus;
  const shape = (id: StructureId, d: string, label: string, lx: number, ly: number) => (
    <g role="button" tabIndex={0} aria-label={`${label}: ${st[id].status.replace(/_/g, " ")}`} onClick={() => select(id)} onKeyDown={(e) => e.key === "Enter" && select(id)} className="cursor-pointer">
      <path d={d} fill={STATUS_FILL[st[id].status]} fillOpacity={0.35} stroke="var(--border-strong)" strokeWidth={2} />
      <text x={lx} y={ly} fontSize={13} textAnchor="middle" fill="var(--text)">{label}</text>
      <text x={lx} y={ly + 16} fontSize={10} textAnchor="middle" fill="var(--muted)">{st[id].status.replace(/_/g, " ")}</text>
    </g>
  );
  const valve = (id: StructureId, x: number, y: number) => {
    const v = entry.visual.valves[id as keyof typeof entry.visual.valves];
    const f = v?.stenosis ? `stenosis ${v.stenosis}` : v?.regurgitation ? `regurg. ${v.regurgitation}` : "";
    return <g key={id}><circle cx={x} cy={y} r={7} fill={f ? "var(--warn)" : "var(--panel-2)"} stroke="var(--border-strong)" /><text x={x + 10} y={y + 4} fontSize={10} fill="var(--muted)">{f}</text></g>;
  };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6" data-testid="fallback-2d">
      <div role="status" className="flex max-w-lg items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-[13px]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
        <div>
          <p className="font-medium">2D data fallback — this is a schematic, not the 3D model.</p>
          <p className="text-muted">{reason} All observations, visual-change explanations and warnings remain available in the inspector.</p>
          {onRetry && <Button size="sm" className="mt-2" onClick={onRetry}>Return to 3D</Button>}
        </div>
      </div>
      <svg viewBox="0 0 420 340" className="w-full max-w-md" role="group" aria-label="Four-chamber schematic coloured by data status">
        {shape("ra", "M70,40 h120 v110 h-120 z", "RA", 130, 95)}
        {shape("la", "M230,40 h120 v110 h-120 z", "LA", 290, 95)}
        {shape("rv", "M70,170 h120 v90 q-60,60 -120,0 z", "RV", 130, 215)}
        {shape("lv", "M230,170 h120 v100 q-60,70 -120,0 z", "LV", 290, 220)}
        {valve("tricuspid_valve", 130, 160)}
        {valve("mitral_valve", 290, 160)}
      </svg>
      <ul className="flex flex-wrap justify-center gap-3 text-[11px] text-muted">
        <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--measured)" }} />measurement-driven</li>
        <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--derived)" }} />derived</li>
        <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--assessed)" }} />assessment-driven</li>
        <li><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-panel-3 ring-1 ring-line-strong" />unknown / default</li>
      </ul>
    </div>
  );
}
