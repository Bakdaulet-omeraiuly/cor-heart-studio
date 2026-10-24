// Multiplanar reformat (MPR) geometry on the voxel grid: which voxel axis each view slices through and
// how voxel axes map to screen axes. Pure functions (unit-tested), no DOM.
//
// Screen conventions (radiological): axial and coronal show the patient's left on screen right;
// axial has anterior up; sagittal has anterior on the left and superior up.
export type Vec3 = [number, number, number];
export type ViewId = "axial" | "coronal" | "sagittal";

/** App-frame directions: +X patient left, +Y superior, +Z anterior. */
const VIEW_AXES: Record<ViewId, { normal: Vec3; right: Vec3; up: Vec3 }> = {
  axial: { normal: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  coronal: { normal: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  sagittal: { normal: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
};

export interface AxisMap { axis: 0 | 1 | 2; sign: 1 | -1 }
export interface ViewMapping { slice: AxisMap; right: AxisMap; up: AxisMap }

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Voxel axis (and direction) that best matches an app-frame direction. */
function matchAxis(m: number[][], dir: Vec3, used: number[]): AxisMap {
  let best: AxisMap = { axis: 0, sign: 1 }, bestDot = -1;
  for (const a of [0, 1, 2] as const) {
    if (used.includes(a)) continue;
    const col = [m[0][a], m[1][a], m[2][a]];
    const d = dot(col, dir) / Math.hypot(...col);
    if (Math.abs(d) > bestDot) { bestDot = Math.abs(d); best = { axis: a, sign: d >= 0 ? 1 : -1 }; }
  }
  return best;
}

export function viewMapping(voxelToApp: number[][], view: ViewId): ViewMapping {
  const v = VIEW_AXES[view];
  const slice = matchAxis(voxelToApp, v.normal, []);
  const right = matchAxis(voxelToApp, v.right, [slice.axis]);
  const up = matchAxis(voxelToApp, v.up, [slice.axis, right.axis]);
  return { slice, right, up };
}

export function voxelToApp(m: number[][], ijk: Vec3): Vec3 {
  return [0, 1, 2].map((r) => m[r][0] * ijk[0] + m[r][1] * ijk[1] + m[r][2] * ijk[2] + m[r][3]) as Vec3;
}

export function appToVoxel(m: number[][], p: Vec3): Vec3 {
  // inverse of the 3x3 part (general, not assumed orthogonal), then subtract translation
  const a = m[0][0], b = m[0][1], c = m[0][2], d = m[1][0], e = m[1][1], f = m[1][2], g = m[2][0], h = m[2][1], k = m[2][2];
  const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
  const q = [p[0] - m[0][3], p[1] - m[1][3], p[2] - m[2][3]];
  return [
    ((e * k - f * h) * q[0] + (c * h - b * k) * q[1] + (b * f - c * e) * q[2]) / det,
    ((f * g - d * k) * q[0] + (a * k - c * g) * q[1] + (c * d - a * f) * q[2]) / det,
    ((d * h - e * g) * q[0] + (b * g - a * h) * q[1] + (a * e - b * d) * q[2]) / det,
  ];
}

export const flatIndex = (dims: number[], i: number, j: number, k: number) => (i * dims[1] + j) * dims[2] + k;

/** Screen pixel (u right, v down) on a view at a slice index -> voxel ijk. */
export function screenToVoxel(map: ViewMapping, dims: number[], sliceIndex: number, u: number, v: number): Vec3 {
  const ijk: Vec3 = [0, 0, 0];
  ijk[map.slice.axis] = sliceIndex;
  const nR = dims[map.right.axis], nU = dims[map.up.axis];
  ijk[map.right.axis] = map.right.sign > 0 ? u : nR - 1 - u;
  ijk[map.up.axis] = map.up.sign > 0 ? nU - 1 - v : v;
  return ijk;
}

/** Voxel ijk -> screen pixel (u, v) on a view. */
export function voxelToScreen(map: ViewMapping, dims: number[], ijk: Vec3): [number, number] {
  const nR = dims[map.right.axis], nU = dims[map.up.axis];
  const r = ijk[map.right.axis], up = ijk[map.up.axis];
  return [map.right.sign > 0 ? r : nR - 1 - r, map.up.sign > 0 ? nU - 1 - up : up];
}

export interface SliceStyle {
  windowCenter: number; // 0..255 on the 8-bit volume
  windowWidth: number;
  overlay: "fill" | "outline" | "off";
  overlayOpacity: number; // 0..1
  /** Structure index highlighted at full strength (others dimmed) or 0. */
  selected: number;
  /** colours[index] = [r, g, b] 0..1; index 0 unused. */
  colours: ArrayLike<number>[];
  hidden?: Set<number>;
}

/** Render one slice into RGBA pixels (width = dims[right], height = dims[up]). */
export function renderSlice(
  mri: Uint8Array, labels: Uint8Array, dims: number[], map: ViewMapping, sliceIndex: number, style: SliceStyle, out?: Uint8ClampedArray<ArrayBuffer>,
): { width: number; height: number; pixels: Uint8ClampedArray<ArrayBuffer> } {
  const width = dims[map.right.axis], height = dims[map.up.axis];
  const pixels = out && out.length === width * height * 4 ? out : new Uint8ClampedArray(width * height * 4);
  const lo = style.windowCenter - style.windowWidth / 2;
  const scale = 255 / Math.max(1, style.windowWidth);
  const label = (u: number, v: number) => {
    if (u < 0 || v < 0 || u >= width || v >= height) return 0;
    const [i, j, k] = screenToVoxel(map, dims, sliceIndex, u, v);
    return labels[flatIndex(dims, i, j, k)];
  };
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const [i, j, k] = screenToVoxel(map, dims, sliceIndex, u, v);
      const idx = flatIndex(dims, i, j, k);
      const g = Math.max(0, Math.min(255, (mri[idx] - lo) * scale));
      let r = g, gg = g, b = g;
      const l = labels[idx];
      if (l && style.overlay !== "off" && !style.hidden?.has(l)) {
        const edge = label(u - 1, v) !== l || label(u + 1, v) !== l || label(u, v - 1) !== l || label(u, v + 1) !== l;
        const strength = style.selected ? (l === style.selected ? 1 : 0.35) : 1;
        const a = style.overlay === "outline" ? (edge ? 0.95 * strength : 0) : (edge ? 0.9 : style.overlayOpacity) * strength;
        if (a > 0) {
          const c = style.colours[l];
          r = g + (c[0] * 255 - g) * a; gg = g + (c[1] * 255 - g) * a; b = g + (c[2] * 255 - g) * a;
        }
      }
      const o = (v * width + u) * 4;
      pixels[o] = r; pixels[o + 1] = gg; pixels[o + 2] = b; pixels[o + 3] = 255;
    }
  }
  return { width, height, pixels };
}

/** Physical size (mm) of a view's image, for an aspect-correct display. */
export function viewSizeMm(volume: { dims: number[]; spacingMm: number[] }, map: ViewMapping): [number, number] {
  const { dims, spacingMm } = volume;
  return [dims[map.right.axis] * spacingMm[map.right.axis], dims[map.up.axis] * spacingMm[map.up.axis]];
}
