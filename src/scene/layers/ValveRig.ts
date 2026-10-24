// Imperative valve apparatus updated from the parent render loop (no React state per frame).
import * as THREE from "three";
import type { CycleSample } from "@/domain/mapping/cycle";
import type { PatientVisualState, StructureId } from "@/domain/mapping/types";
import type { Severity, ValveId } from "@/domain/schema/record";
import type { AttributeSampler, SampledAttributes } from "../asset-adapters/heartAsset";
import type { HeartManifest } from "../asset-adapters/manifest";
import { deformPoint, type DeformParams } from "../animation/deform";
import {
  RING_SAMPLES, VALVE_SPECS, chordaeCount, createLeafletGeometry, restAnnulus, updateLeaflets, updateRingTube,
} from "../geometry/valves";

const GAP: Record<Severity, number> = { none: 0, trace: 0.03, mild: 0.06, mild_to_moderate: 0.09, moderate: 0.12, moderate_to_severe: 0.16, severe: 0.2, unspecified: 0.08 };
const V = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);

interface ValveParts {
  id: ValveId;
  restRing: THREE.Vector3[];
  ringAttrs: SampledAttributes[];
  restCenter: THREE.Vector3;
  restAhead: THREE.Vector3;
  centerAttrs: SampledAttributes;
  ring: THREE.Vector3[];
  leaflets: THREE.Mesh;
  annulus: THREE.Mesh;
  chordae: THREE.InstancedMesh | null;
  edges: THREE.Vector3[];
  papTips: { rest: THREE.Vector3; attrs: SampledAttributes; now: THREE.Vector3 }[];
  radius: number;
}

export class ValveRig {
  readonly group = new THREE.Group();
  private parts: ValveParts[] = [];
  readonly leafletMaterial: THREE.MeshPhysicalMaterial;
  private annulusMaterial: THREE.MeshPhysicalMaterial;
  private chordMaterial: THREE.MeshStandardMaterial;
  private tmp = new THREE.Vector3();
  private tmpArr: [number, number, number] = [0, 0, 0];
  private matrix = new THREE.Matrix4();

