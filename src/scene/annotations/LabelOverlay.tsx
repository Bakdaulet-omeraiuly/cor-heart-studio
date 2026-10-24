"use client";
// Structure-bound labels projected from live 3D anchors every frame, with BVH ray occlusion and clip-plane
// awareness. Plain DOM nodes updated imperatively (no React work per frame, no per-label React roots).
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { STRUCTURE_LABEL, type StructureId } from "@/domain/mapping/types";

export interface LabelAnchor {
  id: StructureId;
  position: THREE.Vector3; // world space, updated by the owner each frame
  visible: boolean; // owner-side visibility (layer/hidden/clip)
  occludable: boolean;
}

/**
 * `enabled` shows every label (Layers › Structure labels, key L). Otherwise only the hovered and the
 * selected structure are labelled, so the image stays clean (imaging-viewer convention).
 */
export function LabelOverlay({ anchors, occluder, enabled, selected, hover }: { anchors: LabelAnchor[]; occluder: React.RefObject<THREE.Mesh | null>; enabled: boolean; selected: StructureId | null; hover?: StructureId | null }) {
  const { camera, gl, size } = useThree();
  const nodes = useRef(new Map<StructureId, HTMLSpanElement>());
  const occluded = useRef(new Map<StructureId, boolean>());
  const frame = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const container = useMemo(() => {
    if (typeof document === "undefined") return null;
    const d = document.createElement("div");
    d.setAttribute("aria-hidden", "true"); // the accessible structure list lives outside the canvas
    d.style.cssText = "position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:5";
    return d;
  }, []);

  useEffect(() => {
    const parent = gl.domElement.parentElement;
    if (!parent || !container) return;
    parent.appendChild(container);
    return () => { container.remove(); };
  }, [gl, container]);

  useEffect(() => {
    if (!container) return;
    const map = nodes.current;
    for (const a of anchors) {
      if (map.has(a.id)) continue;
      const el = document.createElement("span");
      el.className = "structure-label";
      el.dataset.structure = a.id;
      el.textContent = STRUCTURE_LABEL[a.id];
      el.style.cssText = "position:absolute;left:0;top:0;will-change:transform;opacity:0";
      container.appendChild(el);
      map.set(a.id, el);
    }
    return () => { for (const el of map.values()) el.remove(); map.clear(); };
  }, [anchors, container]);

  useEffect(() => {
    for (const [id, el] of nodes.current) el.classList.toggle("is-selected", id === selected);
  }, [selected]);

  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    frame.current++;
    const checkOcclusion = frame.current % 6 === 0;
    for (const a of anchors) {
      const el = nodes.current.get(a.id);
      if (!el) continue;
      if (!(enabled || a.id === selected || a.id === hover) || !a.visible) { el.style.opacity = "0"; continue; }
      v.copy(a.position).project(camera);
      if (v.z > 1 || v.z < -1) { el.style.opacity = "0"; continue; }
      if (checkOcclusion && a.occludable && occluder.current) {
        const dir = a.position.clone().sub(camera.position);
        const dist = dir.length();
        ray.set(camera.position, dir.normalize());
        ray.far = dist - 0.25;
        (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
        occluder.current.updateMatrixWorld();
        occluded.current.set(a.id, ray.intersectObject(occluder.current, false).length > 0);
      }
      const hidden = a.occludable && occluded.current.get(a.id);
      const x = (v.x * 0.5 + 0.5) * size.width, y = (-v.y * 0.5 + 0.5) * size.height;
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.opacity = hidden ? "0" : "1";
    }
  });
  return null;
}
