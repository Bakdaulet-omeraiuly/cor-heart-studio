"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Camera, Eye, EyeOff, Focus, Layers, MonitorSmartphone, RotateCcw, Scissors, ScanEye } from "lucide-react";
import { STRUCTURE_IDS, STRUCTURE_LABEL, type StructureId } from "@/domain/mapping/types";
import { useApp, type CameraPreset, type CutAxis, type Layers as L, type Quality } from "@/state/store";
import { snapshotPng } from "@/scene/HeartCanvas";
import { Button, IconButton, Segmented, Switch, cx, download } from "../ui/primitives";
import { PROCEDURAL_ASSET_ID, RODERO_TEMPLATE_ID, getHeartAssetSpec, type TemplateId } from "@/scene/asset-adapters/registry";

const PRESETS: { id: CameraPreset; label: string; key: string }[] = [
  { id: "anterior", label: "Anterior", key: "1" },
  { id: "posterior", label: "Posterior", key: "2" },
  { id: "left_lateral", label: "Left lateral", key: "3" },
  { id: "right_lateral", label: "Right lateral", key: "4" },
  { id: "superior", label: "Superior", key: "5" },
  { id: "inferior", label: "Inferior", key: "6" },
  { id: "four_chamber", label: "Four-chamber", key: "7" },
  { id: "short_axis", label: "LV short axis", key: "0" },
  { id: "mitral_closeup", label: "Mitral close-up", key: "8" },
  { id: "aortic_closeup", label: "Aortic close-up", key: "9" },
];

/**
 * Popover rendered in a portal with fixed positioning, clamped to the window, so it is never clipped by
 * the viewport (overflow hidden) or hidden under the inspector / playback bar on narrow screens.
 */
export function Popover({ button, children, align = "left", label }: { button: (open: boolean) => ReactNode; children: ReactNode; align?: "left" | "right"; label: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; maxH: number; width: number } | null>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 8;
      const width = Math.min(300, window.innerWidth - margin * 2);
      let left = align === "right" ? r.right - width : r.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      const top = r.bottom + 6;
      setPos({ left, top, width, maxH: Math.max(160, window.innerHeight - top - margin) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) { if (e.key === "Escape") setOpen(false); return; }
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div ref={anchor} className="relative">
      <div onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="dialog">{button(open)}</div>
      {open && pos && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label={label}
          style={{ position: "fixed", left: pos.left, top: pos.top, width: pos.width, maxHeight: pos.maxH }}
          className="z-[60] overflow-y-auto rounded-xl border border-line bg-panel p-3 shadow-[var(--shadow)] scroll-thin"
        >
          {children}
        </div>,
        document.body,
      )}
    </div>
  );
}

const LAYER_ROWS: { k: keyof L; label: string; hint?: string }[] = [
  { k: "outer", label: "Outer anatomy", hint: "Epicardial surfaces" },
  { k: "chambers", label: "Chambers", hint: "Endocardial surfaces, septa, papillary muscles" },
  { k: "vessels", label: "Great vessels" },
  { k: "coronary", label: "Coronary vessels" },
  { k: "valves", label: "Valves & chordae" },
  { k: "highlights", label: "Abnormality highlights", hint: "Hatched findings, regurgitation cue" },
  { k: "labels", label: "Structure labels (L)", hint: "Off: only the hovered and selected structure are named" },
  { k: "flow", label: "Flow particles", hint: "Illustrative only — not measured flow" },
];

