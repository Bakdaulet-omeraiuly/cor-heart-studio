// Derives anatomical grooves from the outer surface field, then builds coronary arteries,
// cardiac veins and epicardial fat along them. Deterministic: no randomness.
import {
  LV_AXIS, LV_BASE, LV_APEX_LY, VALVES, VESSELS, evalParts, lvAngleBasis, newParts, outerField,
  projectToSurface, gradient,
} from "./anatomy.ts";
import { type V3, Tube, add, catmull, cross, dot, len, lerp, mul, norm, sub } from "./math.ts";

const P = newParts();

/** Surface point on the outer field along a ray from `origin` in direction `dir` (outside-in search). */
function surfaceAlong(f: (x: number, y: number, z: number) => number, origin: V3, dir: V3, rMax = 9): V3 | null {
  let prev = rMax;
  let prevV = f(...add(origin, mul(dir, rMax)));
  if (prevV < 0) return null;
  for (let r = rMax - 0.1; r > 0; r -= 0.1) {
    const v = f(...add(origin, mul(dir, r)));
    if (v < 0) {
      let a = r, b = prev; // a inside, b outside
      for (let i = 0; i < 24; i++) {
        const m = (a + b) / 2;
        if (f(...add(origin, mul(dir, m))) < 0) a = m; else b = m;
      }
      return add(origin, mul(dir, (a + b) / 2));
    }
    prev = r;
    prevV = v;
  }
  void prevV;
  return null;
}

const { sep, ant } = lvAngleBasis();
const radialDir = (theta: number): V3 => norm(add(mul(sep, Math.cos(theta)), mul(ant, Math.sin(theta))));
const axisPoint = (ly: number): V3 => add(LV_BASE, mul(LV_AXIS, ly));

/** Interventricular groove: where LV and RV outer fields meet on the epicardium. */
function ivGroove(side: 1 | -1): V3[] {
  const pts: V3[] = [];
  for (let ly = 1.0; ly <= 7.6; ly += 0.3) {
    let best: V3 | null = null, bestG = Infinity;
    for (let th = 0.15; th < 2.9; th += 0.03) {
      const s = surfaceAlong(outerField, axisPoint(ly), radialDir(side * th));
      if (!s) continue;
      evalParts(s[0], s[1], s[2], P);
      if (P.rv > 0.9) continue; // RV no longer present at this level
      const g = Math.abs(P.lv - P.rv);
      if (g < bestG) { bestG = g; best = s; }
    }
    if (best && bestG < 0.35) pts.push(best);
  }
  return pts;
}

/** Coronary (atrioventricular) sulcus: ventricles meet atria / great arteries. */
function avRing(): { phi: number; p: V3 }[] {
  const ring: { phi: number; p: V3 }[] = [];
  for (let phi = -Math.PI; phi < Math.PI; phi += 0.06) {
    let best: V3 | null = null, bestG = Infinity;
    for (let ly = -2.6; ly <= 1.6; ly += 0.08) {
      const s = surfaceAlong(outerField, axisPoint(ly), radialDir(phi), 8);
      if (!s) continue;
      evalParts(s[0], s[1], s[2], P);
      const vent = Math.min(P.lv, P.rv);
      const upper = Math.min(P.la, P.ra, P.vessel);
      if (vent > 0.5 || upper > 0.5) continue;
      const g = Math.abs(vent - upper);
      if (g < bestG) { bestG = g; best = s; }
    }
    if (best) ring.push({ phi, p: best });
  }
  return ring;
}

function smoothPolyline(pts: V3[], iters = 3): V3[] {
  let p = pts.map((q) => [...q] as V3);
  for (let k = 0; k < iters; k++) {
    p = p.map((q, i) => (i === 0 || i === p.length - 1 ? q : mul(add(add(p[i - 1], p[i + 1]), mul(q, 2)), 0.25)));
  }
  return p;
}

