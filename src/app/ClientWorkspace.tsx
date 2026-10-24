"use client";
import dynamic from "next/dynamic";

// The whole workspace is browser-only (WebGL, File API, session state); never rendered on the server.
const Workspace = dynamic(() => import("@/components/workspace/Workspace"), {
  ssr: false,
  loading: () => <div className="flex h-dvh items-center justify-center text-[13px] text-[var(--muted)]">Loading COR Studio…</div>,
});

export function ClientWorkspace() {
  return <Workspace />;
}
