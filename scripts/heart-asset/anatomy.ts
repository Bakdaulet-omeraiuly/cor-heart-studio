// Procedural anatomical heart definition (signed distance fields).
// Units: centimetres. Frame: +X patient left, +Y superior, +Z anterior.
// Every number here is an illustrative modelling choice, not a measurement of a person.
// Values were set by eye against standard anatomy atlases (see docs/anatomy-review.md).

import {
  type V3, Tube, add, clamp, cross, dot, fbm, frameFromAxis, len, mul, norm, sdEllipsoid,
  smax, smin, smoothstep, sub, toLocal, type Frame,
} from "./math.ts";

// ---------------------------------------------------------------- LV frame
export const LV_BASE: V3 = [0.5, 0.6, -0.6];
export const LV_AXIS: V3 = norm([0.52, -0.74, 0.42]); // base -> apex
export const LV_FRAME: Frame = frameFromAxis(LV_BASE, LV_AXIS, [0, 0, 1]);

const LV_OUT = { c: 4.0, rl: 4.95, rx: 3.0, rz: 2.85 };
const LV_CAV = { c: 3.75, rl: 4.55, rx: 2.1, rz: 2.0 };
export const LV_CAVITY_BASE_LY = 0.45; // cavity is cut by this plane; valves sit above it
export const LV_APEX_LY = LV_OUT.c + LV_OUT.rl; // epicardial apex along the axis

function lvTaper(ly: number) {
  // narrower toward the apex, slightly fuller at the base
  return 1 - 0.3 * smoothstep(3.2, 9.2, ly) + 0.04 * (1 - smoothstep(-1, 2.5, ly));
}
function sdLV(lx: number, ly: number, lz: number, o: typeof LV_OUT) {
  const t = lvTaper(ly);
  return sdEllipsoid(lx / t, ly - o.c, lz / t, o.rx, o.rl, o.rz) * Math.min(1, t);
}

// ---------------------------------------------------------------- RV (crescent wrapped on the LV)
const RV_CENTER: V3 = add(add(LV_BASE, mul(LV_AXIS, 2.9)), [-2.15, 0.45, 1.6]);
const RV_SEP_DIR = norm(sub(RV_CENTER, add(LV_BASE, mul(LV_AXIS, dot(sub(RV_CENTER, LV_BASE), LV_AXIS)))));
const RV_FRAME: Frame = (() => {
  const ey = LV_AXIS;
  const ex = RV_SEP_DIR;
  const ez = cross(ex, ey);
  return { origin: RV_CENTER, ex, ey, ez };
})();
const RV_OUT = { rx: 2.5, ry: 3.95, rz: 3.8 };
const RV_WALL = 0.42;
export const RV_INFO = { center: RV_CENTER, sepDir: RV_SEP_DIR };

// ---------------------------------------------------------------- atria
export const LA_CENTER: V3 = [0.9, 2.65, -2.45];
const LA_R: V3 = [2.45, 1.65, 1.7];
export const RA_CENTER: V3 = [-2.6, 2.0, -0.55];
const RA_R: V3 = [1.8, 2.35, 1.85];
const ATRIAL_WALL = 0.3;
const MIN_WALL = 0.22;

// Appendages: lobulated tubes curling over the AV groove.
const LAA = Tube.fromControl([[2.2, 2.9, -1.6], [3.0, 3.1, -0.6], [3.2, 2.7, 0.35], [2.75, 2.25, 0.95]], [0.75, 0.68, 0.55, 0.38], 10);
const RAA = Tube.fromControl([[-2.1, 3.1, 0.4], [-1.55, 3.4, 1.35], [-0.85, 3.1, 1.85], [-0.45, 2.55, 1.95]], [0.95, 0.85, 0.62, 0.36], 10);

