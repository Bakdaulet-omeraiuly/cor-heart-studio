"use client";
// Structure tree: every labelled structure with its measured volume and how it was labelled.
import { useMemo, useState } from "react";
import { ChevronRight, Eye, EyeOff, Search } from "lucide-react";
import { InfoTip, PanelHeader, cx } from "@/components/ui/primitives";
import { useBrain } from "./brainStore";
import { flatIndex, type Vec3 } from "@/imaging/sliceGeometry";
import type { BrainData } from "./useBrainData";
import type { BrainStructure } from "./types";

const GROUPS: { id: string; label: string; match: (s: BrainStructure) => boolean }[] = [
  { id: "ctx_l", label: "Cortex · left hemisphere", match: (s) => s.group === "cortex" && s.hemisphere === "left" },
  { id: "ctx_r", label: "Cortex · right hemisphere", match: (s) => s.group === "cortex" && s.hemisphere === "right" },
  { id: "deep", label: "Deep grey matter", match: (s) => s.group === "deep_grey" },
  { id: "vent", label: "Ventricles", match: (s) => s.group === "ventricles" },
  { id: "cb", label: "Cerebellum & brainstem", match: (s) => s.group === "cerebellum_brainstem" },
  { id: "wm", label: "White matter", match: (s) => s.group === "white_matter" },
];

const rgb = (c: number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(" ")})`;

/** Voxel centroid of a structure (to jump the slices there). */
function centroidOf(data: BrainData, index: number): Vec3 | null {
  const { dims } = data.manifest.volume;
  let x = 0, y = 0, z = 0, n = 0;
  for (let i = 0; i < dims[0]; i++) for (let j = 0; j < dims[1]; j++) for (let k = 0; k < dims[2]; k++) {
    if (data.labels[flatIndex(dims, i, j, k)] !== index) continue;
    x += i; y += j; z += k; n++;
  }
  if (!n) return null;
  // snap to a voxel of the structure nearest the centroid (centroids of curved structures can fall outside)
  const c = [x / n, y / n, z / n];
  let best: Vec3 | null = null, bestD = Infinity;
  for (let i = 0; i < dims[0]; i++) for (let j = 0; j < dims[1]; j++) for (let k = 0; k < dims[2]; k++) {
    if (data.labels[flatIndex(dims, i, j, k)] !== index) continue;
    const d = (i - c[0]) ** 2 + (j - c[1]) ** 2 + (k - c[2]) ** 2;
    if (d < bestD) { bestD = d; best = [i, j, k]; }
  }
  return best;
}

export function StructurePanel({ data }: { data: BrainData }) {
  const { structures } = data.manifest;
  const s = useBrain();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ deep: true });
  const q = query.trim().toLowerCase();
  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, items: structures.filter((x) => g.match(x) && (!q || x.name.toLowerCase().includes(q))) })), [structures, q]);

  const select = (st: BrainStructure) => s.set({
    selected: st.index,
    crosshair: centroidOf(data, st.index) ?? s.crosshair,
    focusRequest: { index: st.index, nonce: (s.focusRequest?.nonce ?? 0) + 1 },
    // deep structures sit inside the cortex: make it see-through so the selection is visible
    ...(st.group !== "cortex" && s.cortexOpacity > 0.5 ? { cortexOpacity: 0.2 } : {}),
  });

  return (
    <aside className="flex h-full min-h-0 flex-col" aria-label="Brain structures">
      <PanelHeader title="Structures" count={structures.length} aside={
        <InfoTip label="How structures were labelled" align="right" side="bottom">
          Volumes: voxel counts of each label in this scan (mL). Cortical regions: {structures.some((x) => x.method === "manual") ? "manual labels (DKT31 protocol)" : structures.find((x) => x.group === "cortex")?.method ?? "—"}. Deep structures: FreeSurfer automatic labels, not manually reviewed.
        </InfoTip>
      } />
      <label className="flex items-center gap-2 border-b border-line px-3 py-2">
        <Search className="h-3.5 w-3.5 text-faint" aria-hidden />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find structure" aria-label="Find structure" className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {groups.map((g) => {
          if (!g.items.length) return null;
          const isOpen = q ? true : open[g.id];
          const total = g.items.reduce((a, b) => a + b.volumeMl, 0);
          return (
            <section key={g.id} className="border-b border-line">
              <button className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-medium hover:bg-panel-2" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [g.id]: !isOpen })}>
                <ChevronRight className={cx("h-3.5 w-3.5 text-faint transition-transform", isOpen && "rotate-90")} />
                {g.label}
                <span className="num ml-auto text-[11px] font-normal text-faint">{total.toFixed(1)} mL</span>
              </button>
              {isOpen && (
                <ul className="pb-1">
                  {g.items.map((st) => (
                    <li key={st.index} className={cx("group flex items-center gap-2 pl-7 pr-2 text-[12px]", s.selected === st.index ? "bg-panel-3" : s.hover === st.index ? "bg-panel-2" : "hover:bg-panel-2")}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: rgb(st.colour) }} aria-hidden />
                      <button className="min-w-0 flex-1 truncate py-1 text-left" onClick={() => select(st)} title={`${st.name} — labels ${st.labels.join(", ")} · ${st.method}`}>
                        {st.name.replace(/ \((left|right)\)$/, g.id.startsWith("ctx") ? "" : " ($1)")}
                      </button>
                      <span className="num w-14 shrink-0 text-right text-[11px] text-muted">{st.volumeMl.toFixed(2)}</span>
                      {st.group !== "cortex" && (
                        <button className="shrink-0 rounded p-0.5 text-faint opacity-60 hover:text-ink group-hover:opacity-100" aria-label={s.hidden.has(st.index) ? `Show ${st.name}` : `Hide ${st.name}`} onClick={() => s.toggleHidden(st.index)}>
                          {s.hidden.has(st.index) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}
