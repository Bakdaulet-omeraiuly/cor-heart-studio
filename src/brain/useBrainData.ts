"use client";
// Loads one published brain subject: manifest, meshes (GLB) and the 8-bit slice volumes.
import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { fetchOk, fetchVolumeBytes } from "@/imaging/loadVolume";
import type { SliceVolume } from "@/imaging/types";
import type { BrainManifest } from "./types";

export const BRAIN_SUBJECTS = [{ id: "MMRR-21-5", base: "/brain/MMRR-21-5/" }];

export interface BrainData {
  manifest: BrainManifest;
  meshes: { name: string; geometry: THREE.BufferGeometry; group: string }[];
  mri: Uint8Array;
  labels: Uint8Array;
  /** The MRI + segmentation as shown by the slice views. */
  vol: SliceVolume;
}

const cache = new Map<string, Promise<BrainData>>();

export function loadBrain(base: string): Promise<BrainData> {
  let p = cache.get(base);
  if (!p) {
    p = (async () => {
      const manifest = (await (await fetchOk(`${base}brain-manifest.json`)).json()) as BrainManifest;
      const n = manifest.volume.dims.reduce((a, b) => a * b, 1);
      const [glb, mri, labels] = await Promise.all([
        fetchOk(base + manifest.files.low.url).then((r) => r.arrayBuffer()),
        fetchVolumeBytes(base + manifest.volume.mri, n),
        fetchVolumeBytes(base + manifest.volume.labels, n),
      ]);
      const gltf = await new GLTFLoader().parseAsync(glb, "");
      const meshes: BrainData["meshes"] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        // the full-resolution cortex ships without normals (smaller file): compute them here
        if (!m.geometry.getAttribute("normal")) m.geometry.computeVertexNormals();
        meshes.push({ name: m.name, geometry: m.geometry, group: (m.userData?.group as string) ?? "" });
      });
      const { dims, spacingMm, voxelToApp } = manifest.volume;
      return { manifest, meshes, mri, labels, vol: { dims, spacingMm, voxelToApp, image: mri, labels, structures: manifest.structures } };
    })();
    p.catch(() => cache.delete(base));
    cache.set(base, p);
  }
  return p;
}

export function useBrainData(base: string) {
  const [state, setState] = useState<{ data: BrainData | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let alive = true;
    loadBrain(base).then((data) => alive && setState({ data, error: null })).catch((e: Error) => alive && setState({ data: null, error: e.message }));
    return () => { alive = false; };
  }, [base]);
  return state;
}
