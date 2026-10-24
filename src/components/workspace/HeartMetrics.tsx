"use client";
// Key numbers under the 3D heart, each with where it comes from. Tier B: the CT segmentation's own
// volumes; Tier A: the record's reported values. Unknown is shown as unknown, never as a default.
import type { PatientEntry } from "@/lib/patients";
import type { HeartAssetSpec } from "@/scene/asset-adapters/registry";
import { InfoTip } from "../ui/primitives";

interface Metric { label: string; value: string | null; unit: string; source: string }

const MYOCARDIUM_G_PER_ML = 1.05;

function fromCt(spec: HeartAssetSpec): Metric[] {
  const st = Object.fromEntries((spec.manifest.imaging?.structures ?? []).map((s) => [s.key, s.volumeMl]));
  const src = "CT segmentation · phase unknown";
  const v = (k: string) => (st[k] != null ? st[k].toFixed(1) : null);
  return [
    { label: "LV cavity", value: v("lv_cavity"), unit: "mL", source: src },
    { label: "LV mass", value: st.lv_myocardium != null ? (st.lv_myocardium * MYOCARDIUM_G_PER_ML).toFixed(0) : null, unit: "g", source: `derived: myocardium × ${MYOCARDIUM_G_PER_ML} g/mL` },
    { label: "RV label", value: v("rv"), unit: "mL", source: "may include RV wall" },
    { label: "Left atrium", value: v("la"), unit: "mL", source: src },
    { label: "Right atrium", value: v("ra"), unit: "mL", source: src },
  ];
}

function fromRecord(entry: PatientEntry): Metric[] {
  const p = entry.patient;
  const obs = (path: string) => {
    const o = p.observations[`observations.${path}`];
    return o && o.status === "ok" && o.value !== null ? { value: String(o.value), source: o.method ?? o.source ?? "reported" } : null;
  };
  const ef = obs("lvEjectionFraction");
  const efDerived = p.derived.find((d) => d.id === "lvEfFromVolumes");
  const metric = (label: string, path: string, unit: string): Metric => {
    const o = obs(path);
    return { label, value: o?.value ?? null, unit, source: o?.source ?? "not reported" };
  };
  return [
    metric("LVEDV", "lvEndDiastolicVolume", "mL"),
    ef ? { label: "LVEF", value: ef.value, unit: "%", source: ef.source }
      : { label: "LVEF", value: efDerived ? String(efDerived.value) : null, unit: "%", source: efDerived ? "derived from volumes" : "not reported" },
    metric("IVSd", "ivsThickness", "mm"),
    metric("LA volume", "laVolume", "mL"),
    metric("Heart rate", "heartRate", "bpm"),
  ];
}

export function HeartMetrics({ entry, spec }: { entry: PatientEntry; spec: HeartAssetSpec }) {
  const metrics = spec.manifest.imaging ? fromCt(spec) : fromRecord(entry);
  return (
    <div className="grid shrink-0 grid-cols-3 divide-x divide-line border-t border-line bg-panel md:grid-cols-5" data-testid="heart-metrics">
      {metrics.map((m, i) => (
        <div key={m.label} className="min-w-0 px-3 py-1.5">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-faint">
            <span className="truncate">{m.label}</span>
            <InfoTip label={`${m.label}: source`} align={i >= 3 ? "right" : "left"}>{m.value ? m.source : "unknown"}</InfoTip>
          </p>
          <p className="num text-[16px] leading-tight text-ink">
            {m.value ?? <span className="text-faint">—</span>}
            {m.value && <span className="ml-1 text-[11px] text-muted">{m.unit}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}
