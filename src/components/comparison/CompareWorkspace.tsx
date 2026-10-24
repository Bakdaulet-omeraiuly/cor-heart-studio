"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Info } from "lucide-react";
import { STRUCTURE_LABEL, type StructureId } from "@/domain/mapping/types";
import type { EvidenceClass } from "@/domain/types";
import { patientTitle, type PatientEntry } from "@/lib/patients";
import { useApp } from "@/state/store";
import { detectTier } from "@/scene/performance/quality";
import { useLowAssets } from "@/scene/useHeartAssets";
import { getHeartAssetSpec } from "@/scene/asset-adapters/registry";
import { EvidenceBadge, Pill, Segmented, Switch, cx } from "../ui/primitives";
import { useWebgl } from "../workspace/HeartViewport";

const CompareCanvas = dynamic(() => import("@/scene/CompareCanvas"), { ssr: false });

interface Row { label: string; path?: string; structure: StructureId; derivedId?: string; kind?: "valves" | "wma" }
const ROWS: Row[] = [
  { label: "Heart rate", path: "observations.heartRate", structure: "myocardium" },
  { label: "LVEDD", path: "observations.lvEndDiastolicDiameter", structure: "lv" },
  { label: "LVEDV", path: "observations.lvEndDiastolicVolume", structure: "lv" },
  { label: "LVESV", path: "observations.lvEndSystolicVolume", structure: "lv" },
  { label: "LVEF (reported)", path: "observations.lvEjectionFraction", structure: "lv" },
  { label: "LVEF (derived from volumes)", derivedId: "lvEfFromVolumes", structure: "lv" },
  { label: "IVSd", path: "observations.ivsThickness", structure: "lv" },
  { label: "LVPWd", path: "observations.lvPosteriorWallThickness", structure: "lv" },
  { label: "LA volume", path: "observations.laVolume", structure: "la" },
  { label: "RV basal diameter", path: "observations.rvBasalDiameter", structure: "rv" },
  { label: "Valve findings", structure: "mitral_valve", kind: "valves" },
  { label: "Abnormal wall-motion segments", structure: "lv", kind: "wma" },
];

function cell(e: PatientEntry, r: Row): { text: string; value?: number; unit?: string; method?: string; evidence: EvidenceClass } {
  if (r.kind === "valves") {
    const f = e.patient.valveFindings;
    return { text: f.length ? f.map((v) => `${STRUCTURE_LABEL[v.valve].replace(" valve", "")} ${v.condition}${v.severity ? ` (${v.severity.replace(/_/g, " ")})` : ""}`).join("; ") : "none reported", evidence: f.length ? "reported_assessment" : "default_unknown" };
  }
  if (r.kind === "wma") {
    const n = e.patient.wallMotion.filter((w) => w.motion !== "normal");
    return { text: e.patient.wallMotion.length ? (n.length ? n.map((w) => `${w.segment}:${w.motion}`).join(", ") : "none (all reported normal)") : "not reported", evidence: e.patient.wallMotion.length ? "reported_assessment" : "default_unknown" };
  }
  if (r.derivedId) {
    const d = e.patient.derived.find((x) => x.id === r.derivedId);
    return d ? { text: `${d.value} ${d.unit}`, value: d.value, unit: d.unit, method: "derived", evidence: "derived" } : { text: "unknown", evidence: "default_unknown" };
  }
  const o = e.patient.observations[r.path!];
  if (!o || o.status === "null") return { text: "unknown", evidence: "default_unknown" };
  if (o.status !== "ok") return { text: `${o.original.value} ${o.original.unit ?? ""} (not usable: ${o.statusMessage})`, evidence: "reported_measurement" };
  return { text: `${o.value} ${o.unit}`, value: o.value!, unit: o.unit, method: o.method, evidence: "reported_measurement" };
}