// ---------------------------------------------------------------- valves (annulus frames)
export interface ValveSite { center: V3; normal: V3; radius: number }
export const VALVES: Record<"mitral_valve" | "aortic_valve" | "tricuspid_valve" | "pulmonary_valve", ValveSite> = {
  mitral_valve: { center: [1.15, 1.05, -1.25], normal: norm([0.25, -0.85, 0.47]), radius: 1.45 },
  aortic_valve: { center: [-0.25, 1.65, 0.25], normal: norm([-0.2, 0.92, 0.33]), radius: 1.15 },
  tricuspid_valve: { center: [-1.55, 0.75, 0.45], normal: norm([0.5, -0.55, 0.67]), radius: 1.5 },
  pulmonary_valve: { center: [1.5, 2.9, 2.2], normal: norm([0.25, 0.85, -0.45]), radius: 1.05 },
};

// ---------------------------------------------------------------- great vessels
interface Vessel { tube: Tube; lumen: Tube; wall: number; end: V3; endDir: V3; kind: "artery" | "vein"; open: boolean }
// Control points run from the cardiac root to the free (cut, open) end.
function vessel(ctrl: V3[], radii: number[], wall: number, kind: Vessel["kind"], leadIn = 0.6, open = true): Vessel {
  const tube = Tube.fromControl(ctrl, radii, 10);
  const endDir = norm(sub(ctrl[ctrl.length - 1], ctrl[ctrl.length - 2]));
  const startDir = norm(sub(ctrl[1], ctrl[0]));
  // lumen extends past the cut at the far end and back into the chamber at the root
  const lumenCtrl: V3[] = [sub(ctrl[0], mul(startDir, leadIn)), ...ctrl, add(ctrl[ctrl.length - 1], mul(endDir, 0.6))];
  const lumenR = [radii[0], ...radii, radii[radii.length - 1]];
  const lumen = Tube.fromControl(lumenCtrl, lumenR, 10);
  return { tube, lumen, wall, end: ctrl[ctrl.length - 1], endDir, kind, open };
}

const AO_ROOT = VALVES.aortic_valve.center;
export const VESSELS = {
  aorta: vessel(
    [AO_ROOT, [-0.55, 3.3, 0.48], [-0.8, 5.1, 0.55], [-0.5, 7.0, 0.2], [0.5, 7.9, -1.0], [1.55, 7.5, -2.5], [1.85, 6.3, -3.9], [1.75, 4.0, -5.05], [1.65, 1.6, -5.45]],
    [1.42, 1.32, 1.3, 1.27, 1.24, 1.18, 1.12, 1.08, 1.05], 0.24, "artery", 0.9),
  brachiocephalic: vessel([[-0.4, 7.2, 0.15], [-0.85, 8.8, 0.05], [-1.1, 10.3, -0.05]], [0.66, 0.6, 0.56], 0.16, "artery", 0.5),
  leftCarotid: vessel([[0.45, 8.0, -0.85], [0.6, 9.1, -0.95], [0.68, 10.3, -1.0]], [0.42, 0.4, 0.38], 0.15, "artery", 0.5),
  leftSubclavian: vessel([[1.15, 7.8, -1.75], [1.55, 8.9, -1.95], [2.0, 10.1, -2.05]], [0.5, 0.47, 0.44], 0.15, "artery", 0.5),
  pulmonaryTrunk: vessel(
    [VALVES.pulmonary_valve.center, [2.0, 4.6, 1.5], [1.9, 5.6, -0.3]],
    [1.2, 1.17, 1.12], 0.2, "artery", 0.9, false),
  lpa: vessel([[1.9, 5.6, -0.3], [3.4, 5.7, -1.5], [4.9, 5.3, -2.3]], [1.0, 0.92, 0.84], 0.17, "artery", 0.4),
  rpa: vessel([[1.9, 5.6, -0.3], [0.2, 5.3, -2.1], [-1.6, 5.1, -2.6], [-3.75, 4.8, -2.75]], [1.0, 0.95, 0.9, 0.84], 0.17, "artery", 0.4),
  svc: vessel([[-2.6, 3.4, -0.55], [-2.85, 5.5, -0.62], [-2.9, 8.8, -0.7]], [0.95, 0.95, 0.98], 0.18, "vein", 0.2),
  ivc: vessel([[-2.45, 0.8, -0.85], [-2.4, -0.4, -1.05], [-2.25, -2.4, -1.35]], [1.08, 1.1, 1.1], 0.18, "vein", 0.2),
  lspv: vessel([[2.1, 3.2, -3.05], [3.4, 3.6, -3.75], [4.45, 3.85, -4.05]], [0.64, 0.6, 0.56], 0.16, "vein", 0.2),
  lipv: vessel([[2.1, 2.05, -3.0], [3.4, 1.8, -3.6], [4.35, 1.5, -3.95]], [0.62, 0.58, 0.54], 0.16, "vein", 0.2),
  rspv: vessel([[-0.35, 3.2, -3.15], [-1.6, 3.4, -3.85], [-2.75, 3.5, -4.15]], [0.64, 0.6, 0.56], 0.16, "vein", 0.2),
  ripv: vessel([[-0.35, 2.05, -3.1], [-1.6, 1.9, -3.75], [-2.65, 1.7, -4.05]], [0.62, 0.58, 0.54], 0.16, "vein", 0.2),
};
export type VesselKey = keyof typeof VESSELS;

