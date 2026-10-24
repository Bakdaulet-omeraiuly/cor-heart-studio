// Illustrative flow particles (off by default). Speed, density and colour carry NO measured meaning:
// neutral colour (no oxygenation coding), constant speed, gated only by the illustrative valve phases.
import * as THREE from "three";
import type { CycleSample } from "@/domain/mapping/cycle";
import type { PatientVisualState } from "@/domain/mapping/types";
import type { Severity, ValveId } from "@/domain/schema/record";
import type { AttributeSampler, SampledAttributes } from "../asset-adapters/heartAsset";
import type { HeartManifest } from "../asset-adapters/manifest";
import { deformPoint, type DeformParams } from "../animation/deform";

const V = (a: number[]) => new THREE.Vector3(a[0], a[1], a[2]);
const hash = (i: number) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

interface Path {
  rest: THREE.Vector3[];
  attrs: SampledAttributes[];
  now: THREE.Vector3[];
  avGate: number; // index of the AV valve point
  slGate: number; // index of the semilunar valve point
}

const JET_LENGTH: Record<Severity, number> = { none: 0, trace: 0.6, mild: 1.2, mild_to_moderate: 1.7, moderate: 2.2, moderate_to_severe: 2.8, severe: 3.4, unspecified: 1.5 };

export class FlowRig {
  readonly group = new THREE.Group();
  private paths: Path[] = [];
  private forward: THREE.Points;
  private jets: THREE.Points;
  private t: Float32Array;
  private which: Uint8Array;
  private tmp: [number, number, number] = [0, 0, 0];
  private valveRest: Record<ValveId, { c: THREE.Vector3; n: THREE.Vector3; attrs: SampledAttributes }>;
  readonly count = 260;
  readonly jetCount = 180;

