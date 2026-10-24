"use client";
// Brain module: structure list | 3D model + measurements | MRI evidence (axial, coronal, sagittal).
import dynamic from "next/dynamic";
import { Database, Loader2 } from "lucide-react";
import { InfoTip, PanelHeader, Segmented, Switch } from "@/components/ui/primitives";
import { fmtMm, fmtPct } from "@/imaging/fidelity";
import { useWebgl } from "@/components/workspace/HeartViewport";
import { useBrain } from "./brainStore";
import { SliceView } from "@/imaging/SliceView";
import { StructurePanel } from "./StructurePanel";
import { BRAIN_SUBJECTS, useBrainData, type BrainData } from "./useBrainData";
import { BrainOutlookPanel } from "./BrainOutlook";
import { useOutlook } from "@/outlook/outlookStore";

const BrainCanvas = dynamic(() => import("./BrainCanvas"), { ssr: false });

export function BrainWorkspace() {
  const { data, error } = useBrainData(BRAIN_SUBJECTS[0].base);
  const webgl = useWebgl();
  const outlook = useOutlook((s) => s.open);
  if (error) return <div className="p-6 text-[13px] text-muted" role="alert">The brain dataset failed to load: {error}</div>;
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center" role="status">
        <span className="flex items-center gap-2 text-[13px] text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading MRI and segmentation…</span>
      </div>
    );
  }
  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-y-auto lg:grid-cols-[280px_minmax(0,1fr)_minmax(300px,30%)] lg:overflow-hidden" data-testid="brain-workspace">
      <div className="order-3 min-h-[360px] border-line bg-panel lg:order-1 lg:min-h-0 lg:border-r"><StructurePanel data={data} /></div>
      <section className="order-1 flex min-h-[520px] flex-col lg:order-2 lg:min-h-0" aria-label="3D brain model">
        <PanelHeader title="3D model" aside={<ModelControls />} />
        <div className="relative min-h-0 flex-1 bg-[#07090c]">
          {webgl ? <BrainCanvas data={data} /> : <p className="p-6 text-[13px] text-muted">WebGL 2 is not available: the MRI slices on the right still show the full segmentation.</p>}
          <Selection data={data} />
        </div>
        <Summary data={data} />
      </section>
      {outlook ? (
        <div className="order-2 min-h-[520px] border-line lg:order-3 lg:min-h-0 lg:border-l"><BrainOutlookPanel manifest={data.manifest} /></div>
      ) : (
      <section className="order-2 flex min-h-[720px] flex-col border-line bg-black lg:order-3 lg:min-h-0 lg:border-l" aria-label="Source MRI with segmentation">
        <PanelHeader title="Source MRI · T1" aside={<SliceControls />} />
        <div className="grid min-h-0 flex-1 grid-rows-3">
          <SliceView vol={data.vol} view="axial" useStore={useBrain} />
          <SliceView vol={data.vol} view="coronal" useStore={useBrain} />
          <SliceView vol={data.vol} view="sagittal" useStore={useBrain} />
        </div>
      </section>
      )}
    </div>
  );
}


function ModelControls() {
  const s = useBrain();
  return (
    <>
      <label className="flex items-center gap-2 text-[11px] text-muted">
        Cortex
        <input type="range" min={0} max={1} step={0.05} value={s.cortexOpacity} onChange={(e) => s.set({ cortexOpacity: Number(e.target.value) })} aria-label="Cortex opacity" className="w-24" />
      </label>
      <div className="w-32"><Switch label="Slice planes" checked={s.showPlanes} onChange={(v) => s.set({ showPlanes: v })} /></div>
    </>
  );
}

function SliceControls() {
  const s = useBrain();
  return (
    <>
      <Segmented<"fill" | "outline" | "off"> label="Segmentation overlay" value={s.overlay} onChange={(v) => s.set({ overlay: v })}
        options={[{ value: "fill", label: "Fill" }, { value: "outline", label: "Outline" }, { value: "off", label: "Off" }]} />
      <button className="text-[11px] text-muted hover:text-ink" onClick={() => s.set({ windowCenter: 128, windowWidth: 256 })} title="Reset window/level">W/L</button>
      <InfoTip label="Slice controls" align="right" side="bottom">Click or drag to move the crosshair · wheel: next slice · shift-drag: window/level</InfoTip>
    </>
  );
}

