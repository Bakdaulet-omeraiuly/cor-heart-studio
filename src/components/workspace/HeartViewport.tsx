"use client";
import dynamic from "next/dynamic";
import { useMemo, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Loader2, RotateCcw } from "lucide-react";
import { useApp } from "@/state/store";
import { useHeartAssets } from "@/scene/useHeartAssets";
import { getHeartAssetSpec } from "@/scene/asset-adapters/registry";
import { detectTier, webglAvailable } from "@/scene/performance/quality";
import { Button } from "../ui/primitives";
import { Fallback2D } from "./Fallback2D";
import { SceneToolbar } from "./SceneToolbar";
import { PlaybackBar } from "./PlaybackBar";
import { Legend } from "./Legend";
import { GeometryBadge } from "./GeometryBadge";
import { CtEvidencePanel } from "./CtEvidencePanel";
import { HeartMetrics } from "./HeartMetrics";
import { EcgStrip } from "./EcgStrip";

const HeartCanvas = dynamic(() => import("@/scene/HeartCanvas"), { ssr: false });

const subscribeNoop = () => () => {};
export function useWebgl() {
  return useSyncExternalStore(subscribeNoop, webglAvailable, () => true);
}

export function HeartViewport() {
  const entry = useApp((s) => (s.selectedKey ? s.entries[s.selectedKey] : null));
  const quality = useApp((s) => s.quality);
  const tier = useMemo(() => detectTier(quality), [quality]);
  const spec = getHeartAssetSpec(entry?.assetId);
  const assets = useHeartAssets(spec, tier.lod === "high");
  const webgl = useWebgl();
  const [lost, setLost] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [forceFallback, setForceFallback] = useState(false);

  if (!entry) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <p className="text-[15px] font-medium">No patient selected</p>
          <p className="mt-1 text-[13px] text-muted">Load the synthetic samples, import a JSON/CSV file, or enter a record manually from the patient panel.</p>
        </div>
      </div>
    );
  }
  if (!webgl || forceFallback) {
    return <Fallback2D entry={entry} reason={!webgl ? "WebGL 2 is not available in this browser, so the 3D scene cannot start." : "2D data view selected."} onRetry={webgl ? () => setForceFallback(false) : undefined} />;
  }
  if (assets.error) {
    return <Fallback2D entry={entry} reason={`The anatomical asset failed to load: ${assets.error}`} />;
  }
  const asset = assets.high ?? assets.low;
  return (
    <div className="flex h-full w-full">
      <div className="flex h-full min-w-0 flex-1 flex-col" data-testid="viewport">
        <SceneToolbar onFallback={() => setForceFallback(true)} tierName={tier.name} lod={assets.high ? "high" : "low"} />
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#050608]">
          {asset && assets.low && !lost && (
            <HeartCanvas key={`${canvasKey}:${spec.id}`} entry={entry} spec={spec} asset={asset} pickAsset={assets.low} tier={tier} onContextLost={() => setLost(true)} />
          )}
          {!assets.low && (
            <div className="absolute inset-0 flex items-center justify-center" role="status">
              <div className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-[13px] text-muted shadow">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading anatomical asset…
              </div>
            </div>
          )}
          {lost && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg/80" role="alert">
              <div className="max-w-sm rounded-xl border border-line bg-panel p-4 text-[13px] shadow-lg">
                <p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-warn" /> The 3D graphics context was lost</p>
                <p className="mt-1 text-muted">This can happen when the GPU is reset or memory is low. Patient data is unaffected.</p>
                <div className="mt-3 flex gap-2">
                  <Button variant="primary" onClick={() => { setLost(false); setCanvasKey((k) => k + 1); }}><RotateCcw className="h-3.5 w-3.5" /> Restore 3D</Button>
                  <Button onClick={() => { setLost(false); setForceFallback(true); }}>Use 2D view</Button>
                </div>
              </div>
            </div>
          )}
          {/* corner text: provenance (bottom-left) and legend, docked like imaging-viewer overlays */}
          <div className="pointer-events-none absolute bottom-2 left-2 z-20 flex max-w-[min(420px,70%)] flex-col items-start gap-1.5">
            <Legend />
            <GeometryBadge spec={spec} />
          </div>
        </div>
        <HeartMetrics entry={entry} spec={spec} />
        <EcgStrip entry={entry} />
        <PlaybackBar />
      </div>
      {spec.manifest.imaging && <CtEvidencePanel spec={spec} />}
    </div>
  );
}