function resample(pts: V3[], step: number): V3[] {
  const out: V3[] = [pts[0]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = len(sub(b, a));
    let t = step - carry;
    while (t <= L) { out.push(add(a, mul(sub(b, a), t / L))); t += step; }
    carry = L - (t - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export interface VesselPath { name: string; kind: "artery" | "vein"; pts: V3[]; radii: number[] }

/** Lift a path onto a surface field, embedded by `embed * radius`. */
export function seatPath(f: (x: number, y: number, z: number) => number, pts: V3[], r0: number, r1: number, embed = 0.25): { pts: V3[]; radii: number[] } {
  const rs = resample(smoothPolyline(pts, 2), 0.18);
  const seated = rs.map((p, i) => {
    const r = lerp(r0, r1, i / (rs.length - 1));
    const s = projectToSurface(f, p, 10);
    return add(s, mul(gradient(f, s), r * embed));
  });
  const sm = smoothPolyline(seated, 2);
  return { pts: sm, radii: sm.map((_, i) => lerp(r0, r1, i / (sm.length - 1))) };
}

export function deriveGrooves() {
  const anterior = ivGroove(1);
  const posterior = ivGroove(-1);
  const ring = avRing();
  // continue the anterior groove around the apex a little (the LAD typically wraps the apex)
  const apex = surfaceAlong(outerField, axisPoint(LV_APEX_LY - 2.0), LV_AXIS, 4)!;
  return { anterior, posterior, ring, apex };
}

function ringArc(ring: { phi: number; p: V3 }[], from: number, to: number): V3[] {
  // walk the ring from angle `from` to `to` in the direction of increasing angle (wrapping)
  const twoPi = Math.PI * 2;
  const span = ((to - from) % twoPi + twoPi) % twoPi;
  const pts = ring
    .map((r) => ({ t: ((r.phi - from) % twoPi + twoPi) % twoPi, p: r.p }))
    .filter((r) => r.t <= span)
    .sort((a, b) => a.t - b.t)
    .map((r) => r.p);
  return pts;
}
function ringArcReverse(ring: { phi: number; p: V3 }[], from: number, to: number): V3[] {
  return ringArc(ring, to, from).reverse();
}

function angleOf(p: V3) {
  const q = sub(p, LV_BASE);
  const along = dot(q, LV_AXIS);
  const r = sub(q, mul(LV_AXIS, along));
  return Math.atan2(dot(r, ant), dot(r, sep));
}

/** Branch running down the LV/RV free wall from a parent point toward the apex. */
function freeWallBranch(f: (x: number, y: number, z: number) => number, start: V3, thetaStart: number, thetaEnd: number, lyEnd: number): V3[] {
  const q = sub(start, LV_BASE);
  const ly0 = dot(q, LV_AXIS);
  const pts: V3[] = [start];
  const n = 12;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const ly = lerp(ly0, lyEnd, t);
    const th = lerp(thetaStart, thetaEnd, Math.pow(t, 0.7));
    const s = surfaceAlong(f, axisPoint(ly), radialDir(th));
    if (s) pts.push(s);
  }
  return pts;
}

export function buildCoronaryNetwork(g: ReturnType<typeof deriveGrooves>, f: (x: number, y: number, z: number) => number) {
  const paths: VesselPath[] = [];
  const add2 = (name: string, kind: VesselPath["kind"], raw: V3[], r0: number, r1: number, embed = 0.2) => {
    if (raw.length < 2) return;
    const s = seatPath(f, raw, r0, r1, embed);
    paths.push({ name, kind, ...s });
  };

  // Ostia on the aortic root: right sinus faces anterior, left sinus faces left-posterior.
  const ao = VALVES.aortic_valve;
  const rootUp = add(ao.center, mul(ao.normal, 0.75));
  // seat the ostia just outside the sinus bulges, then snap onto the epicardial field
  const rightOs = projectToSurface(f, add(rootUp, mul(norm([-0.25, 0.1, 1]), 1.5)), 12);
  const leftOs = projectToSurface(f, add(rootUp, mul(norm([0.85, 0.05, -0.15]), 1.5)), 12);

  const thAnt = angleOf(g.anterior[0]);
  const ringByPhi = g.ring;

  // Left main -> LAD down the anterior interventricular groove, wrapping the apex
  const ladStart = g.anterior[0];
  const lm = [leftOs, add(mul(add(leftOs, ladStart), 0.5), [0.25, 0.1, 0.25]), ladStart];
  add2("left_main", "artery", lm, 0.3, 0.28, 0.45);
  const ladRaw = [...g.anterior, g.apex];
  add2("lad", "artery", ladRaw, 0.27, 0.11, 0.45);

  // Circumflex: left AV groove from the LM bifurcation backwards toward the crux.
  // Left side of the heart = positive x; find ring angles by nearest points.
  const nearestPhi = (p: V3) => ringByPhi.reduce((b, r) => (len(sub(r.p, p)) < len(sub(b.p, p)) ? r : b)).phi;
  const phiLM = nearestPhi(ladStart);
  const crux = g.posterior[0];
  const phiCrux = nearestPhi(crux);
  // decide arc direction that passes through the left (+x) side
  const arcA = ringArc(ringByPhi, phiLM, phiCrux);
  const arcB = ringArcReverse(ringByPhi, phiLM, phiCrux);
  const meanX = (a: V3[]) => a.reduce((s, p) => s + p[0], 0) / Math.max(1, a.length);
  const leftArc = meanX(arcA) > meanX(arcB) ? arcA : arcB;
  const rightArc = leftArc === arcA ? arcB : arcA;
  const lcx = leftArc.slice(0, Math.floor(leftArc.length * 0.78));
  add2("lcx", "artery", [ladStart, ...lcx], 0.24, 0.13, 0.45);

  // RCA: right sinus -> right AV groove -> crux -> posterior descending artery
  const rcaRing = [...rightArc].reverse(); // from anterior (LM side) toward crux, through the right
  const startIdx = rcaRing.reduce((bi, p, i) => (len(sub(p, rightOs)) < len(sub(rcaRing[bi], rightOs)) ? i : bi), 0);
  const rca = [rightOs, ...rcaRing.slice(startIdx)];
  add2("rca", "artery", rca, 0.28, 0.18, 0.45);
  add2("pda", "artery", [crux, ...g.posterior.slice(1, Math.floor(g.posterior.length * 0.85))], 0.18, 0.09, 0.4);

  // Diagonals off the LAD, obtuse marginal off the LCx, acute marginal off the RCA
  const ladPt = (frac: number) => g.anterior[Math.floor(frac * (g.anterior.length - 1))];
  add2("diagonal_1", "artery", freeWallBranch(f, ladPt(0.2), thAnt + 0.15, thAnt + 0.95, 5.2), 0.16, 0.08, 0.4);
  add2("diagonal_2", "artery", freeWallBranch(f, ladPt(0.45), thAnt + 0.1, thAnt + 0.8, 6.8), 0.14, 0.07, 0.4);
  const lcxMid = lcx[Math.floor(lcx.length * 0.4)];
  if (lcxMid) add2("obtuse_marginal", "artery", freeWallBranch(f, lcxMid, angleOf(lcxMid), angleOf(lcxMid) - 0.2, 6.2), 0.16, 0.08, 0.4);
  const rcaMid = rca[Math.floor(rca.length * 0.45)];
  if (rcaMid) add2("acute_marginal", "artery", freeWallBranch(f, rcaMid, angleOf(rcaMid), angleOf(rcaMid) * 0.6, 5.6), 0.15, 0.08, 0.4);
  add2("conus_branch", "artery", freeWallBranch(f, rca[Math.min(3, rca.length - 1)], angleOf(rca[Math.min(3, rca.length - 1)]), thAnt - 0.25, 1.6), 0.09, 0.05, 0.2);

  // Veins: great cardiac vein beside the LAD -> left AV groove -> coronary sinus -> RA
  const offsetGroove = (pts: V3[], dth: number) => pts.map((p) => {
    const q = sub(p, LV_BASE);
    const ly = dot(q, LV_AXIS);
    return surfaceAlong(f, axisPoint(ly), radialDir(angleOf(p) + dth)) ?? p;
  });
  const gcvDown = offsetGroove(g.anterior.slice(0, Math.floor(g.anterior.length * 0.85)), 0.13).reverse();
  const csArc = leftArc.map((p) => add(p, mul(LV_AXIS, -0.25)));
  add2("great_cardiac_vein", "vein", [...gcvDown, ...csArc.slice(0, Math.floor(csArc.length * 0.7))], 0.16, 0.27, 0.25);
  const csStart = csArc[Math.floor(csArc.length * 0.65)];
  const raEntry: V3 = [-2.05, 0.15, -1.75];
  if (csStart) add2("coronary_sinus", "vein", [csStart, ...csArc.slice(Math.floor(csArc.length * 0.7)), crux, raEntry], 0.33, 0.42, 0.25);
  add2("middle_cardiac_vein", "vein", offsetGroove(g.posterior.slice(0, Math.floor(g.posterior.length * 0.85)), -0.12).reverse(), 0.12, 0.2, 0.25);
  const rvAnt = rcaRing[Math.floor(rcaRing.length * 0.25)];
  if (rvAnt) add2("anterior_cardiac_vein", "vein", freeWallBranch(f, rvAnt, angleOf(rvAnt), angleOf(rvAnt) + 0.1, 3.8).reverse(), 0.07, 0.12, 0.25);

  return { paths, ostia: { rightOs, leftOs } };
}

/** Fat follows the grooves: AV sulcus, interventricular grooves, and the acute margin. */
export function fatTubes(g: ReturnType<typeof deriveGrooves>): Tube[] {
  const tubes: Tube[] = [];
  // split long curves into short chunks so per-tube bounding boxes cull effectively
  const chunked = (pts: V3[], radius: (t: number) => number) => {
    const s = catmull(resample(pts, 0.45), 2);
    for (let i = 0; i < s.length - 1; i += 10) {
      const part = s.slice(i, Math.min(i + 11, s.length));
      tubes.push(new Tube(part, part.map((_, j) => radius((i + j) / (s.length - 1)))));
    }
  };
  const ring = g.ring.map((r) => r.p);
  chunked([...ring, ring[0]], () => 0.5);
  chunked(g.anterior, (t) => lerp(0.48, 0.12, t));
  chunked(g.posterior, (t) => lerp(0.42, 0.12, t));
  return tubes;
}

/** Tube mesh with parallel-transport frames and tapered closed tips. */
export function tubeMesh(path: VesselPath, radial = 10) {
  const { pts, radii } = path;
  const n = pts.length;
  const T: V3[] = pts.map((p, i) => norm(sub(pts[Math.min(i + 1, n - 1)], pts[Math.max(i - 1, 0)])));
  let N: V3 = norm(cross(T[0], Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      const b = cross(T[i - 1], T[i]);
      if (len(b) > 1e-6) {
        const axis = norm(b);
        const ang = Math.acos(Math.max(-1, Math.min(1, dot(T[i - 1], T[i]))));
        // Rodrigues rotation of N around axis
        const c = Math.cos(ang), s = Math.sin(ang);
        N = add(add(mul(N, c), mul(cross(axis, N), s)), mul(axis, dot(axis, N) * (1 - c)));
      }
    }
    const B = cross(T[i], N);
    // taper the last 12% to a rounded tip
    const tipT = i / (n - 1);
    const r = radii[i] * (tipT > 0.88 ? Math.sqrt(Math.max(0.02, 1 - (tipT - 0.88) / 0.12)) : 1);
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const d = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
      pos.push(pts[i][0] + d[0] * r, pts[i][1] + d[1] * r, pts[i][2] + d[2] * r);
      nor.push(d[0], d[1], d[2]);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < radial; k++) {
    const a = i * radial + k, b = i * radial + ((k + 1) % radial);
    const c = a + radial, d = b + radial;
    idx.push(a, c, b, b, c, d);
  }
  // end caps (fans) so the tube is closed
  const cap = (ring: number, center: V3, normal: V3, flip: boolean) => {
    const ci = pos.length / 3;
    pos.push(...center);
    nor.push(...normal);
    for (let k = 0; k < radial; k++) {
      const a = ring * radial + k, b = ring * radial + ((k + 1) % radial);
      if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
    }
  };
  cap(0, pts[0], mul(T[0], -1), false);
  cap(n - 1, pts[n - 1], T[n - 1], true);
  return { positions: new Float32Array(pos), normals: new Float32Array(nor), indices: new Uint32Array(idx) };
}

export { VESSELS };
