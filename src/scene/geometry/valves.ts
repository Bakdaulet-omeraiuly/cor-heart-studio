// Runtime valve apparatus: annulus, leaflets/cusps with thickness, chordae (AV valves only).
// Geometry is rebuilt each frame from the deformed annulus, so leaflets stay attached as the heart moves.
import * as THREE from "three";
import type { ValveId } from "@/domain/schema/record";

type V = THREE.Vector3;

export interface ValveSpec {
  id: ValveId;
  kind: "atrioventricular" | "semilunar";
  /** Leaflet sector boundaries (radians, in the valve frame) — commissures. */
  commissures: number[];
  leafletLength: number; // relative to annulus radius
  annulusShape: "saddle" | "crown" | "round";
}

export const VALVE_SPECS: Record<ValveId, ValveSpec> = {
  // anterior (aortic) leaflet spans ~140° centred on u = 0 (frame e1 points toward the aortic valve)
  mitral_valve: { id: "mitral_valve", kind: "atrioventricular", commissures: [-1.22, 1.22], leafletLength: 1.05, annulusShape: "saddle" },
  tricuspid_valve: { id: "tricuspid_valve", kind: "atrioventricular", commissures: [-2.1, 0.0, 2.1], leafletLength: 1.0, annulusShape: "round" },
  aortic_valve: { id: "aortic_valve", kind: "semilunar", commissures: [0.52, 2.62, 4.71], leafletLength: 0.95, annulusShape: "crown" },
  pulmonary_valve: { id: "pulmonary_valve", kind: "semilunar", commissures: [0.0, 2.09, 4.19], leafletLength: 0.95, annulusShape: "crown" },
};

const TAU = Math.PI * 2;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;

export const RING_SAMPLES = 48;

/** Rest-pose annulus points in the asset frame. */
export function restAnnulus(spec: ValveSpec, center: V, normal: V, radius: number, ref: V): V[] {
  const n = normal.clone().normalize();
  const e1 = ref.clone().sub(center).projectOnPlane(n).normalize();
  if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).projectOnPlane(n).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1);
  const pts: V[] = [];
  for (let i = 0; i < RING_SAMPLES; i++) {
    const u = (i / RING_SAMPLES) * TAU;
    let h = 0;
    if (spec.annulusShape === "saddle") h = 0.12 * radius * Math.cos(2 * u);
    if (spec.annulusShape === "crown") {
      // commissures sit downstream (higher), cusp nadirs upstream
      const k = spec.commissures.length;
      const phase = spec.commissures[0];
      h = 0.32 * radius * Math.cos(k * (u - phase));
    }
    pts.push(center.clone().addScaledVector(e1, Math.cos(u) * radius).addScaledVector(e2, Math.sin(u) * radius).addScaledVector(n, h));
  }
  return pts;
}

export interface ValveState {
  opening: number; // 0 closed .. 1 open (already multiplied by stenosis limit)
  gap: number; // regurgitant coaptation gap fraction 0..0.25
  billow: number; // prolapse billow (radius units)
}

/**
 * Builds leaflets between the deformed annulus and a closure target. Returns positions for a
 * double-layer shell (thickness `thick`), written into `out` (sized by leafletVertexCount).
 */
export const NU = 14; // samples across each leaflet
export const NV = 8; // samples from hinge to free edge
export function leafletVertexCount(spec: ValveSpec) { return spec.commissures.length * NU * NV * 2; }

