"use client";
// Single-patient WebGL canvas. Browser-only: imported through next/dynamic with ssr:false.
import { Canvas, useThree } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { PatientEntry } from "@/lib/patients";
import { useApp } from "@/state/store";
import { CameraRig } from "./CameraRig";
import { HeartModel } from "./HeartModel";
import { SceneEnvironment } from "./SceneEnvironment";
import { FrameProbe } from "./FrameProbe";
import type { HeartAsset } from "./asset-adapters/heartAsset";
import type { HeartAssetSpec } from "./asset-adapters/registry";
import type { Tier } from "./performance/quality";

export const sceneHandles: { gl: THREE.WebGLRenderer | null; scene: THREE.Scene | null; camera: THREE.Camera | null } = { gl: null, scene: null, camera: null };

function Handles() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    sceneHandles.gl = gl; sceneHandles.scene = scene; sceneHandles.camera = camera;
    return () => { sceneHandles.gl = null; sceneHandles.scene = null; sceneHandles.camera = null; };
  }, [gl, scene, camera]);
  return null;
}

export function snapshotPng(): string | null {
  const { gl, scene, camera } = sceneHandles;
  if (!gl || !scene || !camera) return null;
  gl.render(scene, camera);
  return gl.domElement.toDataURL("image/png");
}

export default function HeartCanvas({ entry, spec, asset, pickAsset, tier, onContextLost }: { entry: PatientEntry; spec: HeartAssetSpec; asset: HeartAsset; pickAsset: HeartAsset; tier: Tier; onContextLost: () => void }) {
  const theme = useApp((s) => s.theme);
  // R3F forces a context loss when the canvas unmounts (e.g. switching to a patient with another heart
  // asset); only a loss while mounted is a real GPU reset.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return (
    <Canvas
      dpr={tier.dpr}
      camera={{ fov: 30, position: [0, 0, 46], near: 0.5, far: 400 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
        gl.toneMappingExposure = 1.05;
        gl.domElement.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (mounted.current) onContextLost(); });
      }}
      onPointerMissed={() => useApp.getState().selectStructure(null)}
      aria-label="Interactive 3D heart. Use the structure list and controls outside the canvas for keyboard access."
    >
      <Handles />
      <FrameProbe />
      <SceneEnvironment theme={theme} shadows={tier.shadows} />
      <HeartModel entry={entry} spec={spec} asset={asset} pickAsset={pickAsset} clockId="main" />
      <CameraRig id="main" spec={spec} />
      <GizmoHelper alignment="bottom-right" margin={[64, 112]}>
        <GizmoViewport axisColors={["#e8836b", "#8fbf7f", "#79b0ff"]} labels={["L", "S", "A"]} labelColor="#0b0d10" axisHeadScale={0.9} />
      </GizmoHelper>
    </Canvas>
  );
}
