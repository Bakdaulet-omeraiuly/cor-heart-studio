"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Brain, HeartPulse, Hourglass, Moon, PanelRightClose, PanelRightOpen, ShieldCheck, Sun } from "lucide-react";
import { useApp, type Module } from "@/state/store";
import { loadSamples } from "@/lib/session";
import { PatientLibrary } from "../patient/PatientLibrary";
import { ImportDialog } from "../import/ImportDialog";
import { PatientEditor } from "../patient/PatientEditor";
import { CompareWorkspace } from "../comparison/CompareWorkspace";
import { IconButton } from "../ui/primitives";
import { HeartViewport } from "./HeartViewport";
import { ContextBar } from "./ContextBar";
import { InspectorColumn } from "./InspectorColumn";
import { useOutlook } from "@/outlook/outlookStore";
import { useBrain } from "@/brain/brainStore";
import { HeartOutlook } from "@/outlook/HeartOutlook";

const BrainWorkspace = dynamic(() => import("@/brain/BrainWorkspace").then((m) => m.BrainWorkspace), { ssr: false });

const MODULES: { id: Module; label: string; icon: typeof HeartPulse }[] = [
  { id: "heart", label: "Heart", icon: HeartPulse },
  { id: "brain", label: "Brain", icon: Brain },
];

export default function Workspace() {
  const theme = useApp((s) => s.theme);
  const workspace = useApp((s) => s.workspace);
  const dialog = useApp((s) => s.dialog);
  const set = useApp((s) => s.set);
  const organ = useApp((s) => s.module);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const inspectorWidth = useApp((s) => s.inspectorWidth);
  const outlookOpen = useOutlook((s) => s.open);
  const toggleOutlook = () => {
    const open = !outlookOpen;
    useOutlook.getState().set({ open });
    // the outlook brings its own side panel: give the two hearts the inspector's width
    if (open && organ === "heart") set({ inspectorOpen: false });
    // inner structures carry the brain outlook: make the cortex see-through and clear the slice planes
    if (open && organ === "brain") {
      const b = useBrain.getState();
      b.set({ showPlanes: false, ...(b.cortexOpacity > 0.5 ? { cortexOpacity: 0.3 } : {}) });
    }
  };

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) useApp.getState().set({ playing: false });
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) useApp.getState().set({ theme: "light" });
    if (useApp.getState().order.length === 0) void loadSamples();
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-line bg-panel pl-3 pr-2">
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-ink" aria-hidden>C</span>
          <h1 className="text-[14px] font-semibold tracking-tight">COR Studio</h1>
        </div>
        <nav className="flex h-full shrink-0 items-stretch" aria-label="Organ module" role="tablist">
          {MODULES.map((m) => (
            <button
              key={m.id}
              role="tab"
              aria-selected={organ === m.id}
              onClick={() => set({ module: m.id })}
              className={`relative flex items-center gap-1.5 px-3 text-[13px] ${organ === m.id ? "font-medium text-ink after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent" : "text-muted hover:text-ink"}`}
            >
              <m.icon className="h-4 w-4" aria-hidden /> {m.label}
            </button>
          ))}
        </nav>
        <span className="h-5 w-px shrink-0 bg-line" aria-hidden />
        <div className="min-w-0 flex-1"><ContextBar /></div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="hidden text-[10px] uppercase tracking-wider text-faint 2xl:inline">Visualization demo · not a medical device</span>
          <span className="flex items-center gap-1 text-[11px] text-muted" title="Records are kept in memory for this tab only. Nothing is uploaded, stored in the browser, put in URLs, or logged.">
            <ShieldCheck className="h-3.5 w-3.5 text-ok" /> <span className="hidden lg:inline">Session-only</span>
          </span>
          <button
            onClick={toggleOutlook}
            aria-pressed={outlookOpen}
            title="Outlook: today's anatomy projected with published average rates of change (open / close)"
            data-testid="outlook-toggle"
            className={`flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium ${outlookOpen ? "border-accent bg-accent text-accent-ink" : "border-line text-muted hover:text-ink"}`}
          >
            <Hourglass className="h-3.5 w-3.5" aria-hidden /> Outlook
          </button>
          {organ === "heart" && (
            <IconButton label={inspectorOpen ? "Hide inspector" : "Show inspector"} pressed={!inspectorOpen} onClick={() => set({ inspectorOpen: !inspectorOpen })}>
              {inspectorOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
            </IconButton>
          )}
          <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => set({ theme: theme === "dark" ? "light" : "dark" })}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
        </div>
      </header>
      {organ === "brain" ? <main className="min-h-0 flex-1" aria-label="Brain workspace"><BrainWorkspace /></main> : (
      <div
        className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(420px,68dvh)_auto_auto] overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_var(--inspector-w)] lg:grid-rows-1 lg:overflow-hidden"
        style={{ "--inspector-w": inspectorOpen ? `${inspectorWidth}px` : "32px" } as React.CSSProperties}
      >
        <div className="order-2 min-h-0 border-line bg-panel lg:order-1 lg:border-r"><PatientLibrary /></div>
        <main className="order-1 min-h-0 lg:order-2" aria-label="3D heart workspace">
          {outlookOpen ? <HeartOutlook /> : workspace === "compare" ? <CompareWorkspace /> : <HeartViewport />}
        </main>
        <InspectorColumn />
      </div>
      )}
      {dialog?.kind === "import" && <ImportDialog />}
      {dialog?.kind === "editor" && <PatientEditor editKey={dialog.key} />}
    </div>
  );
}