// Sinus of Valsalva bulges around the aortic root.
const SINUS_DIRS: V3[] = (() => {
  const f = frameFromAxis(AO_ROOT, VALVES.aortic_valve.normal, [0, 0, 1]);
  return [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    return norm(add(mul(f.ex, Math.cos(a)), mul(f.ez, Math.sin(a))));
  });
})();
const SINUS_CENTERS = SINUS_DIRS.map((d) => add(add(AO_ROOT, mul(VALVES.aortic_valve.normal, 0.75)), mul(d, 0.55)));

// Outflow tracts / AV orifices (cavity connectors).
const RVOT = Tube.fromControl([add(RV_CENTER, [0.2, 0.2, 0.4]), [0.6, 0.9, 2.45], [1.15, 2.1, 2.4], VALVES.pulmonary_valve.center], [1.55, 1.5, 1.38, 1.25], 10);
const LVOT = Tube.fromControl([add(LV_BASE, mul(LV_AXIS, 2.4)), add(LV_BASE, mul(LV_AXIS, 0.6)), sub(AO_ROOT, mul(VALVES.aortic_valve.normal, 0.4)), AO_ROOT], [1.3, 1.15, 1.1, 1.1], 10);
const MITRAL_ORIFICE = Tube.fromControl([LA_CENTER, VALVES.mitral_valve.center, add(VALVES.mitral_valve.center, mul(VALVES.mitral_valve.normal, 1.4))], [1.3, 1.35, 1.35], 8);
const TRICUSPID_ORIFICE = Tube.fromControl([RA_CENTER, VALVES.tricuspid_valve.center, add(VALVES.tricuspid_valve.center, mul(VALVES.tricuspid_valve.normal, 1.3))], [1.25, 1.38, 1.38], 8);

