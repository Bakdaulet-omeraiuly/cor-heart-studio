"use client";
import { useEffect } from "react";
import { HeartPulse, Moon, ShieldCheck, Sun } from "lucide-react";
import { useApp } from "@/state/store";
import { loadSamples } from "@/lib/session";
import { PatientLibrary } from "../patient/PatientLibrary";
import { Inspector } from "../inspector/Inspector";
import { ImportDialog } from "../import/ImportDialog";
import { PatientEditor } from "../patient/PatientEditor";
import { CompareWorkspace } from "../comparison/CompareWorkspace";
import { IconButton } from "../ui/primitives";
import { HeartViewport } from "./HeartViewport";

export default function Workspace() {
  const theme = useApp((s) => s.theme);
  const workspace = useApp((s) => s.workspace);
  const dialog = useApp((s) => s.dialog);
  const set = useApp((s) => s.set);

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
          <HeartPulse className="h-5 w-5 text-accent" aria-hidden />
          <h1 className="text-[14px] font-semibold tracking-tight">COR Heart Studio</h1>
          <span className="hidden rounded-md border border-line px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-faint sm:inline">Visualization demo · not a medical device</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1 text-[11px] text-muted md:flex" title="Records are kept in memory for this tab only. Nothing is uploaded, stored in the browser, put in URLs, or logged.">
            <ShieldCheck className="h-3.5 w-3.5 text-ok" /> Session-only · processed locally
          </span>
          <IconButton label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} onClick={() => set({ theme: theme === "dark" ? "light" : "dark" })}>
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </IconButton>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(420px,68dvh)_auto_auto] overflow-y-auto lg:grid-cols-[260px_minmax(0,1fr)_360px] lg:grid-rows-1 lg:overflow-hidden">
        <div className="order-2 min-h-0 border-line bg-panel lg:order-1 lg:border-r"><PatientLibrary /></div>
        <main className="order-1 min-h-0 lg:order-2" aria-label="3D heart workspace">
          {workspace === "compare" ? <CompareWorkspace /> : <HeartViewport />}
        </main>
        <div className="order-3 min-h-0 border-line bg-panel lg:border-l"><Inspector /></div>
      </div>
      {dialog?.kind === "import" && <ImportDialog />}
      {dialog?.kind === "editor" && <PatientEditor editKey={dialog.key} />}
    </div>
  );
}