/** Selected structure: measured values, how it was labelled, bilateral asymmetry when there is a counterpart. */
function Selection({ data }: { data: BrainData }) {
  const selected = useBrain((s) => s.selected);
  const hover = useBrain((s) => s.hover);
  const st = data.manifest.structures[(selected || hover) - 1];
  if (!st) return <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-line bg-panel/85 px-2.5 py-1.5 text-[11px] text-muted backdrop-blur">Click a structure in 3D, in a slice or in the list</div>;
  const twin = st.hemisphere === "midline" ? undefined : data.manifest.structures.find((x) => x.key === st.key.replace(/_(l|r)h(?=_|$)/, (_, h) => `_${h === "l" ? "r" : "l"}h`));
  const asym = twin ? (200 * (st.volumeMl - twin.volumeMl)) / (st.volumeMl + twin.volumeMl) : null;
  const fit = data.manifest.fidelity?.structures.find((r) => r.index === st.index);
  return (
    <div className="absolute left-3 top-3 w-[260px] rounded-lg border border-line bg-panel/90 p-2.5 text-[12px] shadow-[var(--shadow)] backdrop-blur" data-testid="brain-selection">
      <div className="flex items-center gap-1.5 font-medium text-ink">
        {st.name}
        <InfoTip label={`${st.name}: details`} side="bottom">
          <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
            {twin && <><dt className="text-faint">Contralateral</dt><dd className="num">{twin.volumeMl.toFixed(2)} mL</dd></>}
            <dt className="text-faint">Labelled</dt><dd>{st.method === "manual" ? "Manually (DKT31)" : st.method.startsWith("automatic (FreeSurfer") ? "Automatically (FreeSurfer)" : st.method}</dd>
            <dt className="text-faint">Labels</dt><dd className="num">{st.labels.join(", ")}</dd>
            {fit && fit.nsdPercent != null && <>
              <dt className="text-faint">COR-Fit ≤1 vox</dt><dd className="num text-ink">{fmtPct(fit.nsdPercent)}</dd>
              <dt className="text-faint">Mean / HD95</dt><dd className="num">{fmtMm(fit.meanMm)} / {fmtMm(fit.hd95Mm)}</dd>
              {fit.volumeErrorPercent != null && <><dt className="text-faint">3D vs label volume</dt><dd className="num">{fit.volumeErrorPercent >= 0 ? "+" : ""}{fit.volumeErrorPercent.toFixed(1)} %</dd></>}
            </>}
          </dl>
          <span className="mt-1 block text-faint">COR-Fit: share of this structure&apos;s 3D surface within one voxel of its labels (both directions). Asymmetry: (this − other) / mean.</span>
        </InfoTip>
      </div>
      <dl className="mt-1.5 grid grid-cols-[1fr_auto] gap-y-0.5 text-[11px]">
        <dt className="text-faint">Volume</dt><dd className="num text-ink">{st.volumeMl.toFixed(2)} mL</dd>
        {asym !== null && <><dt className="text-faint">Asymmetry</dt><dd className="num">{asym >= 0 ? "+" : ""}{asym.toFixed(1)} %</dd></>}
      </dl>
      {!selected && <p className="mt-1 text-[10px] text-faint">Hover preview — click to select</p>}
    </div>
  );
}

function Summary({ data }: { data: BrainData }) {
  const m = data.manifest;
  const asym = (200 * (m.totals.cortexLeftMl - m.totals.cortexRightMl)) / (m.totals.cortexLeftMl + m.totals.cortexRightMl);
  const ventricles = m.structures.filter((s) => s.group === "ventricles").reduce((a, b) => a + b.volumeMl, 0);
  const hip = m.structures.filter((s) => s.key.startsWith("hippocampus")).reduce((a, b) => a + b.volumeMl, 0);
  const metric = (label: string, value: string, hint: string) => (
    <div className="min-w-0 px-3 py-2" title={hint}>
      <p className="num whitespace-nowrap text-[17px] font-medium leading-tight text-ink">{value}</p>
      <p className="truncate text-[11px] text-faint">{label}</p>
    </div>
  );
  return (
    <div className="shrink-0 border-t border-line bg-panel">
      <div className="grid grid-cols-2 divide-x divide-line md:grid-cols-4">
        {metric("Labelled brain volume", `${m.totals.brainMl.toFixed(0)} mL`, "All labelled voxels (skull and CSF outside the labels excluded)")}
        {metric("Cortex L / R", `${m.totals.cortexLeftMl.toFixed(0)} / ${m.totals.cortexRightMl.toFixed(0)} mL`, `Sum of cortical labels per hemisphere; asymmetry (left − right) / mean ${asym >= 0 ? "+" : ""}${asym.toFixed(1)} %`)}
        {metric("Hippocampi", `${hip.toFixed(2)} mL`, "Left + right, FreeSurfer automatic labels")}
        {metric("Ventricles", `${ventricles.toFixed(1)} mL`, "Lateral, third and fourth ventricles, FreeSurfer automatic labels")}
      </div>
      <p className="flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-[11px] text-faint" data-testid="brain-provenance">
        <Database className="h-3 w-3 shrink-0" />
        <span className="truncate">Healthy adult volunteer · {m.dataset.license}</span>
        {m.fidelity && <span className="num text-muted">· fit {fmtPct(m.fidelity.overall.nsdPercent)}</span>}
        <InfoTip label="Data source and accuracy">
          <span className="block">{m.modality}, healthy adult volunteer ({m.subject}). Cortex: {m.provenance.cortex}. Deep structures: {m.provenance.subcortical}. Not reviewed by a clinician; no normative comparison.</span>
          {m.fidelity && <span className="mt-1 block">COR-Fit ≤ {m.fidelity.toleranceMm} mm: {fmtPct(m.fidelity.overall.nsdPercent)} of the 3D surface within one MRI voxel of the segmentation (both directions); mean {m.fidelity.overall.meanMm} mm. Cortex {m.fidelity.cortex.nsdPercent}%, deep structures {m.fidelity.deep.nsdPercent}%. Fidelity to the labels, not clinical accuracy.</span>}
          <span className="mt-1 block text-faint">Data: {m.dataset.name}, {m.dataset.license} — {m.dataset.source}.</span>
        </InfoTip>
      </p>
    </div>
  );
}
