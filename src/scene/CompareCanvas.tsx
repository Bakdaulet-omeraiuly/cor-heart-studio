"use client";
// One WebGL context shared by up to four viewports (drei <View>), instead of one context per patient.
import { Canvas } from "@react-three/fiber";
import { PerspectiveCamera, View } from "@react-three/drei";
import { useRef } from "react";
import { patientTitle, type PatientEntry } from "@/lib/patients";
import { useApp } from "@/state/store";
import { CameraRig } from "./CameraRig";
import { HeartModel } from "./HeartModel";
import { SceneEnvironment } from "./SceneEnvironment";
import type { HeartAsset } from "./asset-adapters/heartAsset";
import { getHeartAssetSpec } from "./asset-adapters/registry";
import { usePhase } from "@/components/workspace/PlaybackBar";
import { PHASE_NAMES, sampleCycle } from "@/domain/mapping/cycle";

function fitScale(e: PatientEntry) {
  const v = e.visual;
  return 1 / Math.max(1, v.lv.edRadialEpi * 0.85 + 0.15, v.lv.edLong, v.rv.edRadial * 0.5 + 0.5, v.la.edScale * 0.4 + 0.6);
}

function ViewHeader({ entry, index }: { entry: PatientEntry; index: number }) {
  const mode = useApp((s) => s.syncMode);
  const phase = usePhase(`cmp-${index}`);
  const p = entry.visual.timing;
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-lg border border-line bg-panel/85 px-2 py-1 text-[11px] backdrop-blur">
      <div className="font-medium text-ink">{patientTitle(entry.patient)}</div>
      <div className="num text-muted">{p.heartRateBpm} bpm{p.evidence === "default_unknown" ? " (default)" : ""} · {PHASE_NAMES[sampleCycle(p.phases, phase).phase]}{mode === "phase" && index > 0 ? " · phase-synced" : ""}</div>
    </div>
  );
}

export default function CompareCanvas({ entries, assets, syncCamera, sharedScale }: { entries: PatientEntry[]; assets: Record<string, HeartAsset>; syncCamera: boolean; sharedScale: boolean }) {
  const container = useRef<HTMLDivElement>(null!);
  const theme = useApp((s) => s.theme);
  const cols = entries.length <= 2 ? "md:grid-cols-2" : "md:grid-cols-2";
  return (
    <div ref={container} className="relative h-full w-full">
      <div className={`grid h-full grid-cols-1 ${cols} ${entries.length > 2 ? "md:grid-rows-2" : ""}`}>
        {entries.map((e, i) => {
          const spec = getHeartAssetSpec(e.assetId);
          const asset = assets[spec.id];
          return (
            <div key={e.key} className="relative min-h-[240px] border-b border-r border-line" data-testid="compare-view">
              <View className="absolute inset-0">
                <PerspectiveCamera makeDefault fov={30} position={[0, 0, 46]} near={0.5} far={400} />
                <SceneEnvironment theme={theme} shadows={false} />
                {asset && <HeartModel entry={e} spec={spec} asset={asset} pickAsset={asset} clockId={`cmp-${i}`} primaryClockId="cmp-0" scale={sharedScale ? 1 : fitScale(e)} showLabels={false} />}
                <CameraRig id={`cmp-${i}`} spec={spec} sync={syncCamera} />
              </View>
              <ViewHeader entry={e} index={i} />
            </div>
          );
        })}
      </div>
      <Canvas
        eventSource={container}
        className="!pointer-events-none"
        style={{ position: "absolute", inset: 0 }}
        dpr={[1, 1.5]}
        onCreated={({ gl }) => { gl.localClippingEnabled = true; }}
      >
        <View.Port />
      </Canvas>
    </div>
  );
}
