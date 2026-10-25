"use client";

import { useRef, useState } from "react";
import { Brain, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useOutlook } from "@/outlook/outlookStore";
import { useBrain } from "./brainStore";
import { identifyBrainDemo } from "./identifyBrainDemo";

export function BrainUpload() {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return <div className="shrink-0 border-b border-line p-2">
    <input ref={input} type="file" accept=".zip,.nii,.nii.gz,application/zip" className="sr-only" aria-label="Brain MRI DICOM ZIP or NIfTI" onChange={async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const kind = await identifyBrainDemo(file);
        useBrain.getState().set({ uploadedScan: { name: file.name, kind }, selected: 0, hover: 0 });
        useOutlook.getState().set({ open: false });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not identify this MRI study.");
      } finally {
        setBusy(false);
      }
    }} />
    <Button variant="primary" className="w-full" disabled={busy} onClick={() => input.current?.click()}><Brain className="h-4 w-4" /> {busy ? "Opening brain MRI…" : "Upload MRI DICOM ZIP or NIfTI"}</Button>
    <p className="mt-1 text-[11px] leading-4 text-muted">Open brain MRI demo · matching scan-derived 3D model</p>
    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-info underline underline-offset-2">
      <a href="/samples/open-brain-mmr21-mri-dicom.zip" download>DICOM ZIP</a>
      <a href="/samples/open-brain-mmr21-mri.nii.gz" download>MRI NIfTI</a>
      <a href="/samples/open-brain-mmr21-segmentation.nii.gz" download>Label NIfTI</a>
    </div>
    {busy && <p role="status" className="mt-2 flex items-center gap-1.5 text-[11px] text-info"><Loader2 className="h-3 w-3 animate-spin" /> Matching MRI to its 3D asset…</p>}
    {error && <p role="alert" className="mt-1 text-[11px] text-error">{error}</p>}
  </div>;
}