// Papillary muscles (LV) and RV anterior papillary + moderator band (removed from cavities).
/** Anatomical anterior direction in the LV short-axis plane (world +Z made perpendicular to the axis and septum). */
function lvAnterior(sep: V3): V3 {
  const z: V3 = [0, 0, 1];
  const zp = sub(z, mul(LV_AXIS, dot(z, LV_AXIS)));
  return norm(sub(zp, mul(sep, dot(zp, sep))));
}
const lvPoint = (ly: number, ang: number, r: number): V3 => {
  const sep = RV_SEP_DIR;
  const ant = lvAnterior(sep);
  const dir = add(mul(sep, Math.cos(ang)), mul(ant, Math.sin(ang)));
  return add(add(LV_BASE, mul(LV_AXIS, ly)), mul(dir, r));
};
export const PAPILLARY = {
  anterolateral: Tube.fromControl([lvPoint(6.2, 2.25, 1.65), lvPoint(4.9, 2.2, 1.35), lvPoint(3.6, 2.15, 1.05)], [0.55, 0.45, 0.24], 8),
  posteromedial: Tube.fromControl([lvPoint(6.0, -2.15, 1.6), lvPoint(4.8, -2.1, 1.3), lvPoint(3.5, -2.05, 1.0)], [0.55, 0.45, 0.24], 8),
  rvAnterior: Tube.fromControl([add(RV_CENTER, [-0.4, -1.3, 1.25]), add(RV_CENTER, [-0.55, -0.4, 0.75]), add(RV_CENTER, [-0.7, 0.4, 0.35])], [0.42, 0.32, 0.18], 8),
};
const MODERATOR_BAND = Tube.fromControl([lvPoint(5.4, 0.25, 2.75), add(RV_CENTER, [-0.25, -1.0, 0.95])], [0.2, 0.17], 8);

// ---------------------------------------------------------------- component evaluation
export interface Parts {
  lv: number; rv: number; la: number; ra: number;
  lvCav: number; rvCav: number; laCav: number; raCav: number;
  vessel: number; vesselLumen: number; vesselId: number;
  outer: number; cavity: number;
}

const VESSEL_LIST = Object.values(VESSELS);
const VESSEL_KEYS = Object.keys(VESSELS) as VesselKey[];

function vesselDist(x: number, y: number, z: number, out: Parts) {
  let best = Infinity, bestLumen = Infinity, id = -1;
  for (let i = 0; i < VESSEL_LIST.length; i++) {
    const vs = VESSEL_LIST[i];
    let d = vs.tube.sd(x, y, z);
    if (vs.open && d < 1.5) {
      // flat cut at the free end (shows the wall thickness in section)
      const cut = (x - vs.end[0]) * vs.endDir[0] + (y - vs.end[1]) * vs.endDir[1] + (z - vs.end[2]) * vs.endDir[2];
      d = Math.max(d, cut);
    }
    if (VESSEL_KEYS[i] === "aorta") {
      for (const c of SINUS_CENTERS) d = smin(d, Math.hypot(x - c[0], y - c[1], z - c[2]) - 0.82, 0.35);
    }
    if (d < best) { best = d; id = i; }
    const l = vs.lumen.sd(x, y, z, -vs.wall);
    let lAo = l;
    if (VESSEL_KEYS[i] === "aorta") {
      for (const c of SINUS_CENTERS) lAo = smin(lAo, Math.hypot(x - c[0], y - c[1], z - c[2]) - 0.6, 0.3);
    }
    if (lAo < bestLumen) bestLumen = lAo;
  }
  out.vessel = best;
  out.vesselLumen = bestLumen;
  out.vesselId = id;
}

