"use client";
import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useApp } from "@/state/store";
import type { HeartAssetSpec } from "./asset-adapters/registry";
import { sceneFrame, type CameraPose } from "./geometry/sceneFrame";

export interface CameraSync {
  version: number;
  source: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
  up: THREE.Vector3;
}
export const cameraSync: CameraSync = { version: 0, source: "", position: new THREE.Vector3(0, 0, 34), target: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0) };

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Orbit/pan/zoom with animated anatomical presets; optional camera synchronisation between views. */
export function CameraRig({ id, spec, sync = false, distanceScale = 1 }: { id: string; spec: HeartAssetSpec; sync?: boolean; distanceScale?: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const anim = useRef<{ from: CameraPose; to: CameraPose; t: number } | null>(null);
  const seen = useRef(0);
  const active = useRef(false);
  const endTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const request = useApp((s) => s.cameraRequest);

  useEffect(() => {
    if (!request || !controls.current) return;
    const to = sceneFrame(spec).cameraPose(request.preset);
    to.position.sub(to.target).multiplyScalar(distanceScale).add(to.target);
    const from = { position: camera.position.clone(), target: controls.current.target.clone(), up: camera.up.clone() };
    anim.current = { from, to, t: reducedMotion() ? 1 : 0 };
  }, [request, camera, distanceScale, spec]);

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
    const a = anim.current;
    if (a) {
      a.t = Math.min(1, a.t + dt / 0.65);
      const k = a.t < 1 ? 1 - Math.pow(1 - a.t, 3) : 1;
      camera.position.lerpVectors(a.from.position, a.to.position, k);
      c.target.lerpVectors(a.from.target, a.to.target, k);
      camera.up.lerpVectors(a.from.up, a.to.up, k).normalize();
      camera.lookAt(c.target);
      c.update();
      if (a.t >= 1) anim.current = null;
      if (sync) publish();
    } else if (sync && cameraSync.version !== seen.current && cameraSync.source !== id) {
      seen.current = cameraSync.version;
      camera.position.copy(cameraSync.position);
      camera.up.copy(cameraSync.up);
      c.target.copy(cameraSync.target);
      c.update();
    }
  });

  function publish() {
    const c = controls.current;
    if (!c) return;
    cameraSync.version++;
    seen.current = cameraSync.version;
    cameraSync.source = id;
    cameraSync.position.copy(camera.position);
    cameraSync.target.copy(c.target);
    cameraSync.up.copy(camera.up);
  }

  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      minDistance={4}
      maxDistance={90}
      onStart={() => { active.current = true; if (endTimer.current) clearTimeout(endTimer.current); }}
      onEnd={() => { endTimer.current = setTimeout(() => { active.current = false; }, 600); }}
      onChange={() => { if (sync && active.current && !anim.current) publish(); }}
    />
  );
}