function leafletIndex(spec: ValveSpec): number[] {
  const idx: number[] = [];
  const L = spec.commissures.length;
  const layer = L * NU * NV;
  for (let l = 0; l < L; l++) {
    const base = l * NU * NV;
    for (let i = 0; i < NU - 1; i++) for (let j = 0; j < NV - 1; j++) {
      const a = base + i * NV + j, b = a + NV, c = a + 1, d = b + 1;
      idx.push(a, b, c, c, b, d); // upper (upstream) face
      idx.push(layer + a, layer + c, layer + b, layer + c, layer + d, layer + b); // lower face
    }
    // stitch the free edge and the two commissural edges so the leaflet reads as a solid sheet
    for (let i = 0; i < NU - 1; i++) {
      const a = base + i * NV + (NV - 1), b = base + (i + 1) * NV + (NV - 1);
      idx.push(a, layer + a, b, b, layer + a, layer + b);
    }
    for (const i of [0, NU - 1]) for (let j = 0; j < NV - 1; j++) {
      const a = base + i * NV + j, b = a + 1;
      if (i === 0) idx.push(a, b, layer + a, b, layer + b, layer + a);
      else idx.push(a, layer + a, b, b, layer + a, layer + b);
    }
  }
  return idx;
}

export function createLeafletGeometry(spec: ValveSpec) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(leafletVertexCount(spec) * 3), 3));
  g.setIndex(leafletIndex(spec));
  return g;
}

const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3();

/** Sample the closed ring at an arbitrary angle (linear between samples). */
function ringAt(ring: V[], u: number, out: V) {
  const t = (wrap(u) / TAU) * ring.length;
  const i0 = Math.floor(t) % ring.length, i1 = (i0 + 1) % ring.length;
  return out.copy(ring[i0]).lerp(ring[i1], t - Math.floor(t));
}

/**
 * Update leaflet positions. `ring` is the deformed annulus; `centre`/`normal` its deformed frame.
 * Free-edge points are returned in `edgeOut` for chordae attachment.
 */
