"use client";
import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Brain, HeartPulse, Moon, ShieldCheck, Sun } from "lucide-react";
import { useApp, type Module } from "@/state/store";
import { loadSamples } from "@/lib/session";
import { PatientLibrary } from "../patient/PatientLibrary";
import { Inspector } from "../inspector/Inspector";
import { ImportDialog } from "../import/ImportDialog";
import { PatientEditor } from "../patient/PatientEditor";
import { CompareWorkspace } from "../comparison/CompareWorkspace";
import { IconButton } from "../ui/primitives";
import { HeartViewport } from "./HeartViewport";

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

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) useApp.getState().set({ playing: false });
    if (window.matchMedia?.("(prefers-color-scheme: light)").matches) useApp.getState().set({ theme: "light" });
    if (useApp.getState().order.length === 0) void loadSamples();
  }, []);

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-accent-ink" aria-hidden>C</span>
          <h1 className="text-[14px] font-semibold tracking-tight">COR Studio</h1>
          <span className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint xl:inline">Visualization demo · not a medical device</span>
        </div>
        <nav className="ml-2 flex h-full items-stretch" aria-label="Organ module">
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
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 text-[11px] text-muted md:flex" title="Records are kept in memory for this tab only. Nothing is uploaded, stored in the browser, put in URLs, or logged.">
            <ShieldCheck className="h-3.5 w-3.5 text-ok" /> Session-only · processed locally
          </span>
          <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => set({ theme: theme === "dark" ? "light" : "dark" })}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
        </div>
      </header>
      {organ === "brain" ? <div className="min-h-0 flex-1"><BrainWorkspace /></div> : (
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(420px,68dvh)_auto_auto] overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_360px] lg:grid-rows-1 lg:overflow-hidden">
        <div className="order-2 min-h-0 border-line bg-panel lg:order-1 lg:border-r"><PatientLibrary /></div>
        <main className="order-1 min-h-0 lg:order-2" aria-label="3D heart workspace">
          {workspace === "compare" ? <CompareWorkspace /> : <HeartViewport />}
        </main>
        <div className="order-3 min-h-0 border-line bg-panel lg:border-l"><Inspector /></div>
      </div>
      )}
      {dialog?.kind === "import" && <ImportDialog />}
      {dialog?.kind === "editor" && <PatientEditor editKey={dialog.key} />}
    </div>
  );
}
