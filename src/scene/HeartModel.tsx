"use client";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { acceleratedRaycast, MeshBVH } from "three-mesh-bvh";
import { sampleCycle, type CycleSample } from "@/domain/mapping/cycle";
import type { StructureId } from "@/domain/mapping/types";
import type { PatientEntry } from "@/lib/patients";
import { useApp } from "@/state/store";
import { specCenter, type HeartAsset } from "./asset-adapters/heartAsset";
import type { HeartAssetSpec } from "./asset-adapters/registry";
import { advance, getClock, notifyPhase } from "./animation/clock";
import { deformPoint, frameParams, lvCoords, restParams, segmentAt } from "./animation/deform";
import { DISABLED_PLANE, sceneFrame } from "./geometry/sceneFrame";
import { appToVoxel, voxelToApp, type Vec3 } from "@/imaging/sliceGeometry";
import { useCtSlices } from "./ctSlices";
import { LabelOverlay, type LabelAnchor } from "./annotations/LabelOverlay";
import { FlowRig } from "./layers/FlowRig";
import { ValveRig } from "./layers/ValveRig";
import { applyDeformUniforms, createTissueMaterial, createTissueUniforms } from "./materials/tissueMaterial";

export const REGION_STRUCTURES: StructureId[] = ["lv", "rv", "la", "ra", "aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins", "coronary_vessels"];
const LABELLED: StructureId[] = ["lv", "rv", "la", "ra", "aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins", "coronary_vessels", "mitral_valve", "aortic_valve", "tricuspid_valve", "pulmonary_valve"];
const VALVES = new Set<StructureId>(["mitral_valve", "aortic_valve", "tricuspid_valve", "pulmonary_valve"]);
const CHAMBERS = new Set<StructureId>(["lv", "rv", "la", "ra"]);

export interface HeartModelProps {
  entry: PatientEntry;
  /** Asset the entry is rendered with; `asset`/`pickAsset` must be loaded from it. */
  spec: HeartAssetSpec;
  asset: HeartAsset;
  pickAsset: HeartAsset;
  clockId: string;
  primaryClockId?: string; // phase-sync source in comparison mode
  interactive?: boolean;
  scale?: number;
  showLabels?: boolean;
}