  constructor(sampler: AttributeSampler, clipping: THREE.Plane[], manifest: HeartManifest) {
    const m = manifest;
    const lvBase = V(m.deformation.lv.base), axis = V(m.deformation.lv.axis);
    const right = [V(m.anchors.vena_cava).add(new THREE.Vector3(0, 2.2, 0)), V(m.anchors.vena_cava), V(m.deformation.ra.center), V(m.valves.tricuspid_valve.center), V(m.deformation.rv.center).add(new THREE.Vector3(0.2, -0.6, -0.2)),
      V(m.valves.pulmonary_valve.center).addScaledVector(V(m.valves.pulmonary_valve.normal), -1.2), V(m.valves.pulmonary_valve.center), V(m.anchors.pulmonary_artery), V(m.anchors.pulmonary_artery).add(new THREE.Vector3(0, 1.4, -1.6))];
    const left = [V(m.anchors.pulmonary_veins).add(new THREE.Vector3(1.2, 0.2, -0.5)), V(m.anchors.pulmonary_veins), V(m.deformation.la.center), V(m.valves.mitral_valve.center), lvBase.clone().addScaledVector(axis, 5.2),
      lvBase.clone().addScaledVector(axis, 1.6).add(new THREE.Vector3(-0.6, 0.4, 0.6)), V(m.valves.aortic_valve.center), V(m.anchors.aorta), V(m.anchors.aorta).add(new THREE.Vector3(0.6, 2.4, -0.6))];
    for (const [pts, av, sl] of [[right, 3, 6], [left, 3, 6]] as const) {
      const rest = pts.map((p) => p.clone());
      this.paths.push({ rest, attrs: rest.map((p) => sampler.nearest(p)), now: rest.map((p) => p.clone()), avGate: av, slGate: sl });
    }
    this.valveRest = Object.fromEntries((Object.keys(m.valves) as ValveId[]).map((k) => {
      const c = V(m.valves[k].center);
      return [k, { c, n: V(m.valves[k].normal).normalize(), attrs: sampler.nearest(c) }];
    })) as FlowRig["valveRest"];

    this.t = new Float32Array(this.count);
    this.which = new Uint8Array(this.count);
    for (let i = 0; i < this.count; i++) { this.t[i] = hash(i); this.which[i] = i % 2; }
    const mk = (n: number, color: THREE.Color, size: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false, clippingPlanes: clipping });
      const p = new THREE.Points(g, mat);
      p.frustumCulled = false;
      return p;
    };
    this.forward = mk(this.count, new THREE.Color(0.92, 0.93, 0.96), 0.22);
    this.jets = mk(this.jetCount, new THREE.Color(1.0, 0.72, 0.12), 0.34);
    this.forward.renderOrder = 5;
    this.jets.renderOrder = 6;
    this.group.add(this.forward, this.jets);
  }

  private point(path: Path, u: number, out: THREE.Vector3) {
    const n = path.now.length - 1;
    const x = Math.min(n - 1e-6, Math.max(0, u * n));
    const i = Math.floor(x);
    return out.copy(path.now[i]).lerp(path.now[i + 1], x - i);
  }

  update(P: DeformParams, cyc: CycleSample, vs: PatientVisualState, dt: number, rr: number, showJets: boolean) {
    for (const path of this.paths) {
      path.rest.forEach((p, i) => {
        deformPoint(P, p.x, p.y, p.z, path.attrs[i].w, path.attrs[i].depth, path.attrs[i].region, this.tmp);
        path.now[i].set(this.tmp[0], this.tmp[1], this.tmp[2]);
      });
    }
    const pos = this.forward.geometry.getAttribute("position") as THREE.BufferAttribute;
    const tmp = new THREE.Vector3();
    const speed = dt / (rr * 2.2);
    for (let i = 0; i < this.count; i++) {
      const path = this.paths[this.which[i]];
      const n = path.rest.length - 1;
      const seg = this.t[i] * n;
      // hold before a closed valve; particles never move backward
      const beforeAv = seg < path.avGate && seg > path.avGate - 0.6;
      const beforeSl = seg < path.slGate && seg > path.slGate - 0.6;
      let v = speed;
      if (beforeAv && cyc.atrioventricularOpen < 0.2) v = 0;
      if (beforeSl && cyc.semilunarOpen < 0.2) v = 0;
      if (seg >= path.slGate - 0.05 && seg < path.slGate + 1) v *= 1.6;
      this.t[i] += v;
      if (this.t[i] >= 1) this.t[i] = hash(i + this.t[i] * 13) * 0.08;
      const jitter = (hash(i * 3.1) - 0.5) * 0.35;
      this.point(path, this.t[i], tmp);
      pos.setXYZ(i, tmp.x + jitter, tmp.y + (hash(i * 5.7) - 0.5) * 0.35, tmp.z + (hash(i * 9.3) - 0.5) * 0.35);
    }
    pos.needsUpdate = true;

    // regurgitant jets: only for valves with a supplied regurgitation finding, only in their closed phase
    const jp = this.jets.geometry.getAttribute("position") as THREE.BufferAttribute;
    let k = 0;
    const regurgitant = (Object.keys(vs.valves) as ValveId[]).filter((v) => vs.valves[v].regurgitation);
    this.jets.visible = showJets && regurgitant.length > 0;
    if (this.jets.visible) {
      const per = Math.floor(this.jetCount / regurgitant.length);
      for (const id of regurgitant) {
        const av = id === "mitral_valve" || id === "tricuspid_valve";
        const closedPhase = av ? cyc.atrioventricularOpen < 0.05 && cyc.ventricular > 0.02 : cyc.semilunarOpen < 0.05 && cyc.ventricular < 0.98;
        const r = this.valveRest[id];
        deformPoint(P, r.c.x, r.c.y, r.c.z, r.attrs.w, r.attrs.depth, r.attrs.region, this.tmp);
        const c = new THREE.Vector3(...this.tmp);
        const back = r.n.clone().negate();
        const side = new THREE.Vector3().crossVectors(back, new THREE.Vector3(0, 1, 0)).normalize();
        const side2 = new THREE.Vector3().crossVectors(back, side).normalize();
        const L = JET_LENGTH[vs.valves[id].regurgitation!];
        for (let j = 0; j < per && k < this.jetCount; j++, k++) {
          const u = (hash(j * 7.3) + performance.now() * 0.0011 * (1 + hash(j))) % 1;
          if (!closedPhase) { jp.setXYZ(k, 0, 0, -1e4); continue; }
          const spread = 0.45 * u * L * 0.35;
          const a = hash(j * 2.1) * Math.PI * 2;
          jp.setXYZ(k,
            c.x + back.x * u * L + (side.x * Math.cos(a) + side2.x * Math.sin(a)) * spread,
            c.y + back.y * u * L + (side.y * Math.cos(a) + side2.y * Math.sin(a)) * spread,
            c.z + back.z * u * L + (side.z * Math.cos(a) + side2.z * Math.sin(a)) * spread);
        }
      }
      for (; k < this.jetCount; k++) jp.setXYZ(k, 0, 0, -1e4);
      jp.needsUpdate = true;
    }
  }

  dispose() {
    for (const p of [this.forward, this.jets]) { p.geometry.dispose(); (p.material as THREE.Material).dispose(); }
  }
}
