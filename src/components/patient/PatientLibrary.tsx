"use client";
import { useMemo, useState } from "react";
import { Columns2, FlaskConical, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { useApp } from "@/state/store";
import { patientTitle } from "@/lib/patients";
import { loadSamples } from "@/lib/session";
import { Button, IconButton, PanelHeader, Pill, cx } from "../ui/primitives";

export function PatientLibrary() {
  const s = useApp();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return s.order.map((k) => s.entries[k]).filter((e) => {
      if (!needle) return true;
      const p = e.patient;
      return [p.patientId, p.studyId, p.displayName ?? "", ...(p.record.diagnoses ?? []).map((d) => d.text)].join(" ").toLowerCase().includes(needle);
    });
  }, [s.order, s.entries, q]);
  const compareMode = s.workspace === "compare";

  return (
    <aside aria-label="Patient library" className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Patients" count={s.order.length} aside={<>
        <IconButton label="Import JSON / CSV" onClick={() => s.set({ dialog: { kind: "import" } })}><Upload className="h-4 w-4" /></IconButton>
        <IconButton label="New patient record" onClick={() => s.set({ dialog: { kind: "editor", key: null } })}><Plus className="h-4 w-4" /></IconButton>
      </>} className="pr-1.5 [&>div]:gap-0.5" />
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
          <input
            aria-label="Search patients"
            placeholder="Search ID, name, diagnosis"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-8 w-full rounded-lg border border-line bg-panel-2 pl-7 pr-2 text-[13px] placeholder:text-faint"
          />
        </div>
      </div>
      {compareMode && (
        <p className="border-b border-line px-3 py-2 text-[12px] text-muted">Select 2–4 records to compare <span className="num">({s.compareKeys.length}/4)</span></p>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto p-2 scroll-thin" data-testid="patient-list">
        {list.map((e) => {
          const p = e.patient;
          const active = s.selectedKey === e.key;
          const warnings = p.issues.filter((i) => i.severity !== "info").length + e.visual.issues.length;
          const inCompare = s.compareKeys.includes(e.key);
          return (
            <li key={e.key} className="group mb-1">
              <div className={cx("flex items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors", active ? "border-line-strong bg-panel-3" : "border-transparent hover:bg-panel-2")}>
                {compareMode && (
                  <input type="checkbox" aria-label={`Compare ${patientTitle(p)}`} className="mt-1 accent-[var(--accent)]" checked={inCompare} disabled={!inCompare && s.compareKeys.length >= 4} onChange={() => s.toggleCompare(e.key)} />
                )}
                <button className="min-w-0 flex-1 text-left" onClick={() => s.select(e.key)} aria-current={active}>
                  <span className="block truncate text-[13px] font-medium">{patientTitle(p)}</span>
                  <span className="num block truncate text-[11px] text-faint">{p.patientId} · {p.studyId}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    {p.synthetic && <Pill tone="info"><FlaskConical className="h-3 w-3" />synthetic</Pill>}
                    {warnings > 0 && <Pill tone="warn">{warnings} warning{warnings > 1 ? "s" : ""}</Pill>}
                    {e.visual.unknowns.length > 0 && <Pill>{e.visual.unknowns.length} unknown</Pill>}
                  </span>
                </button>
                <div className="flex flex-col opacity-60 group-hover:opacity-100 focus-within:opacity-100">
                  <IconButton label={`Edit ${patientTitle(p)}`} className="h-6 w-6" onClick={() => s.set({ dialog: { kind: "editor", key: e.key } })}><Pencil className="h-3.5 w-3.5" /></IconButton>
                  <IconButton label={`Remove ${patientTitle(p)} from session`} className="h-6 w-6 hover:text-error" onClick={() => s.removeEntry(e.key)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                </div>
              </div>
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="p-4 text-center text-[13px] text-muted">
            {s.order.length === 0 ? "No records in this session." : "No records match the search."}
            {s.order.length === 0 && <Button className="mt-3 w-full" onClick={() => loadSamples()}>Load synthetic samples</Button>}
          </li>
        )}
      </ul>
      <div className="border-t border-line p-3">
        <Button variant={compareMode ? "primary" : "outline"} className="w-full" onClick={() => {
          if (compareMode) s.set({ workspace: "single" });
          else s.set({ workspace: "compare", compareKeys: s.compareKeys.length >= 2 ? s.compareKeys : s.order.slice(0, 2) });
        }}>
          <Columns2 className="h-4 w-4" /> {compareMode ? "Back to single view" : "Compare patients"}
        </Button>
      </div>
    </aside>
  );
}
