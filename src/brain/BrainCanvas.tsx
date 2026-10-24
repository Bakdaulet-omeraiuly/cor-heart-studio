"use client";
// 3D brain from the segmentation. Browser-only (next/dynamic, ssr: false).
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { GizmoHelper, GizmoViewport, OrbitControls } from "@react-three/drei";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useBrain } from "./brainStore";
import { appToVoxel, voxelToApp, type Vec3 } from "@/imaging/sliceGeometry";
import type { BrainData } from "./useBrainData";
import { OUTLOOK_TARGET_KEYS, useBrainProjection } from "./BrainOutlook";
import { cortexShiftMm } from "@/domain/outlook/project";

const PLANE_COLOUR = { axial: "#e5484d", coronal: "#46a758", sagittal: "#3e8ed0" };
const HIGHLIGHT = new THREE.Color("#ffd166");
const DIM = new THREE.Color(0.32, 0.34, 0.37);
const tmp = new THREE.Color();

/** Per-vertex colours from the _region attribute; with a selection, everything else is dimmed. */
function paint(geometry: THREE.BufferGeometry, colours: THREE.Color[], selected: number) {
  const reg = geometry.getAttribute("_region") as THREE.BufferAttribute;
  let col = geometry.getAttribute("color") as THREE.BufferAttribute | undefined;
  if (!col) {
    col = new THREE.BufferAttribute(new Float32Array(reg.count * 3), 3);
    geometry.setAttribute("color", col);
  }
  for (let i = 0; i < reg.count; i++) {
    const r = Math.round(reg.getX(i) * 255);
    const base = colours[r] ?? colours[0];
    const c = !selected ? base : r === selected ? tmp.copy(base).lerp(HIGHLIGHT, 0.35) : tmp.copy(base).lerp(DIM, 0.7);
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}

export const regionAt = (geometry: THREE.BufferGeometry, vertex: number) =>
  Math.round(((geometry.getAttribute("_region") as THREE.BufferAttribute).getX(vertex)) * 255);

function BrainMeshes({ data }: { data: BrainData }) {
  const { manifest, meshes } = data;
  const colours = useMemo(() => [new THREE.Color(0.55, 0.55, 0.55), ...manifest.structures.map((s) => new THREE.Color(...s.colour))], [manifest]);
  const selected = useBrain((s) => s.selected);
  const hidden = useBrain((s) => s.hidden);
  const cortexOpacity = useBrain((s) => s.cortexOpacity);
  const set = useBrain((s) => s.set);

  const materials = useMemo(() => ({
    cortex: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0, side: THREE.DoubleSide }),
    deep: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0 }),
  }), []);
  useEffect(() => () => { materials.cortex.dispose(); materials.deep.dispose(); }, [materials]);
  useEffect(() => { for (const m of meshes) paint(m.geometry, colours, selected); }, [meshes, colours, selected]);
  useEffect(() => {
    materials.cortex.transparent = cortexOpacity < 1;
    materials.cortex.opacity = cortexOpacity;
    materials.cortex.depthWrite = cortexOpacity >= 1;
    materials.cortex.needsUpdate = true;
  }, [cortexOpacity, materials]);

  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return; // orbit drag, not a click
    e.stopPropagation();
    // a see-through cortex lets clicks reach the deep structures behind it
    const hit = e.intersections.find((h) => h.object.visible && (cortexOpacity >= 0.5 || (h.object as THREE.Mesh).material !== materials.cortex));
    if (!hit?.face) return;
    const region = regionAt((hit.object as THREE.Mesh).geometry, hit.face.a);
    const ijk = appToVoxel(manifest.volume.voxelToApp, [hit.point.x, hit.point.y, hit.point.z]).map(Math.round) as Vec3;
    set({ selected: region, crosshair: ijk });
  };
  const hover = (e: ThreeEvent<PointerEvent>) => {
    if (!e.face) return;
    e.stopPropagation();
    set({ hover: regionAt((e.object as THREE.Mesh).geometry, e.face.a) });
  };

  return (
    <group>
      {meshes.map((m) => {
        const isCortex = m.name.startsWith("cortex_");
        const index = isCortex ? 0 : manifest.structures.find((s) => s.key === m.name)?.index ?? 0;
        return (
          <mesh
            key={m.name}
            name={m.name}
            geometry={m.geometry}
            material={isCortex ? materials.cortex : materials.deep}
            visible={!hidden.has(index) && !(isCortex && cortexOpacity <= 0.02)}
            renderOrder={isCortex ? 2 : 1}
            onClick={pick}
            onPointerMove={hover}
            onPointerOut={() => set({ hover: 0 })}
          />
        );
      })}
    </group>
  );
}