export function HeartModel({ entry, spec, asset, pickAsset, clockId, primaryClockId, interactive = true, scale = 1, showLabels = true }: HeartModelProps) {
  const visual = entry.visual;
  const uniforms = useMemo(() => createTissueUniforms(), []);
  const plane = useMemo(() => new THREE.Plane().copy(DISABLED_PLANE), []);
  const clipping = useMemo(() => [plane], [plane]);
  const tissueMat = useMemo(() => createTissueMaterial(uniforms, { clippingPlanes: clipping }), [uniforms, clipping]);
  const ghostMat = useMemo(() => createTissueMaterial(uniforms, { clippingPlanes: clipping, ghost: true }), [uniforms, clipping]);
  const manifest = spec.manifest;
  const center = useMemo(() => specCenter(spec), [spec]);
  const frame = sceneFrame(spec);
  const params = useMemo(() => restParams(manifest), [manifest]);
  const valves = useMemo(() => new ValveRig(pickAsset.sampler, clipping, manifest), [pickAsset, clipping, manifest]);
  const flow = useMemo(() => new FlowRig(pickAsset.sampler, clipping, manifest), [pickAsset, clipping, manifest]);
  // structures the asset does not contain get no label (their manifest anchors are placeholders)
  const labelled = useMemo(() => LABELLED.filter((id) => spec.capabilities.structures.includes(id)), [spec]);
  const cycRef = useRef<CycleSample>(sampleCycle(visual.timing.phases, 0));
  const ghostRef = useRef<THREE.Mesh>(null);
  const tissueRef = useRef<THREE.Mesh>(null);
  const coronaryRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lastHover = useRef<StructureId | null>(null);
  const pickRef = useRef<THREE.Mesh>(null);

  useEffect(() => () => { tissueMat.dispose(); ghostMat.dispose(); }, [tissueMat, ghostMat]);
  useEffect(() => () => valves.dispose(), [valves]);
  useEffect(() => () => flow.dispose(), [flow]);

  // ---- static-pose pick mesh (BVH accelerated), rebuilt only when the patient's geometry changes
  const pick = useMemo(() => {
    const src = pickAsset.tissue;
    const rest = src.getAttribute("position") as THREE.BufferAttribute;
    const W = src.getAttribute("_weights") as THREE.BufferAttribute;
    const T = src.getAttribute("_tissue") as THREE.BufferAttribute;
    const P = frameParams(visual, { ventricular: 0, atrial: 0 }, restParams(manifest));
    const out = new Float32Array(rest.count * 3);
    const v: [number, number, number] = [0, 0, 0];
    const w = [0, 0, 0, 0];
    for (let i = 0; i < rest.count; i++) {
      w[0] = W.getX(i); w[1] = W.getY(i); w[2] = W.getZ(i); w[3] = W.getW(i);
      deformPoint(P, rest.getX(i), rest.getY(i), rest.getZ(i), w, T.getX(i), Math.round(T.getW(i) * 255), v);
      out[i * 3] = v[0]; out[i * 3 + 1] = v[1]; out[i * 3 + 2] = v[2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(out, 3));
    g.setIndex(src.getIndex()!.clone()); // MeshBVH reorders the index in place: never share it
    g.boundsTree = new MeshBVH(g);
    return g;
  }, [pickAsset, visual, manifest]);
  useEffect(() => () => { pick.boundsTree = undefined; pick.dispose(); }, [pick]);

  // label anchors: snapped onto the outer surface (ray from outside toward the heart centre), then
  // carried by the same deformation as the tissue vertex they sit on
  const anchors = useMemo(() => {
    const centre = center.clone();
    const rest = pickAsset.tissue.getAttribute("position") as THREE.BufferAttribute;
    const nor = pickAsset.tissue.getAttribute("normal") as THREE.BufferAttribute;
    const W = pickAsset.tissue.getAttribute("_weights") as THREE.BufferAttribute;
    const T = pickAsset.tissue.getAttribute("_tissue") as THREE.BufferAttribute;
    const probe = new THREE.Mesh(pick);
    probe.raycast = acceleratedRaycast;
    const ray = new THREE.Raycaster();
    (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const res: Partial<Record<StructureId, { rest: THREE.Vector3; attrs: { w: number[]; depth: number; region: number } }>> = {};
    for (const id of labelled) {
      const a = manifest.anchors[id];
      if (!a) continue;
      const p = new THREE.Vector3(a[0], a[1], a[2]);
      if (VALVES.has(id)) { res[id] = { rest: p, attrs: pickAsset.sampler.nearest(p) }; continue; }
      const dir = p.clone().sub(centre).normalize();
      ray.set(p.clone().addScaledVector(dir, 40), dir.clone().negate());
      const hit = ray.intersectObject(probe, false)[0];
      if (!hit?.face) { res[id] = { rest: p, attrs: pickAsset.sampler.nearest(p) }; continue; }
      const vi = hit.face.a;
      const rp = new THREE.Vector3(rest.getX(vi), rest.getY(vi), rest.getZ(vi)).add(new THREE.Vector3(nor.getX(vi), nor.getY(vi), nor.getZ(vi)).multiplyScalar(0.35));
      res[id] = { rest: rp, attrs: { w: [W.getX(vi), W.getY(vi), W.getZ(vi), W.getW(vi)], depth: T.getX(vi), region: Math.round(T.getW(vi) * 255) } };
    }
    return res;
  }, [pickAsset, pick, center, manifest, labelled]);
  const labelAnchors = useMemo<LabelAnchor[]>(() => labelled.filter((id) => anchors[id]).map((id) => ({ id, position: new THREE.Vector3(), visible: false, occludable: !VALVES.has(id) })), [anchors, labelled]);

  const visibleRegion = (region: number, depth: number) => {
    const s = useApp.getState();
    const id = REGION_STRUCTURES[region];
    if (s.hidden[id]) return false;
    if (s.isolate && s.isolate !== id) return false;
    if (region <= 3) {
      if (depth < 0.5 && (!s.layers.outer || s.xray)) return false;
      if (depth >= 0.5 && !s.layers.chambers) return false;
    }
    if (region >= 4 && region <= 7 && !s.layers.vessels) return false;
    return true;
  };

  useFrame((state, dt) => {
    const s = useApp.getState();
    const phases = visual.timing.phases;
    const clock = getClock(clockId);
    if (s.playing) {
      if (primaryClockId && s.syncMode === "phase" && primaryClockId !== clockId) clock.phase = getClock(primaryClockId).phase;
      else advance(clock, Math.min(dt, 0.1), phases, s.slowMotion);
    } else clock.phase = s.scrubPhase;
    const cyc = sampleCycle(phases, clock.phase);
    cycRef.current = cyc;
    frameParams(visual, cyc, params);
    applyDeformUniforms(uniforms, params);
    if (!primaryClockId || primaryClockId === clockId) notifyPhase(state.clock.elapsedTime * 1000);

    // appearance uniforms (cheap, read from the store without re-rendering)
    const lesionU = uniforms.uLesion.value as THREE.Vector4[], plaqueU = uniforms.uLesionPlaque.value as number[];
    const lesions = visual.coronary?.lesions ?? [];
    for (let i = 0; i < lesionU.length; i++) {
      const L = lesions[i];
      lesionU[i].set(L ? L.vesselId : 0, L ? L.tCentre : 0, L ? L.tHalfWidth : 0, L ? L.narrowing : 0);
      plaqueU[i] = L ? { noncalcified: 1, partially_calcified: 2, calcified: 3, unspecified: 1 }[L.plaque] : 0;
    }
    uniforms.uMode.value = s.mode === "clinical" ? 1 : 0;
    const hidden = uniforms.uHidden.value as number[];
    REGION_STRUCTURES.forEach((id, i) => { hidden[i] = s.hidden[id] || (i >= 4 && i <= 7 && !s.layers.vessels) ? 1 : 0; });
    uniforms.uShowOuter.value = s.layers.outer && !s.xray ? 1 : 0;
    uniforms.uShowInner.value = s.layers.chambers ? 1 : 0;
    uniforms.uIsolate.value = s.isolate ? REGION_STRUCTURES.indexOf(s.isolate) : -1;
    if (s.isolate && REGION_STRUCTURES.indexOf(s.isolate) < 0) uniforms.uIsolate.value = 99; // valve isolated: hide tissue
    uniforms.uSelected.value = s.selectedStructure ? REGION_STRUCTURES.indexOf(s.selectedStructure) : -1;
    uniforms.uHover.value = s.hoverStructure ? REGION_STRUCTURES.indexOf(s.hoverStructure) : -1;
    uniforms.uHighlight.value = s.layers.highlights ? 1 : 0;
    uniforms.uSegSelected.value = s.selectedSegment ?? 0;
    const segFlag = uniforms.uSegFlag.value as number[];
    segFlag.fill(0);
    visual.segments.status.forEach((st, i) => { if (st === "measured") segFlag[i] = 2; });
    for (const h of visual.highlights) for (const sg of h.segments ?? []) segFlag[sg - 1] = 1;
    uniforms.uTime.value = state.clock.elapsedTime;

    if (s.cutaway.enabled) frame.cutPlane(s.cutaway.axis, s.cutaway.offset, plane);
    else plane.copy(DISABLED_PLANE);
    // the heart group is translated by -HEART_CENTER*scale; clipping planes are in world space already

    if (ghostRef.current) ghostRef.current.visible = s.xray && s.layers.outer;
    coronaryRefs.current.forEach((m) => { if (m) m.visible = s.layers.coronary && !s.hidden.coronary_vessels && (!s.isolate || s.isolate === "coronary_vessels"); });
    if (tissueRef.current) tissueRef.current.visible = s.isolate !== "coronary_vessels";

    valves.group.visible = s.layers.valves;
    valves.update(params, cyc, visual, {
      visible: (id) => !s.hidden[id] && (!s.isolate || s.isolate === id || s.isolate === "myocardium"),
      clinical: s.mode === "clinical", selected: s.selectedStructure, hover: s.hoverStructure,
    });
    flow.group.visible = s.layers.flow || (s.layers.highlights && s.layers.valves);
    (flow.group.children[0] as THREE.Points).visible = s.layers.flow;
    flow.update(params, cyc, visual, Math.min(dt, 0.1) * (s.playing ? s.slowMotion : 0), phases.rrSeconds, s.layers.highlights && s.layers.valves);

    // structure-anchored labels follow the deformation (world = (asset − centre) × scale)
    const tmp: [number, number, number] = [0, 0, 0];
    const interiorExposed = s.cutaway.enabled || s.xray || !s.layers.outer;
    for (const la of labelAnchors) {
      const a = anchors[la.id]!;
      if (VALVES.has(la.id)) la.position.copy(valves.centre(la.id as never));
      else {
        deformPoint(params, a.rest.x, a.rest.y, a.rest.z, a.attrs.w, a.attrs.depth, a.attrs.region, tmp);
        la.position.set(tmp[0], tmp[1], tmp[2]);
      }
      la.position.sub(center).multiplyScalar(scale);
      const structureShown = !s.hidden[la.id] && (!s.isolate || s.isolate === la.id);
      la.visible = structureShown && plane.distanceToPoint(la.position) >= 0 &&
        (VALVES.has(la.id) ? s.layers.valves && (interiorExposed || s.isolate === la.id) : la.id === "coronary_vessels" ? s.layers.coronary : CHAMBERS.has(la.id) ? s.layers.outer || s.layers.chambers : s.layers.vessels);
    }
  });

  // ---- picking
  const firstVisibleHit = (e: ThreeEvent<PointerEvent | MouseEvent>) => {
    for (const hit of e.intersections) {
      if (plane.distanceToPoint(hit.point) < -0.02) continue;
      const vs = hit.object.userData.structure as StructureId | undefined;
      if (vs) { if (hit.object.parent?.visible !== false && hit.object.visible) return { structure: vs, segment: null as number | null }; continue; }
      if (hit.object.userData.pick && hit.face) {
        const T = pickAsset.tissue.getAttribute("_tissue") as THREE.BufferAttribute;
        const vi = hit.face.a;
        const region = Math.round(T.getW(vi) * 255);
        const depth = T.getX(vi);
        if (!visibleRegion(region, depth)) continue;
        let segment: number | null = null;
        if (region === 0) {
          const rp = pickAsset.tissue.getAttribute("position") as THREE.BufferAttribute;
          const lc = lvCoords(params, rp.getX(vi), rp.getY(vi), rp.getZ(vi));
          if (lc.s > -0.05) segment = segmentAt(lc.s, lc.theta);
        }
        return { structure: REGION_STRUCTURES[region], segment };
      }
    }
    return null;
  };
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    const h = firstVisibleHit(e);
    const id = h?.structure ?? null;
    if (id !== lastHover.current) { lastHover.current = id; useApp.getState().set({ hoverStructure: id }); }
  };
  const onOut = () => { if (lastHover.current) { lastHover.current = null; useApp.getState().set({ hoverStructure: null }); } };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive) return;
    e.stopPropagation();
    if (e.delta > 4) return; // a drag, not a click
    const h = firstVisibleHit(e);
    useApp.getState().selectStructure(h?.structure ?? null, h?.segment ?? null);
    // Tier B: move the CT slices to the clicked point (rest pose = the scanned shape)
    if (ct && h) {
      const p = e.point.clone().divideScalar(scale).add(center);
      const ijk = appToVoxel(ct.voxelToApp, [p.x, p.y, p.z]).map((v, i) => Math.max(0, Math.min(ct.dims[i] - 1, Math.round(v)))) as Vec3;
      useCtSlices.getState().set({ crosshair: ijk });
    }
  };

  const offset = useMemo(() => center.clone().multiplyScalar(-1), [center]);
  const ct = manifest.imaging;
  const ctCrosshair = useCtSlices((s) => s.crosshair);
  const marker = ct && ctCrosshair ? voxelToApp(ct.voxelToApp, ctCrosshair) : null;
  const layersLabels = useApp((s) => s.layers.labels);
  const selected = useApp((s) => s.selectedStructure);
  const hovered = useApp((s) => s.hoverStructure);

  return (
    <group scale={scale}>
      <group position={offset}>
        <mesh ref={tissueRef} geometry={asset.tissue} material={tissueMat} frustumCulled={false} />
        <mesh ref={ghostRef} geometry={asset.tissue} material={ghostMat} frustumCulled={false} renderOrder={10} visible={false} />
        {[asset.coronaryArteries, asset.cardiacVeins].map((g, i) => g && (
          <mesh key={i} ref={(m) => { coronaryRefs.current[i] = m; }} geometry={g} material={tissueMat} frustumCulled={false} />
        ))}
        <primitive object={valves.group} onPointerMove={onMove} onClick={onClick} onPointerOut={onOut} />
        <primitive object={flow.group} />
        {marker && (
          <mesh position={marker} renderOrder={20}>
            <sphereGeometry args={[0.22, 16, 12]} />
            <meshBasicMaterial color="#ffd166" depthTest={false} transparent opacity={0.95} />
          </mesh>
        )}
        <mesh
          ref={pickRef}
          geometry={pick}
          visible={false}
          userData={{ pick: true }}
          raycast={acceleratedRaycast}
          onPointerMove={onMove}
          onPointerOut={onOut}
          onClick={onClick}
        />
        {showLabels && <LabelOverlay anchors={labelAnchors} occluder={pickRef} enabled={layersLabels} selected={selected} hover={hovered} />}
      </group>
    </group>
  );
}