/** Evaluate every anatomical component at a point (allocation free via `out`). */
export function evalParts(x: number, y: number, z: number, out: Parts): Parts {
  // LV
  const [lx, ly, lz] = toLocal(LV_FRAME, x, y, z);
  out.lv = sdLV(lx, ly, lz, LV_OUT);
  let lvCav = sdLV(lx, ly, lz, LV_CAV);
  lvCav = smax(lvCav, LV_CAVITY_BASE_LY - ly, 0.35);
  // trabeculations toward the apex: shallow longitudinal ridges protruding into the cavity
  const ang = Math.atan2(lz, lx);
  const trab = smoothstep(3.6, 7.2, ly) * (0.07 * Math.pow(Math.max(0, Math.sin(ang * 11 + ly * 0.9)), 3) + 0.04 * fbm(x * 2.2, y * 2.2, z * 2.2, 2));
  lvCav += trab;
  // RV
  const [rx, ry, rz] = toLocal(RV_FRAME, x, y, z);
  const rvEll = sdEllipsoid(rx, ry, rz, RV_OUT.rx, RV_OUT.ry, RV_OUT.rz);
  const rvOT = RVOT.sd(x, y, z);
  out.rv = smin(rvEll, rvOT, 0.9);
  let rvCav = smin(rvEll + RV_WALL, RVOT.sd(x, y, z, -0.38), 0.7);
  rvCav = smax(rvCav, -(out.lv - 0.02), 0.25); // the septum belongs to the LV wall
  rvCav += 0.06 * Math.pow(Math.max(0, Math.sin(rx * 6.5 + ry * 2.3)), 2) * smoothstep(-1.5, 2.5, ry) + 0.04 * fbm(x * 1.7 + 3, y * 1.7, z * 1.7, 2);
  // atria + appendages
  const laE = sdEllipsoid(x - LA_CENTER[0], y - LA_CENTER[1], z - LA_CENTER[2], LA_R[0], LA_R[1], LA_R[2]);
  const laa = LAA.sd(x, y, z) + 0.05 * Math.sin(x * 9) * Math.sin(y * 7) * Math.sin(z * 8);
  out.la = smin(laE, laa, 0.6);
  const raE = sdEllipsoid(x - RA_CENTER[0], y - RA_CENTER[1], z - RA_CENTER[2], RA_R[0], RA_R[1], RA_R[2]);
  const raa = RAA.sd(x, y, z);
  out.ra = smin(raE, raa, 0.7);
  const laCav = smin(laE + ATRIAL_WALL, LAA.sd(x, y, z, -0.24), 0.4);
  let raCav = smin(raE + ATRIAL_WALL, RAA.sd(x, y, z, -0.26), 0.4);
  // pectinate muscle ridges inside the right atrial appendage region
  raCav += 0.06 * Math.pow(Math.max(0, Math.sin((x + z) * 7.5)), 4) * smoothstep(1.2, -0.2, raa);
  // vessels
  vesselDist(x, y, z, out);

  // orifices and outflow tracts join cavities across walls
  const mo = MITRAL_ORIFICE.sd(x, y, z);
  const to = TRICUSPID_ORIFICE.sd(x, y, z);
  const lvot = LVOT.sd(x, y, z);
  lvCav = smin(lvCav, smax(mo, LV_CAVITY_BASE_LY - 0.9 - ly, 0.2), 0.3);
  lvCav = smin(lvCav, lvot, 0.35);
  // papillary muscles and moderator band are solid tissue inside the cavities
  lvCav = smax(lvCav, -PAPILLARY.anterolateral.sd(x, y, z), 0.3);
  lvCav = smax(lvCav, -PAPILLARY.posteromedial.sd(x, y, z), 0.3);
  rvCav = smax(rvCav, -PAPILLARY.rvAnterior.sd(x, y, z), 0.25);
  rvCav = smax(rvCav, -MODERATOR_BAND.sd(x, y, z), 0.12);
  rvCav = smin(rvCav, to, 0.3);

  // assemble: ventricles hug with a shallow interventricular groove, atria sit in a coronary sulcus
  const ventricles = smin(out.lv, out.rv, 0.75);
  const atria = smin(out.la, out.ra, 0.9);
  const chambers = smin(ventricles, atria, 0.55);
  // chamber cavities and connectors never come closer than MIN_WALL to the epicardium
  const keep = chambers + MIN_WALL;
  out.lvCav = smax(lvCav, keep, 0.15);
  out.rvCav = smax(rvCav, keep, 0.15);
  out.laCav = smax(smin(laCav, mo, 0.3), keep, 0.15);
  out.raCav = smax(smin(raCav, to, 0.3), keep, 0.15);
  let outer = chambers;
  outer = smin(outer, out.vessel, 0.38);
  out.outer = outer;
  let cav = Math.min(out.lvCav, out.rvCav, out.laCav, out.raCav);
  cav = smin(cav, out.vesselLumen, 0.25);
  out.cavity = cav;
  return out;
}