/** The three MPR planes and the crosshair point, so 3D and slices visibly share one position. */
function SlicePlanes({ data }: { data: BrainData }) {
  const { manifest } = data;
  const crosshair = useBrain((s) => s.crosshair);
  const show = useBrain((s) => s.showPlanes);
  const dims = manifest.volume.dims;
  const c: Vec3 = crosshair ?? [dims[0] / 2, dims[1] / 2, dims[2] / 2];
  const p = voxelToApp(manifest.volume.voxelToApp, c);
  const b = manifest.bounds;
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].map((v) => v + 1);
  const centre = [0, 1, 2].map((i) => (b.max[i] + b.min[i]) / 2);
  if (!show) return null;
  const plane = (key: keyof typeof PLANE_COLOUR, position: Vec3, rotation: Vec3, w: number, h: number) => (
    <mesh key={key} position={position} rotation={rotation} renderOrder={3}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial color={PLANE_COLOUR[key]} transparent opacity={0.12} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
  return (
    <group>
      {plane("axial", [centre[0], p[1], centre[2]], [-Math.PI / 2, 0, 0], size[0], size[2])}
      {plane("coronal", [centre[0], centre[1], p[2]], [0, 0, 0], size[0], size[1])}
      {plane("sagittal", [p[0], centre[1], centre[2]], [0, Math.PI / 2, 0], size[2], size[1])}
      <mesh position={p} renderOrder={4}>
        <sphereGeometry args={[0.18, 16, 12]} />
        <meshBasicMaterial color="#ffd166" depthTest={false} />
      </mesh>
    </group>
  );
}

/** Baseline vertex positions, kept so the outlook deformation is always applied from today's anatomy. */
const basePositions = new WeakMap<THREE.BufferGeometry, Float32Array>();
function base(g: THREE.BufferGeometry) {
  let p = basePositions.get(g);
  if (!p) { p = (g.getAttribute("position").array as Float32Array).slice(); basePositions.set(g, p); }
  return p;
}

/** Outlook: scale hippocampi/ventricles about their centre, move the cortex inward (see BrainOutlook.tsx). */
function OutlookDeform({ data }: { data: BrainData }) {
  const proj = useBrainProjection(data.manifest);
  useEffect(() => {
    for (const m of data.meshes) {
      const isCortex = m.name.startsWith("cortex_");
      const target = isCortex ? "cortex" : OUTLOOK_TARGET_KEYS.hippocampus(m.name) ? "hippocampus" : OUTLOOK_TARGET_KEYS.ventricles(m.name) ? "ventricles" : null;
      if (!target) continue;
      const b = base(m.geometry);
      const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
      const out = pos.array as Float32Array;
      const ratio = proj?.[target].ratio ?? 1;
      if (isCortex) {
        const nrm = m.geometry.getAttribute("normal") as THREE.BufferAttribute;
        // computed normals may face either way: orient "inward" toward the mesh centre
        let cx = 0, cy = 0, cz = 0;
        const n = b.length / 3;
        for (let i = 0; i < n; i++) { cx += b[3 * i]; cy += b[3 * i + 1]; cz += b[3 * i + 2]; }
        cx /= n; cy /= n; cz /= n;
        let facing = 0;
        for (let i = 0; i < n; i += 97) facing += (b[3 * i] - cx) * nrm.getX(i) + (b[3 * i + 1] - cy) * nrm.getY(i) + (b[3 * i + 2] - cz) * nrm.getZ(i);
        const d = -(cortexShiftMm(ratio) / 10) * Math.sign(facing || 1); // app frame is in cm
        for (let i = 0; i < n; i++) {
          out[3 * i] = b[3 * i] + d * nrm.getX(i);
          out[3 * i + 1] = b[3 * i + 1] + d * nrm.getY(i);
          out[3 * i + 2] = b[3 * i + 2] + d * nrm.getZ(i);
        }
      } else {
        const s = Math.cbrt(ratio);
        const n = b.length / 3;
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < n; i++) { cx += b[3 * i]; cy += b[3 * i + 1]; cz += b[3 * i + 2]; }
        cx /= n; cy /= n; cz /= n;
        for (let i = 0; i < n; i++) {
          out[3 * i] = cx + (b[3 * i] - cx) * s;
          out[3 * i + 1] = cy + (b[3 * i + 1] - cy) * s;
          out[3 * i + 2] = cz + (b[3 * i + 2] - cz) * s;
        }
      }
      pos.needsUpdate = true;
      m.geometry.computeBoundingSphere();
      m.geometry.computeBoundingBox();
    }
  }, [data, proj]);
  return null;
}

