"use client";
import { useEffect, useMemo, useReducer } from "react";
import { Pause, Play } from "lucide-react";
import { PHASE_NAMES, sampleCycle, type CyclePhases } from "@/domain/mapping/cycle";
import { useApp } from "@/state/store";
import { getClock, subscribePhase } from "@/scene/animation/clock";
import { EvidenceBadge, IconButton } from "../ui/primitives";

/** Cardiac-cycle diagram (illustrative template). Not an ECG: no waveform is fabricated. */
export function CycleDiagram({ phases, phase, width = 220, height = 46 }: { phases: CyclePhases; phase: number; width?: number; height?: number }) {
  const path = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const s = sampleCycle(phases, i / 120);
      pts.push(`${((i / 120) * width).toFixed(1)},${(6 + s.ventricular * (height - 14)).toFixed(1)}`);
    }
    return `M${pts.join(" L")}`;
  }, [phases, width, height]);
  const x = (f: number) => f * width;
  return (
    <svg width={width} height={height} role="img" aria-label="Illustrative ventricular volume over one cycle (template, not measured)" className="overflow-visible">
      <rect x={x(phases.ivcEnd)} y={0} width={x(phases.ejectionEnd - phases.ivcEnd)} height={height} fill="var(--accent)" opacity={0.1} />
      <rect x={x(phases.atrialStart)} y={0} width={x(1 - phases.atrialStart)} height={height} fill="var(--info)" opacity={0.1} />
      <path d={path} fill="none" stroke="var(--muted)" strokeWidth={1.4} />
      <line x1={x(phase)} x2={x(phase)} y1={0} y2={height} stroke="var(--accent)" strokeWidth={1.5} />
      <text x={2} y={height + 10} fontSize={9} fill="var(--faint)">ED</text>
      <text x={x(phases.ejectionEnd) - 6} y={height + 10} fontSize={9} fill="var(--faint)">ES</text>
    </svg>
  );
}

export function usePhase(clockId = "main") {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribePhase(force), []);
  return getClock(clockId).phase;
}

export function PlaybackBar() {
  const s = useApp();
  const entry = s.selectedKey ? s.entries[s.selectedKey] : null;
  const live = usePhase();
  if (!entry) return null;
  const { phases, heartRateBpm, evidence } = entry.visual.timing;
  const phase = s.playing ? live : s.scrubPhase;
  const cyc = sampleCycle(phases, phase);
  const togglePlay = () => s.set(s.playing ? { playing: false, scrubPhase: live } : { playing: true });
  const seek = (p: number) => { getClock("main").phase = p; s.set({ playing: false, scrubPhase: p }); };
  return (
    <div className="flex w-full shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-line bg-panel px-3 py-2">
      <IconButton label={s.playing ? "Pause (Space)" : "Play (Space)"} onClick={togglePlay} className="h-9 w-9 bg-panel-3 text-ink">
        {s.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </IconButton>
      <div className="flex min-w-[180px] flex-1 flex-col gap-1">
        <div className="flex items-center justify-between text-[12px]">
          <span aria-live="polite" className="font-medium">
            <span className="text-faint">Phase · </span>{PHASE_NAMES[cyc.phase]}
          </span>
          <span className="flex items-center gap-1">
            <button className="rounded px-1.5 text-[11px] text-muted hover:bg-panel-3 hover:text-ink" onClick={() => seek(0)}>End-diastole</button>
            <button className="rounded px-1.5 text-[11px] text-muted hover:bg-panel-3 hover:text-ink" onClick={() => seek(phases.ejectionEnd - 0.002)}>End-systole</button>
          </span>
        </div>
        <input aria-label="Cardiac cycle phase" type="range" min={0} max={0.999} step={0.001} value={phase} onChange={(e) => seek(Number(e.target.value))} />
      </div>
      <div className="hidden xl:block"><CycleDiagram phases={phases} phase={phase} /></div>
      <div className="flex flex-col gap-1 text-[12px]">
        <span className="flex items-center gap-1.5"><span className="num text-[15px] font-semibold">{heartRateBpm}</span> bpm <EvidenceBadge evidence={evidence} compact /></span>
        <label className="flex items-center gap-1.5 text-muted">
          Playback
          <select aria-label="Slow motion" className="h-6 rounded-md border border-line bg-panel-2 px-1 text-[12px] text-ink" value={s.slowMotion} onChange={(e) => s.set({ slowMotion: Number(e.target.value) })}>
            <option value={1}>1× real time</option>
            <option value={0.5}>0.5×</option>
            <option value={0.25}>0.25×</option>
            <option value={0.1}>0.1×</option>
          </select>
        </label>
      </div>
      {s.slowMotion !== 1 && <p className="w-full text-[11px] text-faint">Slow motion changes playback only; the patient&apos;s heart rate ({heartRateBpm} bpm) is unchanged.</p>}
    </div>
  );
}