export function updateLeaflets(spec: ValveSpec, geom: THREE.BufferGeometry, ring: V[], centre: V, normal: V, radius: number, s: ValveState, thick: number, edgeOut: V[]) {
  const pos = geom.getAttribute("position") as THREE.BufferAttribute;
  const arr = pos.array as Float32Array;
  const C = spec.commissures;
  const L = C.length;
  const layer = L * NU * NV;
  const n = normal;
  let ei = 0;
  for (let l = 0; l < L; l++) {
    const u0 = C[l];
    let u1 = C[(l + 1) % L];
    if (u1 <= u0) u1 += TAU;
    const um = (u0 + u1) / 2;
    for (let i = 0; i < NU; i++) {
      const fu = i / (NU - 1);
      // keep a sliver at commissures so neighbouring leaflets do not intersect
      const u = u0 + (u1 - u0) * (0.02 + 0.96 * fu);
      const hinge = ringAt(ring, u, tmpA);
      // closure target: Y / line coaptation toward the centre along the commissure lines
      let t: number, dirU: number;
      if (u < um) { t = 1 - (u - u0) / (um - u0); dirU = u0; } else { t = (u - um) / (u1 - um); dirU = u1; }
      const commPt = ringAt(ring, dirU, tmpB);
      const target = tmpC.copy(centre).lerp(commPt, Math.max(t, s.gap));
      const belly = Math.sin(Math.PI * fu); // 0 at commissures, 1 at the leaflet middle
      for (let j = 0; j < NV; j++) {
        const fv = j / (NV - 1);
        // closed: hinge -> target, bowing upstream (AV) or forming a pocket downstream-to-upstream (semilunar)
        let cx = hinge.x + (target.x - hinge.x) * fv;
        let cy = hinge.y + (target.y - hinge.y) * fv;
        let cz = hinge.z + (target.z - hinge.z) * fv;
        const bow = spec.kind === "atrioventricular"
          ? -(0.1 + s.billow) * radius * Math.sin(Math.PI * fv * 0.85) * (0.4 + 0.6 * belly)
          : -0.42 * radius * Math.sin(Math.PI * fv * 0.9) * belly;
        cx += n.x * bow; cy += n.y * bow; cz += n.z * bow;
        // open: leaflet swings downstream, lying against the wall (semilunar) or hanging as a soft funnel (AV).
        // Scalloped free edge and a gentle belly so the leaflet reads as a membrane, not a flat sheet.
        const scallop = spec.kind === "atrioventricular" ? 1 - 0.14 * Math.pow(Math.sin(Math.PI * fu * (spec.id === "mitral_valve" && l === 1 ? 3 : 2)), 2) : 1;
        const len = spec.leafletLength * radius * scallop;
        const inward = spec.kind === "atrioventricular" ? 0.3 : 0.1;
        const bellyOut = (spec.kind === "atrioventricular" ? -0.16 : -0.08) * radius * Math.sin(Math.PI * fv) * (0.5 + 0.5 * belly);
        const rx = hinge.x - centre.x, ry = hinge.y - centre.y, rz = hinge.z - centre.z;
        const rl = Math.hypot(rx, ry, rz) || 1;
        const pull = inward * fv * fv - bellyOut / rl;
        const ox = hinge.x - rx * pull + n.x * len * fv;
        const oy = hinge.y - ry * pull + n.y * len * fv;
        const oz = hinge.z - rz * pull + n.z * len * fv;
        const o = s.opening;
        const x = cx + (ox - cx) * o, y = cy + (oy - cy) * o, z = cz + (oz - cz) * o;
        const k = (l * NU * NV + i * NV + j) * 3;
        arr[k] = x; arr[k + 1] = y; arr[k + 2] = z;
        if (j === NV - 1 && i % 3 === 1 && edgeOut[ei]) edgeOut[ei++].set(x, y, z);
      }
    }
  }
  // offset layers along the per-vertex surface normal for real thickness
  geom.computeVertexNormals();
  const nor = geom.getAttribute("normal") as THREE.BufferAttribute;
  for (let v = 0; v < layer; v++) {
    const k = v * 3;
    const nx = nor.array[k], ny = nor.array[k + 1], nz = nor.array[k + 2];
    const tx = arr[k], ty = arr[k + 1], tz = arr[k + 2];
    arr[k] = tx + nx * thick * 0.5; arr[k + 1] = ty + ny * thick * 0.5; arr[k + 2] = tz + nz * thick * 0.5;
    const kk = (layer + v) * 3;
    arr[kk] = tx - nx * thick * 0.5; arr[kk + 1] = ty - ny * thick * 0.5; arr[kk + 2] = tz - nz * thick * 0.5;
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
}

export function chordaeCount(spec: ValveSpec) {
  return spec.kind === "atrioventricular" ? spec.commissures.length * Math.ceil((NU - 1) / 3) : 0;
}

/** Tube geometry for the annulus ring (rebuilt per frame — 48 x 8 vertices). */
export function updateRingTube(geom: THREE.BufferGeometry, ring: V[], tubeR: number) {
  const radial = 8;
  let pos = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!pos) {
    pos = new THREE.BufferAttribute(new Float32Array(ring.length * radial * 3), 3);
    geom.setAttribute("position", pos);
    const idx: number[] = [];
    for (let i = 0; i < ring.length; i++) for (let k = 0; k < radial; k++) {
      const a = i * radial + k, b = i * radial + ((k + 1) % radial);
      const c = ((i + 1) % ring.length) * radial + k, d = ((i + 1) % ring.length) * radial + ((k + 1) % radial);
      idx.push(a, c, b, b, c, d);
    }
    geom.setIndex(idx);
  }
  const arr = pos.array as Float32Array;
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < ring.length; i++) c.add(ring[i]);
  c.multiplyScalar(1 / ring.length);
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    T.subVectors(ring[(i + 1) % ring.length], ring[(i - 1 + ring.length) % ring.length]).normalize();
    N.subVectors(p, c).projectOnPlane(T).normalize();
    B.crossVectors(T, N);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * TAU;
      const o = (i * radial + k) * 3;
      arr[o] = p.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * tubeR;
      arr[o + 1] = p.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * tubeR;
      arr[o + 2] = p.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * tubeR;
    }
  }
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
}
