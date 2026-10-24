// Chamber-handle deformation. This TypeScript implementation is the reference for the GLSL copy in
// scene/materials/deformGlsl.ts (keep them in sync). Used for picking, label anchors and volume tests.
import proceduralManifest from "@/scene/asset-adapters/procedural-heart-v1.manifest.json";
import type { HeartManifest } from "@/scene/asset-adapters/manifest";
import type { CycleSample } from "@/domain/mapping/cycle";
import type { PatientVisualState } from "@/domain/mapping/types";

export type Vec3 = [number, number, number];

export interface DeformParams {
  lvBase: Vec3; lvAxis: Vec3; lvSep: Vec3; lvAnt: Vec3;
  cavBase: number; cavApex: number; epiApex: number;
  /** static ED scale: x radial endo, y radial epi, z long */
  lvStatic: Vec3;
  /** cycle factors: x radial endo, y radial epi, z long */
  lvCycle: Vec3;
  lvTwist: number;
  segMotion: Float32Array; // 17
  segThick: Float32Array; // 17, cm
  rvR0: number; // septal reference radius from the LV axis
  rvR0Rest: number; // rvR0 of the asset at rest (mean LV cavity radius + wall)
  rvStatic: Vec3; rvCycle: Vec3;
  laCenter: Vec3; raCenter: Vec3;
  laScale: number; raScale: number;
}

/** Rest parameters of an asset (defaults to the procedural heart). */
export function restParams(manifest: HeartManifest = proceduralManifest): DeformParams {
  const L = manifest.deformation.lv;
  return {
    lvBase: L.base as Vec3, lvAxis: L.axis as Vec3, lvSep: L.septalDir as Vec3, lvAnt: L.anteriorDir as Vec3,
    cavBase: L.cavityBaseAlong, cavApex: L.cavityApexAlong, epiApex: L.epiApexAlong,
    lvStatic: [1, 1, 1], lvCycle: [1, 1, 1], lvTwist: 0,
    segMotion: new Float32Array(17).fill(1), segThick: new Float32Array(17),
    rvR0: L.meanCavityRadius + L.meanWallThickness,
    rvR0Rest: L.meanCavityRadius + L.meanWallThickness,
    rvStatic: [1, 1, 1], rvCycle: [1, 1, 1],
    laCenter: manifest.deformation.la.center as Vec3, raCenter: manifest.deformation.ra.center as Vec3,
    laScale: 1, raScale: 1,
  };
}

/** Fill per-frame parameters from a visual state and a cycle sample (c = 0 end-diastole .. 1 end-systole). */
export function frameParams(vs: PatientVisualState, cyc: Pick<CycleSample, "ventricular" | "atrial">, out: DeformParams = restParams()): DeformParams {
  const c = cyc.ventricular;
  out.lvStatic = [vs.lv.edRadial, vs.lv.edRadialEpi, vs.lv.edLong];
  out.lvCycle = [1 + c * (vs.lv.esRadialEndo - 1), 1 + c * (vs.lv.esRadialEpi - 1), 1 + c * (vs.lv.esLong - 1)];
  out.lvTwist = c * vs.lv.twistRad;
  out.segMotion.set(vs.segments.motion);
  out.segThick.set(vs.segments.thicknessDeltaCm);
  out.rvR0 = out.rvR0Rest * vs.lv.edRadialEpi;
  out.rvStatic = [vs.rv.edRadial, vs.rv.edRadialEpi, vs.rv.edLong];
  out.rvCycle = [1 + c * (vs.rv.esRadialEndo - 1), 1 + c * (vs.rv.esRadialEpi - 1), 1 + c * (vs.rv.esLong - 1)];
  out.laScale = vs.la.edScale * (1 + vs.la.swing * cyc.atrial);
  out.raScale = vs.ra.edScale * (1 + vs.ra.swing * cyc.atrial);
  return out;
}

// ---- AHA segment geometry (angles in degrees from the septal direction toward anterior)
const BASAL = [2, 1, 6, 5, 4, 3]; // centres at 30 + 60k
const MID = [8, 7, 12, 11, 10, 9];
const APICAL = [14, 13, 16, 15]; // centres at 0 + 90k
const RING_S = [0.175, 0.5, 0.785, 0.96];

