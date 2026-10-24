// Asset adapter for manifest-described heart GLBs (the procedural COR heart and CT-derived Tier B
// hearts, see registry.ts). Any GLB with the attribute contract (_weights, _tissue) and the manifest
// fields can be added — see docs/asset-pipeline.md.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { HeartAssetSpec } from "./registry";

export type Lod = "low" | "high";

export interface HeartAsset {
  specId: string;
  lod: Lod;
  tissue: THREE.BufferGeometry;
  /** Absent when the source has no coronary vessels (CT segmentations without coronary labels). */
  coronaryArteries: THREE.BufferGeometry | null;
  cardiacVeins: THREE.BufferGeometry | null;
  sampler: AttributeSampler;
  bytes: number;
}

/** Centre of the heart in asset space (the scene puts it at the origin). */
export const specCenter = (spec: HeartAssetSpec) => new THREE.Vector3(...spec.center);

const cache = new Map<string, Promise<HeartAsset>>();

export function loadHeartAsset(spec: HeartAssetSpec, lod: Lod): Promise<HeartAsset> {
  const key = `${spec.id}:${lod}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const url = spec.manifest.files[lod].url;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Heart asset ${url} failed to load (HTTP ${res.status})`);
      const buf = await res.arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buf, "");
      const byName = (n: string) => {
        let g: THREE.BufferGeometry | undefined;
        gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === n) g = (o as THREE.Mesh).geometry; });
        if (g && (!g.getAttribute("_weights") || !g.getAttribute("_tissue"))) throw new Error(`Mesh "${n}" lacks the _weights/_tissue attribute contract`);
        return g ?? null;
      };
      const tissue = byName("heart_tissue");
      if (!tissue) throw new Error(`Heart asset ${url} is missing mesh "heart_tissue"`);
      return {
        specId: spec.id,
        lod,
        tissue,
        coronaryArteries: byName("coronary_arteries"),
        cardiacVeins: byName("cardiac_veins"),
        sampler: new AttributeSampler(tissue),
        bytes: buf.byteLength,
      };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

export interface SampledAttributes { w: [number, number, number, number]; depth: number; region: number }

/** Nearest-vertex attribute lookup (uniform grid) to attach runtime parts (valves, labels) to the tissue. */
export class AttributeSampler {
  private cell = 0.5;
  private grid = new Map<string, number[]>();
  constructor(private geom: THREE.BufferGeometry) {
    const p = geom.getAttribute("position");
    for (let i = 0; i < p.count; i += 2) {
      const k = this.key(p.getX(i), p.getY(i), p.getZ(i));
      let b = this.grid.get(k);
      if (!b) this.grid.set(k, (b = []));
      b.push(i);
    }
  }
  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)},${Math.floor(z / this.cell)}`;
  }
  nearest(v: THREE.Vector3, filter?: (region: number, depth: number) => boolean): SampledAttributes {
    const p = this.geom.getAttribute("position");
    const w = this.geom.getAttribute("_weights");
    const t = this.geom.getAttribute("_tissue");
    let best = -1, bestD = Infinity;
    for (let r = 1; r <= 4 && best < 0; r++) {
      const cx = Math.floor(v.x / this.cell), cy = Math.floor(v.y / this.cell), cz = Math.floor(v.z / this.cell);
      for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (let k = -r; k <= r; k++) {
        const b = this.grid.get(`${cx + i},${cy + j},${cz + k}`);
        if (!b) continue;
        for (const idx of b) {
          if (filter && !filter(Math.round(t.getW(idx) * 255), t.getX(idx))) continue;
          const d = (p.getX(idx) - v.x) ** 2 + (p.getY(idx) - v.y) ** 2 + (p.getZ(idx) - v.z) ** 2;
          if (d < bestD) { bestD = d; best = idx; }
        }
      }
    }
    if (best < 0) return { w: [0, 0, 0, 0], depth: 0, region: 4 };
    return {
      w: [w.getX(best), w.getY(best), w.getZ(best), w.getW(best)],
      depth: t.getX(best),
      region: Math.round(t.getW(best) * 255),
    };
  }
}

export function disposeHeartAsset(a: HeartAsset) {
  a.tissue.dispose();
  a.coronaryArteries?.dispose();
  a.cardiacVeins?.dispose();
}
