// Asset adapter for the procedural COR heart (manifest-described GLB). A licensed GLB with the same
// attribute contract (_weights, _tissue) and manifest fields can replace it — see docs/asset-pipeline.md.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import manifest from "./procedural-heart-v1.manifest.json";

export type Lod = "low" | "high";

export interface HeartAsset {
  lod: Lod;
  tissue: THREE.BufferGeometry;
  coronaryArteries: THREE.BufferGeometry;
  cardiacVeins: THREE.BufferGeometry;
  sampler: AttributeSampler;
  bytes: number;
}

export const HEART_MANIFEST = manifest;
/** Centre of the heart in asset space (used to put the organ at the scene origin). */
export const HEART_CENTER = new THREE.Vector3(0.75, 1.55, -0.55).multiplyScalar(1.15);

const cache = new Map<Lod, Promise<HeartAsset>>();

export function loadHeartAsset(lod: Lod): Promise<HeartAsset> {
  let p = cache.get(lod);
  if (!p) {
    p = (async () => {
      const url = manifest.files[lod].url;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Heart asset ${url} failed to load (HTTP ${res.status})`);
      const buf = await res.arrayBuffer();
      const gltf = await new GLTFLoader().parseAsync(buf, "");
      const byName = (n: string) => {
        let g: THREE.BufferGeometry | undefined;
        gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh && o.name === n) g = (o as THREE.Mesh).geometry; });
        if (!g) throw new Error(`Heart asset is missing mesh "${n}"`);
        if (!g.getAttribute("_weights") || !g.getAttribute("_tissue")) throw new Error(`Mesh "${n}" lacks the _weights/_tissue attribute contract`);
        return g;
      };
      const tissue = byName("heart_tissue");
      return {
        lod,
        tissue,
        coronaryArteries: byName("coronary_arteries"),
        cardiacVeins: byName("cardiac_veins"),
        sampler: new AttributeSampler(tissue),
        bytes: buf.byteLength,
      };
    })();
    p.catch(() => cache.delete(lod));
    cache.set(lod, p);
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
  a.coronaryArteries.dispose();
  a.cardiacVeins.dispose();
}