function ringValue(arr: ArrayLike<number>, segs: number[], offsetDeg: number, thetaDeg: number) {
  const n = segs.length, step = 360 / n;
  let t = (thetaDeg - offsetDeg) / step;
  t = ((t % n) + n) % n;
  const i0 = Math.floor(t), f = t - i0;
  return arr[segs[i0] - 1] * (1 - f) + arr[segs[(i0 + 1) % n] - 1] * f;
}
/** Smoothly interpolated per-segment value at normalized LV position s (0 base .. 1 apex) and angle. */
export function segmentField(arr: ArrayLike<number>, s: number, thetaDeg: number) {
  const vb = ringValue(arr, BASAL, 30, thetaDeg);
  const vm = ringValue(arr, MID, 30, thetaDeg);
  const va = ringValue(arr, APICAL, 0, thetaDeg);
  const vx = arr[16];
  if (s <= RING_S[0]) return vb;
  if (s <= RING_S[1]) return vb + (vm - vb) * ((s - RING_S[0]) / (RING_S[1] - RING_S[0]));
  if (s <= RING_S[2]) return vm + (va - vm) * ((s - RING_S[1]) / (RING_S[2] - RING_S[1]));
  if (s <= RING_S[3]) return va + (vx - va) * ((s - RING_S[2]) / (RING_S[3] - RING_S[2]));
  return vx;
}
/** Discrete AHA segment (1..17) for highlighting/picking. */
export function segmentAt(s: number, thetaDeg: number): number {
  const th = ((thetaDeg % 360) + 360) % 360;
  if (s >= 0.92) return 17;
  if (s >= 0.65) return APICAL[Math.floor((((th + 45) % 360) + 360) % 360 / 90)];
  const ring = s < 0.35 ? BASAL : MID;
  return ring[Math.floor(th / 60)];
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** LV-local cylindrical coordinates of a rest position. */
export function lvCoords(P: DeformParams, x: number, y: number, z: number) {
  const qx = x - P.lvBase[0], qy = y - P.lvBase[1], qz = z - P.lvBase[2];
  const along = qx * P.lvAxis[0] + qy * P.lvAxis[1] + qz * P.lvAxis[2];
  const rx = qx - along * P.lvAxis[0], ry = qy - along * P.lvAxis[1], rz = qz - along * P.lvAxis[2];
  const r = Math.hypot(rx, ry, rz);
  const cs = rx * P.lvSep[0] + ry * P.lvSep[1] + rz * P.lvSep[2];
  const sn = rx * P.lvAnt[0] + ry * P.lvAnt[1] + rz * P.lvAnt[2];
  const theta = (Math.atan2(sn, cs) * 180) / Math.PI;
  const s = (along - P.cavBase) / (P.cavApex - P.cavBase);
  return { along, r, rx, ry, rz, theta, s };
}

const REGION_RV = 1;

/**
 * Deform one rest-pose point.
 * w = (lv, rv, la, ra) membership weights (remainder anchored); depth 0 epicardium .. 1 endocardium.
 */
export function deformPoint(P: DeformParams, x: number, y: number, z: number, w: ArrayLike<number>, depth: number, region: number, out: Vec3 = [0, 0, 0]): Vec3 {
  let dx = 0, dy = 0, dz = 0;
  const { along, r, rx, ry, rz, theta, s } = lvCoords(P, x, y, z);
  const ax = P.lvAxis;

  // ---- LV handle
  if (w[0] > 0.001) {
    const lvDepth = region === REGION_RV ? 0 : depth; // RV face of the septum behaves like LV epicardium
    const m = segmentField(P.segMotion, s, theta);
    const thick = segmentField(P.segThick, s, theta);
    const stat = P.lvStatic[1] + (P.lvStatic[0] - P.lvStatic[1]) * lvDepth;
    const cyc = P.lvCycle[1] + (P.lvCycle[0] - P.lvCycle[1]) * lvDepth;
    const radial = stat * (1 + m * (cyc - 1));
    const aStatic = along * P.lvStatic[2];
    const apex = P.epiApex * P.lvStatic[2];
    const aFinal = apex + (aStatic - apex) * P.lvCycle[2];
    const tw = P.lvTwist * (0.5 - along / P.epiApex);
    const ct = Math.cos(tw), st = Math.sin(tw);
    // rotate radial vector around the axis (Rodrigues; radial ⟂ axis)
    const cx = ax[1] * rz - ax[2] * ry, cy = ax[2] * rx - ax[0] * rz, cz = ax[0] * ry - ax[1] * rx;
    const rr = r > 1e-6 ? 1 / r : 0;
    const off = thick * (0.35 - lvDepth);
    const scaleR = radial + off * rr;
    const nx = (rx * ct + cx * st) * scaleR, ny = (ry * ct + cy * st) * scaleR, nz = (rz * ct + cz * st) * scaleR;
    const px = P.lvBase[0] + ax[0] * aFinal + nx, py = P.lvBase[1] + ax[1] * aFinal + ny, pz = P.lvBase[2] + ax[2] * aFinal + nz;
    dx += w[0] * (px - x); dy += w[0] * (py - y); dz += w[0] * (pz - z);
  }
  // ---- RV handle: free wall moves relative to the septal reference radius
  if (w[1] > 0.001) {
    const stat = P.rvStatic[1] + (P.rvStatic[0] - P.rvStatic[1]) * depth;
    const cyc = P.rvCycle[1] + (P.rvCycle[0] - P.rvCycle[1]) * depth;
    const f = stat * cyc;
    const ex = Math.max(r - P.rvR0, 0);
    const rNew = r + ex * (f - 1) + (P.rvR0 * (P.lvStatic[1] - 1)); // ride on LV epicardial growth
    const k = r > 1e-6 ? rNew / r : 1;
    const apex = P.epiApex * P.lvStatic[2];
    const aFinal = apex + (along * P.lvStatic[2] - apex) * P.rvCycle[2] * P.rvStatic[2];
    const px = P.lvBase[0] + ax[0] * aFinal + rx * k, py = P.lvBase[1] + ax[1] * aFinal + ry * k, pz = P.lvBase[2] + ax[2] * aFinal + rz * k;
    dx += w[1] * (px - x); dy += w[1] * (py - y); dz += w[1] * (pz - z);
  }
  // ---- atria: isotropic about their centres
  if (w[2] > 0.001) {
    const c = P.laCenter, k = P.laScale - 1;
    dx += w[2] * (x - c[0]) * k; dy += w[2] * (y - c[1]) * k; dz += w[2] * (z - c[2]) * k;
  }
  if (w[3] > 0.001) {
    const c = P.raCenter, k = P.raScale - 1;
    dx += w[3] * (x - c[0]) * k; dy += w[3] * (y - c[1]) * k; dz += w[3] * (z - c[2]) * k;
  }
  out[0] = x + dx; out[1] = y + dy; out[2] = z + dz;
  return out;
}

export { dot };
