"use client";
import type { PatientRecord } from "@/domain/schema/record";

type Waveform = NonNullable<NonNullable<PatientRecord["ecg"]>["waveforms"]>[number];

/** Plots only supplied numeric samples (gaps for missing samples). Attachments are listed, never synthesized. */
export function EcgWaveform({ waveform }: { waveform: Waveform }) {
  if (!waveform.samples) {
    return <p className="mt-1 text-[11px] text-muted">Waveform attachment “{waveform.attachmentRef ?? "unnamed"}” ({waveform.format ?? "unknown format"}, {waveform.leads.length} leads, {waveform.samplingFrequencyHz} Hz) — format not decoded; not plotted.</p>;
  }
  const W = 300, H = 64;
  return (
    <figure className="mt-2">
      {waveform.samples.map((lead, li) => {
        const vals = lead.filter((v): v is number => v !== null);
        const min = Math.min(...vals), max = Math.max(...vals);
        const y = (v: number) => H - 4 - ((v - min) / (max - min || 1)) * (H - 8);
        let d = "";
        lead.forEach((v, i) => {
          if (v === null) return;
          const x = (i / (lead.length - 1)) * W;
          d += `${d && lead[i - 1] !== null ? "L" : "M"}${x.toFixed(1)},${y(v).toFixed(1)}`;
        });
        const missing = lead.length - vals.length;
        return (
          <div key={li}>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Supplied ECG samples, lead ${waveform.leads[li]}`} className="rounded-md bg-panel-2">
              <path d={d} fill="none" stroke="var(--ok)" strokeWidth={1.1} />
            </svg>
            <figcaption className="text-[10px] text-faint">Lead {waveform.leads[li]} · {waveform.samplingFrequencyHz} Hz · {lead.length} samples ({(lead.length / waveform.samplingFrequencyHz).toFixed(2)} s) · {waveform.amplitudeUnit}{waveform.calibration ? ` · ${waveform.calibration}` : ""}{missing ? ` · ${missing} missing sample(s) shown as gaps` : ""} · supplied data, auto-scaled</figcaption>
          </div>
        );
      })}
    </figure>
  );
}
