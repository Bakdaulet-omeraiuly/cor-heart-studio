// MPR geometry on the published brain volume: orientation conventions and voxel <-> app <-> screen.
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { appToVoxel, flatIndex, renderSlice, screenToVoxel, viewMapping, voxelToApp, voxelToScreen, type Vec3 } from "@/imaging/sliceGeometry";
import type { BrainManifest, ViewId } from "@/brain/types";
import { ROOT } from "./helpers";

const dir = resolve(ROOT, "public/brain/MMRR-21-5");
const manifest = JSON.parse(readFileSync(resolve(dir, "brain-manifest.json"), "utf8")) as BrainManifest;
const labels = new Uint8Array(gunzipSync(readFileSync(resolve(dir, "labels.u8.gz"))));
const mri = new Uint8Array(gunzipSync(readFileSync(resolve(dir, "mri.u8.gz"))));
const { dims, voxelToApp: M } = manifest.volume;
const byKey = (k: string) => manifest.structures.find((s) => s.key === k)!;

/** Centroid of a structure in voxel space. */
function centroid(index: number): Vec3 {
  const c: Vec3 = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < dims[0]; i++) for (let j = 0; j < dims[1]; j++) for (let k = 0; k < dims[2]; k++) {
    if (labels[flatIndex(dims, i, j, k)] !== index) continue;
    c[0] += i; c[1] += j; c[2] += k; n++;
  }
  return c.map((v) => v / n) as Vec3;
}

describe("brain volume", () => {
  it("matches its manifest", () => {
    expect(labels.length).toBe(dims[0] * dims[1] * dims[2]);
    expect(mri.length).toBe(labels.length);
    expect(Math.max(...new Set(labels))).toBe(manifest.structures.length);
  });

  it("voxel <-> app round-trips", () => {
    const p: Vec3 = [10.5, 20, 30.25];
    const back = appToVoxel(M, voxelToApp(M, p));
    back.forEach((v, i) => expect(v).toBeCloseTo(p[i], 6));
  });

  it("label volumes equal the manifest's measurements", () => {
    const voxelMl = manifest.volume.spacingMm.reduce((a, b) => a * b, 1) / 1000;
    for (const key of ["hippocampus_lh", "thalamus_rh", "brainstem"]) {
      const s = byKey(key);
      const n = labels.reduce((acc, l) => acc + (l === s.index ? 1 : 0), 0);
      expect(n * voxelMl).toBeCloseTo(s.volumeMl, 1);
    }
  });
});

describe("orientation", () => {
  const lh = centroid(byKey("hippocampus_lh").index), rh = centroid(byKey("hippocampus_rh").index);
  const thal = centroid(byKey("thalamus_lh").index);
  const cc = centroid(byKey("corpus_callosum").index);
  const stem = centroid(byKey("brainstem").index);

  it("left structures lie at +X (patient left), the brainstem below the corpus callosum", () => {
    expect(voxelToApp(M, lh)[0]).toBeGreaterThan(voxelToApp(M, rh)[0]);
    expect(voxelToApp(M, stem)[1]).toBeLessThan(voxelToApp(M, cc)[1]);
  });

  it.each(["axial", "coronal"] as ViewId[])("%s view shows the patient's left on screen right", (view) => {
    const map = viewMapping(M, view);
    expect(voxelToScreen(map, dims, lh)[0]).toBeGreaterThan(voxelToScreen(map, dims, rh)[0]);
  });

  it("superior is up on coronal and sagittal; anterior is left on sagittal", () => {
    for (const view of ["coronal", "sagittal"] as ViewId[]) {
      const map = viewMapping(M, view);
      expect(voxelToScreen(map, dims, cc)[1]).toBeLessThan(voxelToScreen(map, dims, stem)[1]);
    }
    // caudate head is anterior to the cerebellum: further left on the sagittal view
    const sag = viewMapping(M, "sagittal");
    const caudate = centroid(byKey("caudate_lh").index), cereb = centroid(byKey("cerebellum_lh").index);
    expect(voxelToScreen(sag, dims, caudate)[0]).toBeLessThan(voxelToScreen(sag, dims, cereb)[0]);
    expect(voxelToApp(M, thal)[1]).toBeGreaterThan(voxelToApp(M, stem)[1]);
  });

  it("screen <-> voxel round-trips on every view", () => {
    for (const view of ["axial", "coronal", "sagittal"] as ViewId[]) {
      const map = viewMapping(M, view);
      const ijk: Vec3 = [40, 70, 90];
      const [u, v] = voxelToScreen(map, dims, ijk);
      expect(screenToVoxel(map, dims, ijk[map.slice.axis], u, v)).toEqual(ijk);
    }
  });
});

describe("slice rendering", () => {
  it("draws the label colour where a structure is and plain grey elsewhere", () => {
    const s = byKey("thalamus_lh");
    const c = centroid(s.index).map(Math.round) as Vec3;
    const map = viewMapping(M, "axial");
    const colours = [[0, 0, 0], ...manifest.structures.map((x) => x.colour)];
    const style = { windowCenter: 128, windowWidth: 256, overlay: "fill" as const, overlayOpacity: 0.5, selected: 0, colours };
    const { width, pixels } = renderSlice(mri, labels, dims, map, c[map.slice.axis], style);
    const [u, v] = voxelToScreen(map, dims, c);
    const o = (v * width + u) * 4;
    expect(labels[flatIndex(dims, ...c)]).toBe(s.index);
    // tinted: not grey
    expect(Math.abs(pixels[o] - pixels[o + 2]) + Math.abs(pixels[o + 1] - pixels[o + 2])).toBeGreaterThan(5);
    const off = renderSlice(mri, labels, dims, map, c[map.slice.axis], { ...style, overlay: "off" }).pixels;
    expect(off[o]).toBe(off[o + 1]);
    expect(off[o + 1]).toBe(off[o + 2]);
  });
});

describe("COR-Fit fidelity of the published brain", () => {
  it("passes the publication gate and scores every structure", () => {
    const f = manifest.fidelity;
    expect(f.overall.nsdPercent).toBeGreaterThanOrEqual(95);
    expect(f.structures.length).toBe(manifest.structures.length);
    for (const r of f.structures.filter((x) => x.volumeErrorPercent !== undefined)) expect(Math.abs(r.volumeErrorPercent!)).toBeLessThanOrEqual(5);
  });
});
