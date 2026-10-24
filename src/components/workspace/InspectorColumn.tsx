"use client";
// Right-hand inspector column: resizable by dragging (or arrow keys on) its left edge, closable, and
// reduced to a slim rail when closed so it can always be reopened in place.
import { useRef } from "react";
import { PanelRightOpen } from "lucide-react";
import { useApp } from "@/state/store";
import { Inspector } from "../inspector/Inspector";
import { AssistantPanel } from "../assistant/AssistantPanel";

export const INSPECTOR_MIN = 280;
export const INSPECTOR_MAX = 640;
const clamp = (w: number) => Math.round(Math.max(INSPECTOR_MIN, Math.min(INSPECTOR_MAX, w)));

export function InspectorColumn() {
  const open = useApp((s) => s.inspectorOpen);
  const width = useApp((s) => s.inspectorWidth);
  const set = useApp((s) => s.set);
  const drag = useRef<{ x: number; w: number } | null>(null);

  if (!open) {
    return (
      <div className="order-3 hidden min-h-0 border-l border-line bg-panel lg:block">
        <button
          className="flex h-full w-full flex-col items-center gap-2 pt-3 text-muted hover:bg-panel-2 hover:text-ink"
          onClick={() => set({ inspectorOpen: true })}
          aria-label="Open inspector"
          title="Open inspector"
        >
          <PanelRightOpen className="h-4 w-4" />
          <span className="text-[11px] font-medium uppercase tracking-wider [writing-mode:vertical-rl]">Inspector</span>
        </button>
      </div>
    );
  }
  return (
    <div className="relative order-3 flex min-h-0 flex-col border-line bg-panel lg:border-l">
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        aria-valuemin={INSPECTOR_MIN}
        aria-valuemax={INSPECTOR_MAX}
        aria-valuenow={width}
        tabIndex={0}
        className="absolute inset-y-0 -left-1 z-30 hidden w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-[3px] after:w-0.5 after:bg-transparent hover:after:bg-accent focus-visible:after:bg-accent lg:block"
        onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, w: width }; }}
        onPointerMove={(e) => { if (drag.current) set({ inspectorWidth: clamp(drag.current.w + drag.current.x - e.clientX) }); }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => set({ inspectorWidth: 360 })}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") { set({ inspectorWidth: clamp(width + 24) }); e.preventDefault(); }
          if (e.key === "ArrowRight") { set({ inspectorWidth: clamp(width - 24) }); e.preventDefault(); }
        }}
        title="Drag to resize · double-click to reset"
      />
      <Inspector />
      <AssistantPanel />
    </div>
  );
}