/** LV cavity bounded at the valve plane (no orifices, no trabeculae): used to measure baseline volume. */
export function lvCavityProxy(x: number, y: number, z: number) {
  const [lx, ly, lz] = toLocal(LV_FRAME, x, y, z);
  return smax(sdLV(lx, ly, lz, LV_CAV), LV_CAVITY_BASE_LY - ly, 0.35);
}
export function laCavityProxy(x: number, y: number, z: number) {
  return sdEllipsoid(x - LA_CENTER[0], y - LA_CENTER[1], z - LA_CENTER[2], LA_R[0], LA_R[1], LA_R[2]) + ATRIAL_WALL;
}
export const MODEL = { LV_OUT, LV_CAV, RV_CENTER, RV_FRAME, RV_OUT, RV_WALL, LA_R, RA_R, ATRIAL_WALL };

export function newParts(): Parts {
  return { lv: 0, rv: 0, la: 0, ra: 0, lvCav: 0, rvCav: 0, laCav: 0, raCav: 0, vessel: 0, vesselLumen: 0, vesselId: -1, outer: 0, cavity: 0 };
}

const scratch = newParts();
/** Outer surface only (no cavities) — used to place coronary vessels and fat. */
export function outerField(x: number, y: number, z: number) {
  return evalParts(x, y, z, scratch).outer;
}

// ---------------------------------------------------------------- epicardial fat + final solid
export interface FatCurves { tubes: Tube[] }
let FAT: FatCurves | null = null;
export function setFat(f: FatCurves) { FAT = f; }

export function fatField(x: number, y: number, z: number) {
  if (!FAT) return Infinity;
  let d = Infinity;
  for (const t of FAT.tubes) d = Math.min(d, t.sd(x, y, z, 0, 1.2));
  if (d < 0.6) d += 0.12 * fbm(x * 1.6 + 11, y * 1.6, z * 1.6, 3); // lobulated, not a smooth sausage
  return d;
}

/** Final signed distance of the solid tissue (myocardium + vessel walls + fat). */
export function solidField(x: number, y: number, z: number, out: Parts = scratch) {
  evalParts(x, y, z, out);
  let outer = out.outer + 0.012 * fbm(x * 4.1, y * 4.1, z * 4.1, 2); // faint surface relief
  const fat = fatField(x, y, z);
  outer = smin(outer, fat, 0.3);
  return smax(outer, -out.cavity, 0.06);
}

// ---------------------------------------------------------------- surface utilities
export function gradient(f: (x: number, y: number, z: number) => number, p: V3, h = 0.01): V3 {
  const g: V3 = [
    f(p[0] + h, p[1], p[2]) - f(p[0] - h, p[1], p[2]),
    f(p[0], p[1] + h, p[2]) - f(p[0], p[1] - h, p[2]),
    f(p[0], p[1], p[2] + h) - f(p[0], p[1], p[2] - h),
  ];
  return norm(g);
}
export function projectToSurface(f: (x: number, y: number, z: number) => number, p: V3, iters = 8): V3 {
  let q = p;
  for (let i = 0; i < iters; i++) {
    const d = f(q[0], q[1], q[2]);
    if (Math.abs(d) < 1e-4) break;
    q = sub(q, mul(gradient(f, q), d));
  }
  return q;
}

/** Point on the LV frame in cylindrical coordinates (septum-referenced angle, radians). */
export function lvAngleBasis() {
  const sep = RV_SEP_DIR;
  return { sep, ant: lvAnterior(sep) };
}

export function lvLocal(p: V3) {
  const { sep, ant } = lvAngleBasis();
  const q = sub(p, LV_BASE);
  const along = dot(q, LV_AXIS);
  const radial = sub(q, mul(LV_AXIS, along));
  return { along, angle: Math.atan2(dot(radial, ant), dot(radial, sep)), r: len(radial) };
}

export { clamp };