export function SceneToolbar({ onFallback, tierName, lod }: { onFallback: () => void; tierName: string; lod: string }) {
  const s = useApp();
  const selected = s.selectedStructure;
  const spec = getHeartAssetSpec(s.selectedKey ? s.entries[s.selectedKey]?.assetId : undefined);

  // keyboard shortcuts for presets / playback (ignored while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      const p = PRESETS.find((x) => x.key === e.key);
      if (p) { useApp.getState().requestCamera(p.id); e.preventDefault(); }
      if (e.key === " ") { const st = useApp.getState(); st.set({ playing: !st.playing }); e.preventDefault(); }
      if (e.key.toLowerCase() === "r") useApp.getState().requestCamera("anterior");
      if (e.key.toLowerCase() === "l") { const st = useApp.getState(); st.setLayer("labels", !st.layers.labels); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setHidden = (id: StructureId, v: boolean) => s.set({ hidden: { ...s.hidden, [id]: v } });

  return (
    <div className="no-scrollbar relative z-20 flex h-10 shrink-0 items-center justify-between gap-x-2 overflow-x-auto border-b border-line bg-panel px-2">
      <div className="flex shrink-0 items-center gap-1.5">
        <h2 className="mr-1 pl-1 text-[11px] font-medium uppercase tracking-wider text-muted">3D model</h2>
        <label className="sr-only" htmlFor="view-preset">Camera preset</label>
        <select
          id="view-preset"
          className="h-7 rounded-lg border border-line bg-panel-2 px-2 text-[12px] text-ink"
          value=""
          onChange={(e) => { if (e.target.value) s.requestCamera(e.target.value as CameraPreset); }}
        >
          <option value="">View preset…</option>
          {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.key})</option>)}
        </select>
        <IconButton label="Reset view (R)" onClick={() => { s.requestCamera("anterior"); s.set({ isolate: null, hidden: {}, cutaway: { ...s.cutaway, enabled: false }, xray: false }); }}><RotateCcw className="h-4 w-4" /></IconButton>
        <Segmented<"natural" | "clinical">
          label="Display mode"
          value={s.mode}
          onChange={(v) => s.set({ mode: v })}
          options={[{ value: "natural", label: "Natural tissue" }, { value: "clinical", label: "Clinical overlay", title: "Structure colours are diagrammatic, not tissue colour" }]}
        />
        {spec.tier === "A" && (
          <Segmented<TemplateId>
            label="Anatomy template"
            value={s.template}
            onChange={(v) => s.setTemplate(v)}
            options={[
              { value: RODERO_TEMPLATE_ID, label: "CT anatomy", title: "Healthy adult heart from CT (Rodero 2021, CC BY 4.0), adapted to the record's measurements" },
              { value: PROCEDURAL_ASSET_ID, label: "Procedural", title: "Parameterized heart generated by code, adapted to the record's measurements" },
            ]}
          />
        )}
        <Popover label="Cutaway" button={(open) => <IconButton label="Cutaway" pressed={s.cutaway.enabled || open}><Scissors className="h-4 w-4" /></IconButton>}>
          <Switch label="Cutaway plane" hint="Reveals modelled interior geometry with section shading" checked={s.cutaway.enabled} onChange={(v) => s.set({ cutaway: { ...s.cutaway, enabled: v } })} />
          <label className="mt-2 block text-[12px] text-muted" htmlFor="cut-axis">Plane</label>
          <select id="cut-axis" className="mt-1 h-8 w-full rounded-lg border border-line bg-panel-2 px-2 text-[13px]" value={s.cutaway.axis}
            onChange={(e) => {
              const axis = e.target.value as CutAxis;
              s.set({ cutaway: { ...s.cutaway, axis, enabled: true } });
              // frame the cut face so the section (not the outside) faces the viewer
              if (axis === "short_axis") s.requestCamera("short_axis");
              if (axis === "four_chamber") s.requestCamera("four_chamber");
            }}>
            <option value="four_chamber">Four-chamber (long axis)</option>
            <option value="short_axis">LV short axis</option>
            <option value="coronal">Coronal</option>
            <option value="sagittal">Sagittal</option>
          </select>
          <label className="mt-3 flex items-center justify-between text-[12px] text-muted" htmlFor="cut-offset">Position <span className="num">{s.cutaway.offset.toFixed(2)}</span></label>
          <input id="cut-offset" type="range" min={-1} max={1} step={0.01} value={s.cutaway.offset} className="w-full"
            onChange={(e) => s.set({ cutaway: { ...s.cutaway, offset: Number(e.target.value), enabled: true } })} />
        </Popover>
        <IconButton label="X-ray outer shell" pressed={s.xray} onClick={() => s.set({ xray: !s.xray })}><ScanEye className="h-4 w-4" /></IconButton>
        <Popover label="Layers and structures" button={(open) => <IconButton label="Layers and structures" pressed={open}><Layers className="h-4 w-4" /></IconButton>}>
          <div>
            {LAYER_ROWS.map((r) => <Switch key={r.k} label={r.label} hint={r.hint} checked={s.layers[r.k]} onChange={(v) => s.setLayer(r.k, v)} />)}
            <div className="mt-3 border-t border-line pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">Structures</div>
            <ul className="mt-1">
              {STRUCTURE_IDS.filter((id) => id !== "myocardium").map((id) => (
                <li key={id} className={cx("flex items-center justify-between rounded-md px-1 py-0.5 text-[13px]", selected === id && "bg-panel-3")}>
                  <button className="flex-1 text-left hover:underline" onClick={() => s.selectStructure(id)}>{STRUCTURE_LABEL[id]}</button>
                  <IconButton label={s.hidden[id] ? `Show ${STRUCTURE_LABEL[id]}` : `Hide ${STRUCTURE_LABEL[id]}`} onClick={() => setHidden(id, !s.hidden[id])}>
                    {s.hidden[id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </IconButton>
                  <IconButton label={`Isolate ${STRUCTURE_LABEL[id]}`} pressed={s.isolate === id} onClick={() => s.set({ isolate: s.isolate === id ? null : id })}><Focus className="h-3.5 w-3.5" /></IconButton>
                </li>
              ))}
            </ul>
            {(s.isolate || Object.values(s.hidden).some(Boolean)) && (
              <Button size="sm" className="mt-2 w-full" onClick={() => s.set({ isolate: null, hidden: {} })}>Restore all structures</Button>
            )}
          </div>
        </Popover>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <IconButton label="Save snapshot (PNG)" onClick={() => { const url = snapshotPng(); if (url) fetch(url).then((r) => r.blob()).then((b) => download(`cor-snapshot-${s.selectedKey?.replace(/[^a-z0-9-]/gi, "_")}.png`, b)); }}><Camera className="h-4 w-4" /></IconButton>
        <Popover align="right" label="Quality and fallback" button={(open) => <IconButton label="Quality" pressed={open}><MonitorSmartphone className="h-4 w-4" /></IconButton>}>
          <p className="mb-2 text-[12px] text-muted">Tier <b className="text-ink">{tierName}</b> · mesh LOD <b className="text-ink">{lod}</b></p>
          <Segmented<Quality> label="Quality" value={s.quality} onChange={(v) => s.set({ quality: v })}
            options={[{ value: "auto", label: "Auto" }, { value: "high", label: "High" }, { value: "low", label: "Low" }]} />
          <Button size="sm" className="mt-3 w-full" onClick={onFallback}>Switch to 2D data view</Button>
        </Popover>
      </div>
    </div>
  );
}
