"use client";
// Loads one published brain subject: manifest, meshes (GLB) and the 8-bit slice volumes.
import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { BrainManifest } from "./types";

export const BRAIN_SUBJECTS = [{ id: "MMRR-21-5", base: "/brain/MMRR-21-5/" }];

export interface BrainData {
  manifest: BrainManifest;
  meshes: { name: string; geometry: THREE.BufferGeometry; group: string }[];
  mri: Uint8Array;
  labels: Uint8Array;
}

/** gzip bytes -> raw bytes; passes data through if a server already decoded it. */
async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const bytes = new Uint8Array(buf);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function fetchOk(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} failed to load (HTTP ${res.status})`);
  return res;
}

const cache = new Map<string, Promise<BrainData>>();

export function loadBrain(base: string): Promise<BrainData> {
  let p = cache.get(base);
  if (!p) {
    p = (async () => {
      const manifest = (await (await fetchOk(`${base}brain-manifest.json`)).json()) as BrainManifest;
      const [glb, mri, labels] = await Promise.all([
        fetchOk(base + manifest.files.low.url).then((r) => r.arrayBuffer()),
        fetchOk(base + manifest.volume.mri).then((r) => r.arrayBuffer()).then(gunzip),
        fetchOk(base + manifest.volume.labels).then((r) => r.arrayBuffer()).then(gunzip),
      ]);
      const n = manifest.volume.dims.reduce((a, b) => a * b, 1);
      if (mri.length !== n || labels.length !== n) throw new Error("Brain volume size does not match its manifest");
      const gltf = await new GLTFLoader().parseAsync(glb, "");
      const meshes: BrainData["meshes"] = [];
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) meshes.push({ name: m.name, geometry: m.geometry, group: (m.userData?.group as string) ?? "" });
      });
      return { manifest, meshes, mri, labels };
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
