"use client";
// ECG strip synthesized from the record's intervals and locked to the 3D heart's cycle. A schematic, not a recording:
// event times come from PR / QRS / QT (or labelled population defaults), morphology is a Gaussian-sum template.
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ecgAt, ecgTiming, type Interval } from "@/domain/ecg";
import type { PatientEntry } from "@/lib/patients";
import { useApp } from "@/state/store";
import { getClock } from "@/scene/animation/clock";
import { cx, InfoTip } from "../ui/primitives";

const BEATS = 2.5; // RR intervals visible
const EV_LABEL: Record<Interval["evidence"], string> = { reported: "reported", derived: "derived", population_default: "default" };
const EV_TONE: Record<Interval["evidence"], string> = { reported: "text-ok", derived: "text-info", population_default: "text-warn" };

export function useEcgTiming(entry: PatientEntry) {
  return useMemo(() => {
    const p = entry.patient;
    const v = (path: string) => (p.observations[path]?.status === "ok" ? p.observations[path].value : null);
    return ecgTiming({
      heartRateBpm: entry.visual.timing.heartRateBpm,
      prMs: v("ecg.prInterval"), qrsMs: v("ecg.qrsDuration"), qtMs: v("ecg.qtInterval"), qtcMs: v("ecg.qtc"),
      qtcMethod: (p.record.ecg as { qtcCorrectionMethod?: string } | undefined)?.qtcCorrectionMethod ?? null,
    }, entry.visual.timing.phases);
  }, [entry]);
}

export function EcgStrip({ entry }: { entry: PatientEntry }) {
  const timing = useEcgTiming(entry);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    if (!open) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const g = c.getContext("2d")!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const s = useApp.getState();
      const phase = s.playing ? getClock("main").phase : s.scrubPhase;
      const css = getComputedStyle(c);
      // ECG paper: 40 ms / 0.1 mV minor, 200 ms / 0.5 mV major squares
      const spanS = BEATS * timing.rrS;
      const pxPerS = w / spanS;
      const pxPerMv = Math.min(h / 1.9, pxPerS * 0.4); // keeps the paper's 0.04 s : 0.1 mV aspect where it fits
      const baseY = h * 0.62;
      g.lineWidth = 1;
      for (let ms = 0; ms <= spanS * 1000; ms += 40) {
        g.strokeStyle = ms % 200 === 0 ? css.getPropertyValue("--ecg-major") : css.getPropertyValue("--ecg-minor");
        const x = (ms / 1000) * pxPerS + 0.5;
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
      }
      for (let mv = -2; mv <= 2; mv += 0.1) {
        const y = baseY - mv * pxPerMv;
        if (y < 0 || y > h) continue;
        g.strokeStyle = Math.abs((mv * 10) % 5) < 0.01 ? css.getPropertyValue("--ecg-major") : css.getPropertyValue("--ecg-minor");
        g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
      }
      // sweep: the trace is drawn up to "now" (right edge = current phase), older beats scroll left
      g.strokeStyle = css.getPropertyValue("--ok");
      g.lineWidth = 1.6;
      g.beginPath();
      const n = Math.ceil(w);
      for (let i = 0; i <= n; i++) {
        const tFromNow = ((n - i) / pxPerS);
        const ph = phase - tFromNow / timing.rrS;
        const y = baseY - ecgAt(timing, ((ph % 1) + 1) % 1) * pxPerMv;
        if (i === 0) g.moveTo(i, y); else g.lineTo(i, y);
      }
      g.stroke();
      g.fillStyle = css.getPropertyValue("--accent");
      g.beginPath(); g.arc(w - 2, baseY - ecgAt(timing, phase) * pxPerMv, 3, 0, Math.PI * 2); g.fill();
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [timing, open]);

  const row = (label: string, i: Interval, title?: string) => (
    <span className="whitespace-nowrap" title={i.note ?? title}>
      <span className="text-faint">{label}</span> <span className="num text-ink">{Math.round(i.ms)}</span><span className="text-faint"> ms</span>{" "}
      <span className={cx("text-[9px] uppercase tracking-wide", EV_TONE[i.evidence])}>{EV_LABEL[i.evidence]}</span>
    </span>
  );
  const q = timing.qtc;
  return (
    <div className="shrink-0 border-t border-line bg-panel" data-testid="ecg-strip">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-1 text-[11px]">
        <button className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />} ECG · lead II schematic
        </button>
        <span className="whitespace-nowrap">
          <span className="text-faint">QTc</span> <span className="num text-ink">{Math.round(q.fridericia)}</span><span className="text-faint"> ms (Fridericia)</span>
        </span>
        <InfoTip label="ECG intervals and sources">
          <span className="flex flex-col gap-1">
            <span className="flex flex-wrap gap-x-3">{row("PR", timing.pr)}{row("QRS", timing.qrs)}{row("QT", timing.qt)}</span>
            <span title="Rate-corrected QT: Bazett QT/√RR, Fridericia QT/∛RR, Framingham QT + 0.154(1 − RR) (Sagie 1992)">
              <span className="text-faint">QTc</span> <span className="num text-ink">{Math.round(q.bazett)}</span><span className="text-faint"> Bazett · </span>
              <span className="num text-ink">{Math.round(q.fridericia)}</span><span className="text-faint"> Fridericia · </span>
              <span className="num text-ink">{Math.round(q.framingham)}</span><span className="text-faint"> Framingham</span>
              {q.reported && <span className="text-faint"> (reported {q.reported.ms}{q.reported.method ? ` ${q.reported.method}` : ""})</span>}
            </span>
            <span className="text-faint">
              PEP <span className="num text-muted">{Math.round(timing.pep)}</span> · QS2 <span className="num text-muted">{Math.round(timing.qs2)}</span> ms — Weissler 1968 (men): PEP = 131 − 0.4·HR, QS2 = 546 − 2.1·HR; QRS onset is placed one PEP before aortic valve opening.
            </span>
          </span>
        </InfoTip>
      </div>
      {open && (
        <div className="relative h-[86px] px-3 pb-1.5">
          <canvas ref={canvas} className="h-full w-full rounded bg-[var(--ecg-bg)]" aria-label={`Synthesized ECG schematic: PR ${Math.round(timing.pr.ms)} ms, QRS ${Math.round(timing.qrs.ms)} ms, QT ${Math.round(timing.qt.ms)} ms, rate ${entry.visual.timing.heartRateBpm} bpm`} role="img" />
          <span className="pointer-events-none absolute bottom-2.5 right-5 rounded bg-panel/80 px-1.5 text-[9px] uppercase tracking-wider text-faint">Synthesized from intervals · not a recording</span>
        </div>
      )}
    </div>
  );
}
