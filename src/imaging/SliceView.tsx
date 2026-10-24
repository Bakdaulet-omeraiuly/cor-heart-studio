"use client";
// One MPR view (axial / coronal / sagittal) of a source image (MRI, CT) with the segmentation drawn on
// top: the evidence that each 3D structure is exactly the labelled voxels of this scan.
import { useEffect, useMemo, useRef, useState } from "react";
import { renderSlice, screenToVoxel, viewMapping, viewSizeMm, voxelToApp, voxelToScreen, flatIndex, type Vec3, type ViewId } from "./sliceGeometry";
import type { SliceStore, SliceVolume } from "./types";

const VIEW_COLOUR: Record<ViewId, string> = { axial: "#e5484d", coronal: "#46a758", sagittal: "#3e8ed0" };
const VIEW_LABEL: Record<ViewId, string> = { axial: "Axial", coronal: "Coronal", sagittal: "Sagittal" };
/** Orientation letters at the screen edges (left, right, top, bottom). */
const EDGES: Record<ViewId, [string, string, string, string]> = {
  axial: ["R", "L", "A", "P"],
  coronal: ["R", "L", "S", "I"],
  sagittal: ["A", "P", "S", "I"],
};

export function SliceView({ vol, view, useStore }: { vol: SliceVolume; view: ViewId; useStore: SliceStore }) {
  const { image: mri, labels, dims, voxelToApp: M } = vol;
  const map = useMemo(() => viewMapping(M, view), [M, view]);
  const colours = useMemo(() => [[0, 0, 0], ...vol.structures.map((s) => s.colour)], [vol]);
  const s = useStore();
  const crosshair: Vec3 = s.crosshair ?? [Math.floor(dims[0] / 2), Math.floor(dims[1] / 2), Math.floor(dims[2] / 2)];
  const sliceIndex = Math.round(crosshair[map.slice.axis]);

  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLCanvasElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [probe, setProbe] = useState<{ name: string; value: string } | null>(null);

  // fit the physical image (mm) into the panel
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [mmW, mmH] = viewSizeMm(vol, map);
  const fit = Math.min(box.w / mmW, box.h / mmH) || 0;
  const drawW = mmW * fit, drawH = mmH * fit;
  const offX = (box.w - drawW) / 2, offY = (box.h - drawH) / 2;
  const imgW = dims[map.right.axis], imgH = dims[map.up.axis];

  // slice pixels (only when the slice or the style changes)
  useEffect(() => {
    const { pixels, width, height } = renderSlice(mri, labels, dims, map, sliceIndex, {
      windowCenter: s.windowCenter, windowWidth: s.windowWidth, overlay: s.overlay, overlayOpacity: s.overlayOpacity,
      selected: s.selected, colours, hidden: s.hidden,
    });
    const c = image.current ?? (image.current = document.createElement("canvas"));
    c.width = width; c.height = height;
    c.getContext("2d")!.putImageData(new ImageData(pixels, width, height), 0, 0);
  }, [mri, labels, dims, map, sliceIndex, s.windowCenter, s.windowWidth, s.overlay, s.overlayOpacity, s.selected, colours, s.hidden]);

  // composite: image + crosshair (every render)
  useEffect(() => {
    const c = canvas.current, img = image.current;
    if (!c || !img || !box.w) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(box.w * dpr); c.height = Math.round(box.h * dpr);
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#000"; g.fillRect(0, 0, box.w, box.h);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, offX, offY, drawW, drawH);
    const [u, v] = voxelToScreen(map, dims, crosshair);
    const x = offX + ((u + 0.5) / imgW) * drawW, y = offY + ((v + 0.5) / imgH) * drawH;
    const other = (["axial", "coronal", "sagittal"] as ViewId[]).filter((w) => w !== view);
    // the vertical line is the plane of the view whose slice axis is the screen-right axis, and so on
    const lineColour = (screenAxis: 0 | 1 | 2) => VIEW_COLOUR[other.find((w) => viewMapping(M, w).slice.axis === screenAxis) ?? other[0]];
    g.lineWidth = 1;
    g.globalAlpha = 0.85;
    g.strokeStyle = lineColour(map.right.axis);
    g.beginPath(); g.moveTo(x, offY); g.lineTo(x, y - 8); g.moveTo(x, y + 8); g.lineTo(x, offY + drawH); g.stroke();
    g.strokeStyle = lineColour(map.up.axis);
    g.beginPath(); g.moveTo(offX, y); g.lineTo(x - 8, y); g.moveTo(x + 8, y); g.lineTo(offX + drawW, y); g.stroke();
    g.globalAlpha = 1;
  });

  const toVoxel = (clientX: number, clientY: number): Vec3 | null => {
    const r = canvas.current!.getBoundingClientRect();
    const u = Math.floor(((clientX - r.left - offX) / drawW) * imgW), v = Math.floor(((clientY - r.top - offY) / drawH) * imgH);
    if (u < 0 || v < 0 || u >= imgW || v >= imgH) return null;
    return screenToVoxel(map, dims, sliceIndex, u, v);
  };
  const drag = useRef<{ mode: "move" | "wl"; x: number; y: number; c: number; w: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode: e.shiftKey || e.button === 2 ? "wl" : "move", x: e.clientX, y: e.clientY, c: s.windowCenter, w: s.windowWidth };
    if (drag.current.mode === "move") moveTo(e);
  };
  const moveTo = (e: React.PointerEvent) => {
    const ijk = toVoxel(e.clientX, e.clientY);
    if (ijk) s.set({ crosshair: ijk, selected: labels[flatIndex(dims, ...ijk)] || s.selected });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const ijk = toVoxel(e.clientX, e.clientY);
    if (ijk) {
      const l = labels[flatIndex(dims, ...ijk)];
      const b = mri[flatIndex(dims, ...ijk)];
      const value = vol.intensity ? `${Math.round(vol.intensity.byte0 + (b / 255) * (vol.intensity.byte255 - vol.intensity.byte0))} ${vol.intensity.unit}` : String(b);
      setProbe({ name: l ? vol.structures[l - 1]?.name ?? `label ${l}` : "—", value });
    } else setProbe(null);
    const d = drag.current;
    if (!d) return;
    if (d.mode === "move") moveTo(e);
    else s.set({ windowCenter: Math.round(d.c - (e.clientY - d.y) * 0.8), windowWidth: Math.max(8, Math.round(d.w + (e.clientX - d.x) * 1.2)) });
  };
  const onWheel = (e: React.WheelEvent) => {
    const next = [...crosshair] as Vec3;
    next[map.slice.axis] = Math.max(0, Math.min(dims[map.slice.axis] - 1, sliceIndex + (e.deltaY > 0 ? -1 : 1) * map.slice.sign));
    s.set({ crosshair: next });
  };
  const posMm = voxelToApp(M, crosshair).map((v) => (v * 10).toFixed(0));
  const sliceMm = (sliceIndex * vol.spacingMm[map.slice.axis]).toFixed(1);

  return (
    <section className="relative flex min-h-0 flex-col border-b border-line bg-black last:border-b-0" aria-label={`${VIEW_LABEL[view]} slice`} data-testid={`slice-${view}`}>
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-line bg-panel px-2 text-[11px]">
        <span className="h-2 w-2 rounded-full" style={{ background: VIEW_COLOUR[view] }} aria-hidden />
        <span className="font-medium uppercase tracking-wider text-muted">{VIEW_LABEL[view]}</span>
        <span className="num text-faint">{sliceIndex + 1}/{dims[map.slice.axis]} · {sliceMm} mm</span>
        <span className="num ml-auto truncate text-faint" title="Structure and intensity under the pointer">{probe ? `${probe.name} · ${probe.value}` : ""}</span>
      </header>
      <div ref={wrap} className="relative min-h-0 flex-1 touch-none select-none" onContextMenu={(e) => e.preventDefault()}>
        <canvas
          ref={canvas}
          className="absolute inset-0 h-full w-full cursor-crosshair"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => { drag.current = null; }}
          onPointerLeave={() => setProbe(null)}
          onWheel={onWheel}
          data-crosshair={crosshair.join(",")}
        />
        <Edge pos="left" text={EDGES[view][0]} /><Edge pos="right" text={EDGES[view][1]} />
        <Edge pos="top" text={EDGES[view][2]} /><Edge pos="bottom" text={EDGES[view][3]} />
        {view === "axial" && <span className="num pointer-events-none absolute bottom-1 left-2 text-[10px] text-white/55">x {posMm[0]} y {posMm[1]} z {posMm[2]} mm</span>}
      </div>
    </section>
  );
}

function Edge({ pos, text }: { pos: "left" | "right" | "top" | "bottom"; text: string }) {
  const cls = { left: "left-1.5 top-1/2 -translate-y-1/2", right: "right-1.5 top-1/2 -translate-y-1/2", top: "left-1/2 top-1 -translate-x-1/2", bottom: "bottom-1 left-1/2 -translate-x-1/2" }[pos];
  return <span className={`pointer-events-none absolute text-[11px] font-semibold text-amber-300/80 ${cls}`}>{text}</span>;
}