  constructor(sampler: AttributeSampler, clipping: THREE.Plane[], manifest: HeartManifest) {
    // thin fibrous membrane: warm off-white, soft sheen, slight translucency (approximation; no transmission pass)
    this.leafletMaterial = new THREE.MeshPhysicalMaterial({ color: 0xead2bb, roughness: 0.58, clearcoat: 0.25, clearcoatRoughness: 0.45, sheen: 0.85, sheenRoughness: 0.45, sheenColor: new THREE.Color(1.0, 0.68, 0.6), side: THREE.DoubleSide, transparent: true, opacity: 0.88, depthWrite: true, clippingPlanes: clipping });
    this.annulusMaterial = new THREE.MeshPhysicalMaterial({ color: 0xd8b8a0, roughness: 0.55, clearcoat: 0.2, clippingPlanes: clipping });
    this.chordMaterial = new THREE.MeshStandardMaterial({ color: 0xf0e4d4, roughness: 0.5, clippingPlanes: clipping });
    const m = manifest;
    const lvBase = V(m.deformation.lv.base), axis = V(m.deformation.lv.axis), sep = V(m.deformation.lv.septalDir);
    const septalPap = lvBase.clone().addScaledVector(axis, 3.4).addScaledVector(sep, m.deformation.lv.meanCavityRadius + m.deformation.lv.meanWallThickness + 0.15);
    const papRest: Record<ValveId, THREE.Vector3[]> = {
      mitral_valve: [V(m.papillary.anterolateral.tip), V(m.papillary.posteromedial.tip)],
      tricuspid_valve: [V(m.papillary.rvAnterior.tip), septalPap],
      aortic_valve: [], pulmonary_valve: [],
    };
    for (const id of Object.keys(VALVE_SPECS) as ValveId[]) {
      const spec = VALVE_SPECS[id];
      const vm = m.valves[id];
      const center = V(vm.center), normal = V(vm.normal).normalize();
      const ref = id === "mitral_valve" ? V(m.valves.aortic_valve.center) : id === "tricuspid_valve" ? lvBase.clone().addScaledVector(sep, 3) : center.clone().add(new THREE.Vector3(0, 0, 1));
      const restRing = restAnnulus(spec, center, normal, vm.radius * (spec.kind === "semilunar" ? 0.84 : 0.92), ref);
      const ringAttrs = restRing.map((p) => sampler.nearest(p));
      const leaflets = new THREE.Mesh(createLeafletGeometry(spec), this.leafletMaterial);
      leaflets.userData.structure = id;
      leaflets.frustumCulled = false;
      const annulus = new THREE.Mesh(new THREE.BufferGeometry(), this.annulusMaterial);
      annulus.userData.structure = id;
      annulus.frustumCulled = false;
      const nCh = chordaeCount(spec);
      let chordae: THREE.InstancedMesh | null = null;
      if (nCh) {
        const cyl = new THREE.CylinderGeometry(0.028, 0.034, 1, 5, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
        chordae = new THREE.InstancedMesh(cyl, this.chordMaterial, nCh);
        chordae.frustumCulled = false;
        chordae.userData.structure = id;
      }
      const g = new THREE.Group();
      g.name = id;
      g.add(leaflets, annulus);
      if (chordae) g.add(chordae);
      this.group.add(g);
      this.parts.push({
        id, restRing, ringAttrs, restCenter: center, restAhead: center.clone().addScaledVector(normal, 0.6),
        centerAttrs: sampler.nearest(center), ring: restRing.map((p) => p.clone()), leaflets, annulus, chordae,
        edges: Array.from({ length: nCh }, () => new THREE.Vector3()),
        papTips: papRest[id].map((p) => ({ rest: p, attrs: sampler.nearest(p), now: p.clone() })), radius: vm.radius,
      });
    }
  }

  private deform(P: DeformParams, p: THREE.Vector3, a: SampledAttributes, out: THREE.Vector3) {
    deformPoint(P, p.x, p.y, p.z, a.w, a.depth, a.region, this.tmpArr);
    return out.set(this.tmpArr[0], this.tmpArr[1], this.tmpArr[2]);
  }

  update(P: DeformParams, cyc: CycleSample, vs: PatientVisualState, opts: { visible: (id: StructureId) => boolean; clinical: boolean; selected: StructureId | null; hover: StructureId | null }) {
    for (const part of this.parts) {
      const parent = part.leaflets.parent!;
      parent.visible = opts.visible(part.id);
      if (!parent.visible) continue;
      const spec = VALVE_SPECS[part.id];
      const centre = new THREE.Vector3();
      for (let i = 0; i < RING_SAMPLES; i++) {
        this.deform(P, part.restRing[i], part.ringAttrs[i], part.ring[i]);
        centre.add(part.ring[i]);
      }
      centre.multiplyScalar(1 / RING_SAMPLES);
      const c0 = this.deform(P, part.restCenter, part.centerAttrs, new THREE.Vector3());
      const c1 = this.deform(P, part.restAhead, part.centerAttrs, new THREE.Vector3());
      const normal = c1.sub(c0).normalize();
      let radius = 0;
      for (const p of part.ring) radius += p.distanceTo(centre);
      radius /= RING_SAMPLES;
      const valve = vs.valves[part.id];
      const raw = spec.kind === "atrioventricular" ? cyc.atrioventricularOpen : cyc.semilunarOpen;
      const state = {
        opening: raw * valve.maxOpening,
        gap: valve.regurgitation ? GAP[valve.regurgitation] : 0,
        billow: valve.prolapse ? 0.35 : 0,
      };
      updateLeaflets(spec, part.leaflets.geometry, part.ring, centre, normal, radius, state, 0.055, part.edges);
      updateRingTube(part.annulus.geometry, part.ring, 0.1);
      if (part.chordae) {
        for (const t of part.papTips) this.deform(P, t.rest, t.attrs, t.now);
        part.edges.forEach((e, i) => {
          let tip = part.papTips[0].now;
          if (part.id === "mitral_valve") tip = e.distanceTo(part.papTips[0].now) < e.distanceTo(part.papTips[1].now) ? part.papTips[0].now : part.papTips[1].now;
          else tip = i < part.edges.length / VALVE_SPECS[part.id].commissures.length ? part.papTips[1].now : part.papTips[0].now; // septal leaflet -> septal attachment
          const len = e.distanceTo(tip);
          // Matrix4.lookAt(eye, target) points +Z from target to eye; the cylinder extends along +Z
          this.matrix.lookAt(tip, e, this.tmp.set(0, 1, 0));
          this.matrix.scale(new THREE.Vector3(1, 1, len));
          this.matrix.setPosition(e);
          part.chordae!.setMatrixAt(i, this.matrix);
        });
        part.chordae.instanceMatrix.needsUpdate = true;
      }
    }
    const finding = (id: ValveId) => vs.valves[id];
    for (const part of this.parts) {
      const f = finding(part.id);
      const highlight = opts.selected === part.id ? 0.35 : opts.hover === part.id ? 0.18 : 0;
      const base = opts.clinical
        ? f.stenosis ? new THREE.Color(0.95, 0.66, 0.1) : f.regurgitation ? new THREE.Color(0.85, 0.35, 0.75) : new THREE.Color(0.78, 0.8, 0.85)
        : new THREE.Color(0xead2bb);
      const target = base.lerp(new THREE.Color(1, 1, 1), highlight);
      if (!(part.leaflets.material as THREE.MeshPhysicalMaterial).userData.perValve) {
        part.leaflets.material = this.leafletMaterial.clone();
        (part.leaflets.material as THREE.MeshPhysicalMaterial).userData.perValve = true;
      }
      (part.leaflets.material as THREE.MeshPhysicalMaterial).color.copy(target);
    }
  }

  /** Current deformed valve centres (for labels). */
  centre(id: ValveId) {
    const part = this.parts.find((p) => p.id === id)!;
    const c = new THREE.Vector3();
    for (const p of part.ring) c.add(p);
    return c.multiplyScalar(1 / part.ring.length);
  }

  dispose() {
    for (const part of this.parts) {
      part.leaflets.geometry.dispose();
      (part.leaflets.material as THREE.Material).dispose();
      part.annulus.geometry.dispose();
      part.chordae?.geometry.dispose();
      part.chordae?.dispose();
    }
    this.leafletMaterial.dispose();
    this.annulusMaterial.dispose();
    this.chordMaterial.dispose();
  }
}
