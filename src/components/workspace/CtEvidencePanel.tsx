"use client";
// Right-hand evidence panel for Tier B hearts: the source CT in three planes with the segmentation the
// 3D shape was built from. Same slice views as the brain module.
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PanelHeader, Segmented } from "../ui/primitives";
import { SliceView } from "@/imaging/SliceView";
import type { SliceVolume } from "@/imaging/types";
import { useCtSlices, useCtVolume } from "@/scene/ctSlices";
import type { HeartAssetSpec } from "@/scene/asset-adapters/registry";
import { HeartFidelity } from "./HeartFidelity";

const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(" ")})`;

/** HU window presets -> 8-bit centre/width on the volume's byte range. */
function presets(vol: SliceVolume) {
  const { byte0, byte255 } = vol.intensity!;
  const toByte = (hu: number) => ((hu - byte0) / (byte255 - byte0)) * 255;
  const preset = (level: number, width: number) => ({ windowCenter: Math.round(toByte(level)), windowWidth: Math.round((width / (byte255 - byte0)) * 255) });
  return {
    full: { label: `Full ${byte0}…${byte255}`, ...preset((byte0 + byte255) / 2, byte255 - byte0) },
    soft: { label: "Soft tissue", ...preset(40, 400) },
    contrast: { label: "Contrast", ...preset(300, 600) },
  };
}

export function CtEvidencePanel({ spec }: { spec: HeartAssetSpec }) {
  const { vol, error } = useCtVolume(spec);
  const s = useCtSlices();
  const [tab, setTab] = useState<"volumes" | "fidelity">("volumes");
  const im = spec.manifest.imaging!;
  const p = vol ? presets(vol) : null;
  const active = p && (Object.keys(p) as (keyof typeof p)[]).find((k) => p[k].windowCenter === s.windowCenter && p[k].windowWidth === s.windowWidth);
  return (
    <section className="hidden w-[min(34%,460px)] min-w-[300px] shrink-0 flex-col border-l border-line bg-black md:flex" aria-label="Source CT with segmentation" data-testid="ct-evidence">
      <PanelHeader title="Source CT" aside={
        <Segmented<"fill" | "outline" | "off"> label="Segmentation overlay" value={s.overlay} onChange={(v) => s.set({ overlay: v })}
          options={[{ value: "fill", label: "Fill" }, { value: "outline", label: "Outline" }, { value: "off", label: "Off" }]} />
      } />
      {!vol ? (
        <div className="flex flex-1 items-center justify-center text-[12px] text-muted" role={error ? "alert" : "status"}>
          {error ? `CT failed to load: ${error}` : <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading CT…</span>}
        </div>
      ) : (
        <>
          <div className="grid min-h-0 flex-1 grid-rows-3">
            <SliceView vol={vol} view="axial" useStore={useCtSlices} />
            <SliceView vol={vol} view="coronal" useStore={useCtSlices} />
            <SliceView vol={vol} view="sagittal" useStore={useCtSlices} />
          </div>
          <div className="border-t border-line bg-panel px-3 py-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-faint">Window</span>
              {p && (Object.keys(p) as (keyof typeof p)[]).map((k) => (
                <button key={k} onClick={() => s.set({ windowCenter: p[k].windowCenter, windowWidth: p[k].windowWidth })}
                  className={`rounded border px-1.5 py-0.5 ${active === k ? "border-accent text-ink" : "border-line text-muted hover:text-ink"}`}>{p[k].label}</button>
              ))}
            </div>
            <div className="mt-2">
              <Segmented<"volumes" | "fidelity"> label="Panel details" value={tab} onChange={setTab}
                options={[{ value: "volumes", label: "Volumes" }, { value: "fidelity", label: "COR-Fit accuracy" }]} />
            </div>
            {tab === "fidelity" ? <div className="mt-2"><HeartFidelity spec={spec} /></div> : <>
            <ul className="mt-2 grid grid-cols-1 gap-x-3 gap-y-0.5 2xl:grid-cols-2">
              {vol.structures.map((st) => (
                <li key={st.index}>
                  <button className={`flex w-full items-center gap-1.5 text-left ${s.selected === st.index ? "text-ink" : "text-muted hover:text-ink"}`}
                    onClick={() => s.set({ selected: s.selected === st.index ? 0 : st.index })}>
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: rgb(st.colour) }} aria-hidden />
                    <span className="min-w-0 truncate">{st.name}</span>
                    <span className="num ml-auto whitespace-nowrap pl-2 text-faint">{im.structures[st.index - 1]?.volumeMl} mL</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[10px] leading-snug text-faint">Click / drag: crosshair (also marks the 3D model) · wheel: slice · shift-drag: window. The 3D shape is these labels, meshed.</p>
            </>}
          </div>
        </>
      )}
    </section>
  );
}
