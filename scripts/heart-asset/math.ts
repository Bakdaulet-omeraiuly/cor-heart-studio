// Small allocation-light vector + SDF helpers for the offline heart asset builder.
// Coordinates are centimetres in the patient frame: +X = patient left, +Y = superior, +Z = anterior.

export type V3 = [number, number, number];

export const v = (x: number, y: number, z: number): V3 => [x, y, z];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => mul(a, 1 / (len(a) || 1));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerp3 = (a: V3, b: V3, t: number): V3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Orthonormal frame whose second axis is `axis` (local y = long axis). */
export interface Frame {
  origin: V3;
  ex: V3;
  ey: V3;
  ez: V3;
}
export function frameFromAxis(origin: V3, axis: V3, hint: V3 = [0, 0, 1]): Frame {
  const ey = norm(axis);
  let ex = norm(cross(hint, ey));
  if (len(cross(hint, ey)) < 1e-4) ex = norm(cross([1, 0, 0], ey));
  const ez = cross(ex, ey);
  return { origin, ex, ey, ez };
}
export function toLocal(f: Frame, x: number, y: number, z: number): V3 {
  const dx = x - f.origin[0], dy = y - f.origin[1], dz = z - f.origin[2];
  return [
    dx * f.ex[0] + dy * f.ex[1] + dz * f.ex[2],
    dx * f.ey[0] + dy * f.ey[1] + dz * f.ey[2],
    dx * f.ez[0] + dy * f.ez[1] + dz * f.ez[2],
  ];
}

// ---- SDF primitives / operators (after Inigo Quilez) ----

export function sdEllipsoid(px: number, py: number, pz: number, rx: number, ry: number, rz: number) {
  const k0 = Math.hypot(px / rx, py / ry, pz / rz);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
export const smax = (a: number, b: number, k: number) => -smin(-a, -b, k);

/** Distance to a box; used as a cheap lower bound for far-field culling. */
export function aabbDistance(x: number, y: number, z: number, min: V3, max: V3) {
  const dx = Math.max(min[0] - x, 0, x - max[0]);
  const dy = Math.max(min[1] - y, 0, y - max[1]);
  const dz = Math.max(min[2] - z, 0, z - max[2]);
  return Math.hypot(dx, dy, dz);
}

// ---- Deterministic noise (seeded value-gradient noise; no Math.random anywhere) ----

const PERM = (() => {
  const p = new Uint8Array(512);
  let s = 1337;
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();
const G = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1],
  [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
function grad(h: number, x: number, y: number, z: number) {
  const g = G[h % 12];
  return g[0] * x + g[1] * y + g[2] * z;
}
/** Classic Perlin noise in [-1, 1] (approximately). */
export function noise3(x: number, y: number, z: number) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), w = fade(y), q = fade(z);
  const A = PERM[X] + Y, AA = PERM[A] + Z, AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y, BA = PERM[B] + Z, BB = PERM[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u), w),
    lerp(lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u), w),
    q,
  );
}
export function fbm(x: number, y: number, z: number, oct = 3) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

// ---- Curves ----

/** Catmull-Rom sampled polyline through control points. */
export function catmull(points: V3[], samplesPerSpan = 8): V3[] {
  const out: V3[] = [];
  const P = (i: number) => points[clamp(i, 0, points.length - 1)];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let s = 0; s < samplesPerSpan; s++) {
      const t = s / samplesPerSpan, t2 = t * t, t3 = t2 * t;
      const c = (k: 0 | 1 | 2) =>
        0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 +
          (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([c(0), c(1), c(2)]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** A tapered tube along a polyline; SDF is exact-ish for slowly varying radius. */
export class Tube {
  readonly pts: V3[];
  readonly radii: number[];
  readonly min: V3;
  readonly max: V3;
  constructor(pts: V3[], radii: number[]) {
    this.pts = pts;
    this.radii = radii;
    const rMax = Math.max(...radii);
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
    for (const p of pts) for (let k = 0; k < 3; k++) {
      this.min[k] = Math.min(this.min[k], p[k] - rMax);
      this.max[k] = Math.max(this.max[k], p[k] + rMax);
    }
  }
  static fromControl(ctrl: V3[], radii: number[], samples = 8) {
    const pts = catmull(ctrl, samples);
    // radii given per control point -> interpolate along samples
    const r = pts.map((_, i) => {
      const t = (i / (pts.length - 1)) * (radii.length - 1);
      const i0 = Math.floor(t);
      return lerp(radii[i0], radii[Math.min(i0 + 1, radii.length - 1)], t - i0);
    });
    return new Tube(pts, r);
  }
  /** Signed distance; `inflate` offsets the radius (negative -> lumen). */
  sd(x: number, y: number, z: number, inflate = 0, cull = 1.5) {
    const lb = aabbDistance(x, y, z, this.min, this.max);
    if (lb > cull) return lb;
    let best = Infinity;
    const { pts, radii } = this;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
      const d = Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - (lerp(radii[i], radii[i + 1], h) + inflate);
      if (d < best) best = d;
    }
    return best;
  }
  /** Closest point parameter info: returns [distanceToAxis, arcFraction]. */
  closest(x: number, y: number, z: number): [number, number] {
    let best = Infinity, bestT = 0;
    const { pts } = this;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
      const pax = x - a[0], pay = y - a[1], paz = z - a[2];
      const h = clamp((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0, 1);
      const d = Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h);
      if (d < best) { best = d; bestT = (i + h) / (pts.length - 1); }
    }
    return [best, bestT];
  }
}