/** Centroid (app frame, cm) of every vertex carrying a structure's region id. */
function regionCentroid(data: BrainData, index: number): THREE.Vector3 | null {
  const c = new THREE.Vector3();
  let n = 0;
  for (const m of data.meshes) {
    const reg = m.geometry.getAttribute("_region") as THREE.BufferAttribute;
    const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < reg.count; i++) {
      if (Math.round(reg.getX(i) * 255) !== index) continue;
      c.x += pos.getX(i); c.y += pos.getY(i); c.z += pos.getZ(i); n++;
    }
  }
  return n ? c.divideScalar(n) : null;
}

/** Animates the orbit camera to look at a structure chosen in the list, from the side it is on. */
function CameraFocus({ data }: { data: BrainData }) {
  const request = useBrain((s) => s.focusRequest);
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const anim = useRef<{ fromPos: THREE.Vector3; toPos: THREE.Vector3; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; t: number } | null>(null);
  useEffect(() => {
    if (!request || !controls) return;
    const target = regionCentroid(data, request.index);
    if (!target) return;
    const st = data.manifest.structures[request.index - 1];
    // look from outside the structure's side: lateral for one hemisphere, else from the structure's direction
    const dir = target.clone();
    if (st?.hemisphere === "left") dir.x += 6;
    if (st?.hemisphere === "right") dir.x -= 6;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
    dir.normalize();
    const distance = camera.position.distanceTo(controls.target);
    anim.current = { fromPos: camera.position.clone(), toPos: target.clone().addScaledVector(dir, distance), fromTarget: controls.target.clone(), toTarget: target, t: 0 };
  }, [request, data, camera, controls]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + dt / 0.7);
    const k = 1 - Math.pow(1 - a.t, 3);
    camera.position.lerpVectors(a.fromPos, a.toPos, k);
    controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

export default function BrainCanvas({ data }: { data: BrainData }) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 30, position: [-34, 8, 22], near: 0.5, far: 400 }}
      gl={{ antialias: true }}
      aria-label="Interactive 3D brain built from the MRI segmentation. Use the structure list and slice views for keyboard access."
      data-testid="brain-canvas"
    >
      <color attach="background" args={["#07090c"]} />
      <hemisphereLight args={["#dfe7f2", "#20242b", 0.9]} />
      <directionalLight position={[-20, 30, 25]} intensity={1.4} />
      <directionalLight position={[25, -10, -20]} intensity={0.5} />
      <BrainMeshes data={data} />
      <OutlookDeform data={data} />
      <SlicePlanes data={data} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={10} maxDistance={90} />
      <CameraFocus data={data} />
      <GizmoHelper alignment="bottom-right" margin={[56, 56]}>
        <GizmoViewport axisColors={["#e8836b", "#8fbf7f", "#79b0ff"]} labels={["L", "S", "A"]} labelColor="#0b0d10" axisHeadScale={0.9} />
      </GizmoHelper>
    </Canvas>
  );
}

