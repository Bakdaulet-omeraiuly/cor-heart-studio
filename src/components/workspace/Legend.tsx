"use client";
import { useState } from "react";
import { Info } from "lucide-react";
import { useApp } from "@/state/store";

const REGION_COLORS: [string, string][] = [
  ["Left ventricle", "rgb(204 84 15)"], ["Right ventricle", "rgb(13 97 173)"], ["Left atrium", "rgb(219 153 26)"], ["Right atrium", "rgb(77 158 217)"],
  ["Aorta", "rgb(184 92 140)"], ["Pulmonary artery", "rgb(26 148 112)"], ["Venae cavae", "rgb(97 102 158)"], ["Pulmonary veins", "rgb(204 189 77)"],
];

export function Legend() {
  const mode = useApp((s) => s.mode);
  // open by default only where there is room; on smaller screens it starts collapsed
  // collapsed by default: the image comes first (open it from the corner)
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto max-w-[280px] rounded-md bg-black/55 text-[11px] text-white/85">
      <button className="flex w-full items-center gap-1.5 px-2 py-1 font-medium text-white/70 hover:text-white" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Info className="h-3.5 w-3.5" /> Legend
      </button>
      {open && (
        <div className="space-y-1.5 px-2.5 pb-2.5">
          <div className="flex items-center gap-2"><Swatch hatch="rgb(242 184 75)" /> Reported finding (segment / valve)</div>
          <div className="flex items-center gap-2"><Swatch hatch="rgb(38 140 242)" /> Wall thickness driven by a measurement</div>
          <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-[rgb(255,184,31)]" /> Illustrative reverse-flow cue</div>
          <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-[rgb(235,237,245)] ring-1 ring-line-strong" /> Illustrative flow particle (not measured)</div>
          {mode === "clinical" && (
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 border-t border-line pt-1.5">
              {REGION_COLORS.map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
              <span className="col-span-2 text-white/60">Overlay hues are diagrammatic, not tissue colour; blue does not mean deoxygenated blood.</span>
            </div>
          )}
          <p className="text-white/60">Orientation: anterior view shows patient left on screen right (gizmo L/S/A).</p>
        </div>
      )}
    </div>
  );
}

function Swatch({ hatch }: { hatch: string }) {
  return <span aria-hidden className="inline-block h-3 w-4 rounded-sm" style={{ background: `repeating-linear-gradient(135deg, ${hatch} 0 3px, transparent 3px 6px)`, outline: `1px solid ${hatch}` }} />;
}