export function CompareWorkspace() {
  const s = useApp();
  const tier = useMemo(() => detectTier(s.quality), [s.quality]);
  const webgl = useWebgl();
  const [syncCamera, setSyncCamera] = useState(true);
  const entries = s.compareKeys.map((k) => s.entries[k]).filter(Boolean);
  const cap = tier.maxCompareViews;
  const shown = entries.slice(0, cap);
  const assets = useLowAssets(shown.map((e) => getHeartAssetSpec(e.assetId))); // comparison always uses the low LOD (performance cap)
  const ready = shown.every((e) => assets.assets[getHeartAssetSpec(e.assetId).id]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="compare">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-3 py-2 text-[12px]">
        <Segmented<"phase" | "realtime"> label="Time synchronisation" value={s.syncMode} onChange={(v) => s.set({ syncMode: v })}
          options={[{ value: "phase", label: "Synchronized phase", title: "All hearts at the same fraction of their own cycle" }, { value: "realtime", label: "Real time", title: "Each heart beats at its own reported rate" }]} />
        <Segmented<"shared" | "fit"> label="Scale" value={s.sharedScale ? "shared" : "fit"} onChange={(v) => s.set({ sharedScale: v === "shared" })}
          options={[{ value: "shared", label: "Shared scale (cm)" }, { value: "fit", label: "Fit to view" }]} />
        <div className="w-44"><Switch label="Synchronize cameras" checked={syncCamera} onChange={setSyncCamera} /></div>
        <span className="ml-auto text-muted">{entries.length}/4 selected · showing {shown.length}{entries.length > cap ? ` (device cap ${cap})` : ""}</span>
      </div>
      <p className="flex items-start gap-1.5 border-b border-line bg-panel-2 px-3 py-1.5 text-[11px] text-muted">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        {s.syncMode === "phase" ? "Synchronized phase: every heart is shown at the same point of its own cycle — heart rates still differ (see table). " : "Real time: each heart beats at its own heart rate. "}
        {s.sharedScale ? "Shared scale: all hearts share centimetre units; only data-driven dimensions are calibrated, the rest of each shape is the baseline asset." : "Fit to view: each heart is normalised to its panel — size differences are hidden on purpose."}
      </p>
      <div className="min-h-0 flex-1">
        {entries.length < 2 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-[13px] text-muted">Tick 2–4 records in the patient list to compare them side by side.</div>
        ) : !webgl ? (
          <div className="p-6 text-[13px] text-muted">WebGL is unavailable — use the difference table below.</div>
        ) : assets.error ? (
          <div className="p-6 text-[13px] text-muted" role="alert">An anatomical asset failed to load: {assets.error}</div>
        ) : ready ? (
          <CompareCanvas entries={shown} assets={assets.assets} syncCamera={syncCamera} sharedScale={s.sharedScale} />
        ) : <div className="p-6 text-[13px] text-muted" role="status">Loading anatomical asset…</div>}
      </div>
      {entries.length >= 2 && <DifferenceTable entries={entries} />}
    </div>
  );
}

function DifferenceTable({ entries }: { entries: PatientEntry[] }) {
  const select = useApp((s) => s.selectStructure);
  return (
    <div className="max-h-[38%] overflow-auto border-t border-line bg-panel scroll-thin">
      <table className="w-full min-w-[640px] text-[12px]" aria-label="Difference table">
        <thead className="sticky top-0 bg-panel-2 text-left text-[11px] text-faint">
          <tr><th className="px-3 py-1.5 font-medium">Observation</th>{entries.map((e, i) => <th key={e.key} className="px-3 font-medium">{patientTitle(e.patient)}{i > 0 && <span className="block font-normal">Δ vs first</span>}</th>)}</tr>
        </thead>
        <tbody>
          {ROWS.map((r) => {
            const cells = entries.map((e) => cell(e, r));
            const base = cells[0];
            return (
              <tr key={r.label} className="cursor-pointer border-t border-line hover:bg-panel-2" onClick={() => select(r.structure)}>
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">{r.label}</th>
                {cells.map((c, i) => {
                  let delta: string | null = null;
                  if (i > 0 && c.value !== undefined && base.value !== undefined) {
                    const compatible = c.unit === base.unit && (c.method ?? "") === (base.method ?? "");
                    delta = compatible ? `${c.value - base.value >= 0 ? "+" : ""}${Math.round((c.value - base.value) * 10) / 10} ${c.unit}` : "Δ not computed (method differs or unspecified)";
                  }
                  return (
                    <td key={i} className={cx("px-3 py-1.5", c.evidence === "default_unknown" && "text-faint")}>
                      <span className="flex items-center gap-1.5"><EvidenceBadge evidence={c.evidence} compact /><span className="num">{c.text}</span></span>
                      {delta && <span className="num text-[11px] text-muted">{delta}</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          <tr className="border-t border-line">
            <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">Rendering basis</th>
            {entries.map((e) => <td key={e.key} className="px-3 py-1.5"><Pill>{e.visual.changes.length} data-driven change(s) · {e.visual.unknowns.length} unknown</Pill></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
