// Minimal glTF 2.0 binary writer: triangle meshes with float / normalized-uint8 attributes.

export interface GlbAttribute {
  data: Float32Array | Uint8Array;
  itemSize: number;
}
export interface GlbMesh {
  name: string;
  attributes: Record<string, GlbAttribute>; // e.g. POSITION, NORMAL, _TISSUE
  indices: Uint32Array;
  extras?: Record<string, unknown>;
}

const TYPE: Record<number, string> = { 1: "SCALAR", 2: "VEC2", 3: "VEC3", 4: "VEC4" };

export function writeGlb(meshes: GlbMesh[], assetExtras: Record<string, unknown>): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: object[] = [];
  const accessors: object[] = [];
  const push = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    chunks.push(bytes);
    byteLength += bytes.byteLength;
    return bufferViews.length - 1;
  };

  const gltfMeshes = meshes.map((m) => {
    const attributes: Record<string, number> = {};
    for (const [name, attr] of Object.entries(m.attributes)) {
      const isFloat = attr.data instanceof Float32Array;
      const view = push(new Uint8Array(attr.data.buffer, attr.data.byteOffset, attr.data.byteLength), 34962);
      const count = attr.data.length / attr.itemSize;
      const acc: Record<string, unknown> = {
        bufferView: view, componentType: isFloat ? 5126 : 5121, count, type: TYPE[attr.itemSize],
      };
      if (!isFloat) acc.normalized = true;
      if (name === "POSITION") {
        const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < attr.data.length; i += 3) for (let k = 0; k < 3; k++) {
          min[k] = Math.min(min[k], attr.data[i + k]);
          max[k] = Math.max(max[k], attr.data[i + k]);
        }
        acc.min = min; acc.max = max;
      }
      accessors.push(acc);
      attributes[name] = accessors.length - 1;
    }
    const iv = push(new Uint8Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength), 34963);
    accessors.push({ bufferView: iv, componentType: 5125, count: m.indices.length, type: "SCALAR" });
    return { name: m.name, primitives: [{ attributes, indices: accessors.length - 1, mode: 4 }], extras: m.extras ?? {} };
  });

  const json = {
    asset: { version: "2.0", generator: "cor-heart-studio procedural builder", extras: assetExtras },
    scene: 0,
    scenes: [{ nodes: meshes.map((_, i) => i) }],
    nodes: meshes.map((m, i) => ({ name: m.name, mesh: i })),
    meshes: gltfMeshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jpad = (4 - (jsonBytes.length % 4)) % 4;
  if (jpad) {
    const padded = new Uint8Array(jsonBytes.length + jpad).fill(0x20);
    padded.set(jsonBytes);
    jsonBytes = padded;
  }
  const binPad = (4 - (byteLength % 4)) % 4;
  const total = 12 + 8 + jsonBytes.length + 8 + byteLength + binPad;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  let o = 20 + jsonBytes.length;
  dv.setUint32(o, byteLength + binPad, true);
  dv.setUint32(o + 4, 0x004e4942, true);
  o += 8;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}
