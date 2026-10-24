// Naive Surface Nets with coarse-grid culling, Newton refinement and SDF-gradient normals.
import type { V3 } from "./math.ts";

export type Field = (x: number, y: number, z: number) => number;

export interface RawMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

export function surfaceNets(f: Field, min: V3, max: V3, h: number, log: (msg: string) => void = () => {}): RawMesh {
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const N = nx * ny * nz;
  const vals = new Float32Array(N);
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  const px = (i: number) => min[0] + i * h;
  const py = (j: number) => min[1] + j * h;
  const pz = (k: number) => min[2] + k * h;

  // ---- coarse pass
  const C = 4;
  const cx = Math.ceil((nx - 1) / C) + 1, cy = Math.ceil((ny - 1) / C) + 1, cz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k++) for (let j = 0; j < cy; j++) for (let i = 0; i < cx; i++) {
    coarse[i + cx * (j + cy * k)] = f(px(Math.min(i * C, nx - 1)), py(Math.min(j * C, ny - 1)), pz(Math.min(k * C, nz - 1)));
  }
  log(`coarse ${cx}x${cy}x${cz} done`);
  const blockDiag = Math.sqrt(3) * C * h * 1.6; // generous Lipschitz margin for approximate SDFs
  let exact = 0;
  for (let bk = 0; bk < cz - 1; bk++) for (let bj = 0; bj < cy - 1; bj++) for (let bi = 0; bi < cx - 1; bi++) {
    const c = (a: number, b: number, d: number) => coarse[bi + a + cx * (bj + b + cy * (bk + d))];
    const cs = [c(0, 0, 0), c(1, 0, 0), c(0, 1, 0), c(1, 1, 0), c(0, 0, 1), c(1, 0, 1), c(0, 1, 1), c(1, 1, 1)];
    const far = cs.every((q) => q > blockDiag) || cs.every((q) => q < -blockDiag);
    const i0 = bi * C, j0 = bj * C, k0 = bk * C;
    for (let k = k0; k <= Math.min(k0 + C, nz - 1); k++) for (let j = j0; j <= Math.min(j0 + C, ny - 1); j++) for (let i = i0; i <= Math.min(i0 + C, nx - 1); i++) {
      if (far) {
        const tx = (i - i0) / C, ty = (j - j0) / C, tz = (k - k0) / C;
        const a = cs[0] + (cs[1] - cs[0]) * tx, b = cs[2] + (cs[3] - cs[2]) * tx;
        const c2 = cs[4] + (cs[5] - cs[4]) * tx, d2 = cs[6] + (cs[7] - cs[6]) * tx;
        const e = a + (b - a) * ty, g = c2 + (d2 - c2) * ty;
        vals[idx(i, j, k)] = e + (g - e) * tz;
      } else {
        vals[idx(i, j, k)] = f(px(i), py(j), pz(k));
        exact++;
      }
    }
  }
  log(`fine grid ${nx}x${ny}x${nz}, exact samples ${exact}`);

  // ---- vertices
  const cellVert = new Int32Array(N).fill(-1);
  const pos: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float64Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let q = 0; q < 8; q++) {
      const [a, b, c] = corners[q];
      cv[q] = vals[idx(i + a, j + b, k + c)];
      if (cv[q] < 0) mask |= 1 << q;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [e0, e1] of edges) {
      const a = cv[e0], b = cv[e1];
      if ((a < 0) === (b < 0)) continue;
      const t = a / (a - b);
      const A = corners[e0], B = corners[e1];
      sx += A[0] + (B[0] - A[0]) * t;
      sy += A[1] + (B[1] - A[1]) * t;
      sz += A[2] + (B[2] - A[2]) * t;
      n++;
    }
    cellVert[idx(i, j, k)] = pos.length / 3;
    pos.push(px(i) + (sx / n) * h, py(j) + (sy / n) * h, pz(k) + (sz / n) * h);
  }

  // ---- faces: one quad per sign-changing grid edge
  const tri: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // split along the shorter diagonal
    const dist = (u: number, w: number) => Math.hypot(pos[u * 3] - pos[w * 3], pos[u * 3 + 1] - pos[w * 3 + 1], pos[u * 3 + 2] - pos[w * 3 + 2]);
    const q = flip ? [a, d, c, b] : [a, b, c, d];
    if (dist(q[0], q[2]) <= dist(q[1], q[3])) tri.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    else tri.push(q[0], q[1], q[3], q[1], q[2], q[3]);
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = vals[idx(i, j, k)];
    const in0 = v0 < 0;
    // x edge
    if (i < nx - 1 && in0 !== (vals[idx(i + 1, j, k)] < 0)) {
      quad(cellVert[idx(i, j - 1, k - 1)], cellVert[idx(i, j, k - 1)], cellVert[idx(i, j, k)], cellVert[idx(i, j - 1, k)], !in0);
    }
    if (j < ny - 1 && in0 !== (vals[idx(i, j + 1, k)] < 0)) {
      quad(cellVert[idx(i - 1, j, k - 1)], cellVert[idx(i - 1, j, k)], cellVert[idx(i, j, k)], cellVert[idx(i, j, k - 1)], !in0);
    }
    if (k < nz - 1 && in0 !== (vals[idx(i, j, k + 1)] < 0)) {
      quad(cellVert[idx(i - 1, j - 1, k)], cellVert[idx(i, j - 1, k)], cellVert[idx(i, j, k)], cellVert[idx(i - 1, j, k)], !in0);
    }
  }
  log(`surface nets: ${pos.length / 3} vertices, ${tri.length / 3} triangles`);

  // ---- refine + normals
  const P = new Float32Array(pos);
  const Nn = new Float32Array(P.length);
  const e = h * 0.25;
  for (let v = 0; v < P.length; v += 3) {
    let x = P[v], y = P[v + 1], z = P[v + 2];
    let gx = 0, gy = 0, gz = 0;
    for (let it = 0; it < 2; it++) {
      const d = f(x, y, z);
      gx = f(x + e, y, z) - f(x - e, y, z);
      gy = f(x, y + e, z) - f(x, y - e, z);
      gz = f(x, y, z + e) - f(x, y, z - e);
      const gl = Math.hypot(gx, gy, gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      const step = Math.max(-h * 0.45, Math.min(h * 0.45, d));
      x -= gx * step; y -= gy * step; z -= gz * step;
    }
    P[v] = x; P[v + 1] = y; P[v + 2] = z;
    Nn[v] = gx; Nn[v + 1] = gy; Nn[v + 2] = gz;
  }
  const indices = new Uint32Array(tri);
  // orientation check: triangle normal should agree with the field gradient
  let agree = 0, disagree = 0;
  for (let t = 0; t < indices.length; t += 3 * 50) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const wx = P[c] - P[a], wy = P[c + 1] - P[a + 1], wz = P[c + 2] - P[a + 2];
    const n = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
    if (n[0] * Nn[a] + n[1] * Nn[a + 1] + n[2] * Nn[a + 2] >= 0) agree++; else disagree++;
  }
  if (disagree > agree) {
    for (let t = 0; t < indices.length; t += 3) {
      const tmp = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = tmp;
    }
    log(`flipped winding (${agree}/${disagree})`);
  } else log(`winding ok (${agree}/${disagree})`);
  return { positions: P, normals: Nn, indices };
}

/** Signed volume of a closed triangle mesh (divergence theorem). */
export function meshVolume(P: ArrayLike<number>, I: ArrayLike<number>) {
  let s = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    s += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1])
      - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c])
      + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]);
  }
  return s / 6;
}
