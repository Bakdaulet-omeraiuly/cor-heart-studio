// Builds the procedural anatomical heart asset (GLB, two LODs) and its manifest.
//   node scripts/heart-asset/build.ts            -> full build into public/models + src/scene/asset-adapters
//   node scripts/heart-asset/build.ts --quick    -> coarse build for shape iteration
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LA_CENTER, LV_AXIS, LV_BASE, LV_CAVITY_BASE_LY, LV_APEX_LY, MODEL, PAPILLARY, RA_CENTER, RV_INFO, VALVES,
  VESSELS, type VesselKey, evalParts, fatField, laCavityProxy, lvAngleBasis, lvCavityProxy, newParts, outerField,
  setFat, solidField,
} from "./anatomy.ts";
import { buildCoronaryNetwork, deriveGrooves, fatTubes, tubeMesh } from "./coronary.ts";
import { surfaceNets, meshVolume, type RawMesh } from "./surface-nets.ts";
import { writeGlb, type GlbMesh } from "./glb.ts";
import { type V3, add, dot, mul, sub, clamp, smoothstep, smin } from "./math.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const quick = process.argv.includes("--quick");
const outDir = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? resolve(ROOT, "public/models");
const log = (s: string) => console.log(`[heart] ${s}`);

/** Uniform scale from modelling units to the exported asset (cm). Chosen so the LV cavity is adult-sized. */
const S = 1.15;
const BOUNDS_MIN: V3 = [-5.6, -8.2, -6.8];
const BOUNDS_MAX: V3 = [6.9, 11.0, 5.8];

export const REGION_IDS = ["lv", "rv", "la", "ra", "aorta", "pulmonary_artery", "vena_cava", "pulmonary_veins", "coronary_vessels"] as const;
const VESSEL_REGION: Record<VesselKey, number> = {
  aorta: 4, brachiocephalic: 4, leftCarotid: 4, leftSubclavian: 4,
  pulmonaryTrunk: 5, lpa: 5, rpa: 5, svc: 6, ivc: 6, lspv: 7, lipv: 7, rspv: 7, ripv: 7,
};
const VESSEL_KEYS = Object.keys(VESSELS) as VesselKey[];
// tissue kinds (stored in _TISSUE.z as a byte)
const KIND = { myocardium: 0, greatArtery: 1, greatVein: 2, coronaryArtery: 3, coronaryVein: 4 } as const;

// ---------------------------------------------------------------------------------------------
log("deriving grooves");
const grooves = deriveGrooves();
log(`anterior groove ${grooves.anterior.length} pts, posterior ${grooves.posterior.length}, AV ring ${grooves.ring.length}`);
setFat({ tubes: fatTubes(grooves) });
const epicardium = (x: number, y: number, z: number) => smin(outerField(x, y, z), fatField(x, y, z), 0.3);
const coronary = buildCoronaryNetwork(grooves, epicardium);
log(`coronary paths: ${coronary.paths.map((p) => p.name).join(", ")}`);

const P = newParts();
function vertexAttributes(px: number, py: number, pz: number, forced?: { kind: number; region: number }) {
  evalParts(px, py, pz, P);
  // membership distances -> soft weights (continuous: no tearing at region borders)
  const mLV = P.lv - 0.12;
  const mRV = Math.max(P.rv, -P.lv);
  const mLA = P.la, mRA = P.ra;
  const mStatic = P.vessel + 0.08;
  const tau = 0.28;
  const base = Math.min(mLV, mRV, mLA, mRA, mStatic);
  const e = [mLV, mRV, mLA, mRA, mStatic].map((m) => Math.exp(-(m - base) / tau));
  const sum = e.reduce((a, b) => a + b, 0);
  const w = e.map((x) => x / sum);
  const dOut = P.outer, dCav = P.cavity;
  let depth = clamp(-dOut / (-dOut + Math.max(dCav, 1e-4)), 0, 1);
  if (dOut > 0) depth = 0;
  const fatD = fatField(px, py, pz);
  let fat = smoothstep(0.1, -0.12, fatD - Math.max(P.outer, 0) - 0.02);
  if (depth > 0.5) fat = 0;
  let kind: number = KIND.myocardium;
  let region: number;
  const vesselDominant = P.vessel < Math.min(P.lv, P.rv, P.la, P.ra) - 0.05;
  if (forced) {
    kind = forced.kind; region = forced.region;
  } else if (depth > 0.5) {
    const cavs = [P.lvCav, P.rvCav, P.laCav, P.raCav, P.vesselLumen];
    const k = cavs.indexOf(Math.min(...cavs));
    if (k === 4 && P.vesselId >= 0) {
      region = VESSEL_REGION[VESSEL_KEYS[P.vesselId]];
      kind = VESSELS[VESSEL_KEYS[P.vesselId]].kind === "artery" ? KIND.greatArtery : KIND.greatVein;
    } else region = k;
  } else if (vesselDominant && P.vesselId >= 0) {
    region = VESSEL_REGION[VESSEL_KEYS[P.vesselId]];
    kind = VESSELS[VESSEL_KEYS[P.vesselId]].kind === "artery" ? KIND.greatArtery : KIND.greatVein;
  } else {
    region = [0, 1, 2, 3].reduce((b, i) => (w[i] > w[b] ? i : b), 0);
    // nearest vessel kind is kept so the shader can blend colours by the anchored weight (no hard seams)
    if (P.vesselId >= 0) kind = VESSELS[VESSEL_KEYS[P.vesselId]].kind === "artery" ? KIND.greatArtery : KIND.greatVein;
  }
  return { w, depth, fat, kind, region };
}

function packAttributes(m: RawMesh, forced?: { kind: number; region: number }) {
  const n = m.positions.length / 3;
  const W = new Uint8Array(n * 4);
  const T = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = vertexAttributes(m.positions[i * 3], m.positions[i * 3 + 1], m.positions[i * 3 + 2], forced);
    for (let k = 0; k < 4; k++) W[i * 4 + k] = Math.round(a.w[k] * 255);
    T[i * 4] = Math.round(a.depth * 255);
    T[i * 4 + 1] = Math.round(a.fat * 255);
    T[i * 4 + 2] = a.kind;
    T[i * 4 + 3] = a.region;
  }
  return { W, T };
}

const scaled = (m: RawMesh): RawMesh => ({ ...m, positions: m.positions.map((v) => v * S) as Float32Array });
const sv = (p: V3): V3 => mul(p, S);
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const r3 = (p: V3) => p.map((x) => round(x)) as V3;

function buildLod(h: number): GlbMesh[] {
  const t0 = Date.now();
  const solid = surfaceNets((x, y, z) => solidField(x, y, z), BOUNDS_MIN, BOUNDS_MAX, h, log);
  log(`solid meshed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const sa = packAttributes(solid);
  const meshes: GlbMesh[] = [{
    name: "heart_tissue",
    attributes: {
      POSITION: { data: scaled(solid).positions, itemSize: 3 },
      NORMAL: { data: solid.normals, itemSize: 3 },
      _WEIGHTS: { data: sa.W, itemSize: 4 },
      _TISSUE: { data: sa.T, itemSize: 4 },
    },
    indices: solid.indices,
    extras: { structure: "myocardium", layers: ["outer", "chambers", "vessels"] },
  }];
  for (const kind of ["artery", "vein"] as const) {
    const parts = coronary.paths.filter((p) => p.kind === kind).map((p) => tubeMesh(p, h < 0.1 ? 12 : 8));
    const merged = mergeMeshes(parts);
    const a = packAttributes(merged, { kind: kind === "artery" ? KIND.coronaryArtery : KIND.coronaryVein, region: 8 });
    meshes.push({
      name: kind === "artery" ? "coronary_arteries" : "cardiac_veins",
      attributes: {
        POSITION: { data: scaled(merged).positions, itemSize: 3 },
        NORMAL: { data: merged.normals, itemSize: 3 },
        _WEIGHTS: { data: a.W, itemSize: 4 },
        _TISSUE: { data: a.T, itemSize: 4 },
      },
      indices: merged.indices,
      extras: { structure: "coronary_vessels" },
    });
  }
  return meshes;
}

function mergeMeshes(parts: RawMesh[]): RawMesh {
  const nv = parts.reduce((s, p) => s + p.positions.length, 0);
  const ni = parts.reduce((s, p) => s + p.indices.length, 0);
  const positions = new Float32Array(nv), normals = new Float32Array(nv), indices = new Uint32Array(ni);
  let vo = 0, io = 0;
  for (const p of parts) {
    positions.set(p.positions, vo);
    normals.set(p.normals, vo);
    for (let i = 0; i < p.indices.length; i++) indices[io + i] = p.indices[i] + vo / 3;
    vo += p.positions.length;
    io += p.indices.length;
  }
  return { positions, normals, indices };
}

// ---------------------------------------------------------------------------------------------
// Baseline measurements of the asset itself (NOT clinical reference values).
function rayExtent(f: (x: number, y: number, z: number) => number, origin: V3, dir: V3, max = 6) {
  let r = 0;
  while (r < max && f(...add(origin, mul(dir, r))) < 0) r += 0.002;
  return r;
}
log("measuring baseline");
const lvProxy = surfaceNets(lvCavityProxy, BOUNDS_MIN, BOUNDS_MAX, quick ? 0.12 : 0.06);
const laProxy = surfaceNets(laCavityProxy, BOUNDS_MIN, BOUNDS_MAX, quick ? 0.12 : 0.06);
const lvEdvMl = meshVolume(lvProxy.positions, lvProxy.indices) * S ** 3;
const laVolMl = meshVolume(laProxy.positions, laProxy.indices) * S ** 3;
const { sep, ant } = lvAngleBasis();
const cavLen = MODEL.LV_CAV.c + MODEL.LV_CAV.rl - LV_CAVITY_BASE_LY;
const lvEddLevel = LV_CAVITY_BASE_LY + 0.3 * cavLen; // roughly the mitral leaflet-tip level
const lvAxisPt = add(LV_BASE, mul(LV_AXIS, lvEddLevel));
const lvCavIn = (x: number, y: number, z: number) => lvCavityProxy(x, y, z);
const lvOuter = (x: number, y: number, z: number) => { evalParts(x, y, z, P); return P.lv; };
const cavSep = rayExtent(lvCavIn, lvAxisPt, sep), cavLat = rayExtent(lvCavIn, lvAxisPt, mul(sep, -1));
const outSep = rayExtent(lvOuter, lvAxisPt, sep), outLat = rayExtent(lvOuter, lvAxisPt, mul(sep, -1));
const lvEddMm = (cavSep + cavLat) * 10 * S;
const ivsMm = (outSep - cavSep) * 10 * S;
const lvpwMm = (outLat - cavLat) * 10 * S;
// myocardial (epicardial) LV volume estimate = cavity + wall shell, used for incompressibility
const lvEpiProxy = surfaceNets((x, y, z) => Math.max(lvOuter(x, y, z), LV_CAVITY_BASE_LY - dot(sub([x, y, z], LV_BASE), LV_AXIS)), BOUNDS_MIN, BOUNDS_MAX, quick ? 0.12 : 0.08);
const lvEpiMl = meshVolume(lvEpiProxy.positions, lvEpiProxy.indices) * S ** 3;
// RV basal cavity width (RVD1-like): widest septum-to-free-wall chord at the basal level, searched within
// ±0.6 rad of the septal direction (the four-chamber plane region).
function rvBasalWidth(ly: number) {
  const o = add(LV_BASE, mul(LV_AXIS, ly));
  let best = 0;
  for (let a = -0.6; a <= 0.6; a += 0.05) {
    const d: V3 = [0, 1, 2].map((k) => sep[k] * Math.cos(a) + ant[k] * Math.sin(a)) as V3;
    const at = (r: number) => { evalParts(...add(o, mul(d, r)), P); return P; };
    let r = 0; while (r < 8 && at(r).lv <= 0) r += 0.01;
    let r1 = r; while (r1 < 8 && at(r1).rvCav >= 0) r1 += 0.01;
    let r2 = r1; while (r2 < 9 && at(r2).rvCav < 0) r2 += 0.01;
    if (r1 - r < 0.3) best = Math.max(best, r2 - r1);
  }
  return best;
}
const rvCenter = RV_INFO.center;
const rvBasalMm = rvBasalWidth(1.0) * 10 * S;
log(`LV EDV ${lvEdvMl.toFixed(1)} mL, LVEDD ${lvEddMm.toFixed(1)} mm, IVS ${ivsMm.toFixed(1)} mm, LVPW ${lvpwMm.toFixed(1)} mm, LV epi ${lvEpiMl.toFixed(1)} mL, LA ${laVolMl.toFixed(1)} mL`);

// ---------------------------------------------------------------------------------------------
const hHigh = quick ? 0.14 : 0.08;
const hLow = quick ? 0.2 : 0.12;
mkdirSync(outDir, { recursive: true });
log(`building high LOD (h=${hHigh})`);
const high = buildLod(hHigh);
const glbHigh = writeGlb(high, { assetId: "cor-procedural-heart", version: "1.0.0" });
writeFileSync(resolve(outDir, "cor-heart-v1-high.glb"), glbHigh);
let glbLowBytes = 0, lowCounts: number[] = [];
if (!quick) {
  log(`building low LOD (h=${hLow})`);
  const low = buildLod(hLow);
  const glbLow = writeGlb(low, { assetId: "cor-procedural-heart", version: "1.0.0" });
  writeFileSync(resolve(outDir, "cor-heart-v1-low.glb"), glbLow);
  glbLowBytes = glbLow.byteLength;
  lowCounts = low.map((m) => m.indices.length / 3);
}

// The LV cavity proxy mesh is shipped separately (for volume verification in tests, never rendered).
writeFileSync(resolve(ROOT, "tests/fixtures/lv-cavity-proxy.json"), JSON.stringify({
  note: "LV cavity proxy of the procedural asset at the baseline (end-diastolic) pose, centimetres after scale.",
  positions: Array.from(lvProxy.positions, (v) => round(v * S, 3)),
  indices: Array.from(lvProxy.indices),
}));

const pap = (t: { pts: V3[] }) => ({ base: r3(sv(t.pts[0])), tip: r3(sv(t.pts[t.pts.length - 1])) });
const manifest = {
  manifestVersion: "1.0.0",
  assetId: "cor-procedural-heart",
  assetVersion: "1.0.0",
  source: "Procedurally generated by scripts/heart-asset (signed-distance modelling + Surface Nets) in this repository",
  author: "COR Heart Studio project (generated code)",
  license: "Generated by this repository's code (no third-party anatomical data); MIT license (repository LICENSE)",
  attribution: "No external asset. Anatomical proportions set by eye from general anatomy references listed in docs/anatomy-review.md",
  redistribution: "Permitted under the MIT license",
  units: "cm",
  axes: { x: "patient left", y: "superior", z: "anterior" },
  anatomicalOrientation: "Standard anatomical position; anterior view looks along -Z",
  bounds: { min: r3(sv(BOUNDS_MIN)), max: r3(sv(BOUNDS_MAX)) },
  provenanceTier: "A",
  files: {
    high: { url: "/models/cor-heart-v1-high.glb", bytes: glbHigh.byteLength, triangles: high.map((m) => m.indices.length / 3) },
    low: { url: "/models/cor-heart-v1-low.glb", bytes: glbLowBytes, triangles: lowCounts },
  },
  attributes: {
    _weights: "uint8 normalized vec4: deformation membership (lv, rv, la, ra); remainder = anchored vessels",
    _tissue: "uint8 normalized vec4: x wall depth (0 epicardium .. 1 endocardium), y epicardial fat, z tissue kind byte, w region byte",
    tissueKinds: KIND,
    regions: REGION_IDS,
  },
  structureToMesh: {
    myocardium: { mesh: "heart_tissue", note: "all chamber walls" },
    lv: { mesh: "heart_tissue", region: 0 }, rv: { mesh: "heart_tissue", region: 1 },
    la: { mesh: "heart_tissue", region: 2 }, ra: { mesh: "heart_tissue", region: 3 },
    aorta: { mesh: "heart_tissue", region: 4 }, pulmonary_artery: { mesh: "heart_tissue", region: 5 },
    vena_cava: { mesh: "heart_tissue", region: 6 }, pulmonary_veins: { mesh: "heart_tissue", region: 7 },
    coronary_vessels: { mesh: ["coronary_arteries", "cardiac_veins"], region: 8 },
    mitral_valve: { runtime: "valve generator" }, aortic_valve: { runtime: "valve generator" },
    tricuspid_valve: { runtime: "valve generator" }, pulmonary_valve: { runtime: "valve generator" },
  },
  deformation: {
    method: "Vertex-shader handles: per-chamber axial/radial scale about chamber frames weighted by _weights, wall-depth dependent; LV segmental modulation (AHA 17)",
    lv: {
      base: r3(sv(LV_BASE)), axis: r3(LV_AXIS), septalDir: r3(sep), anteriorDir: r3(ant),
      cavityBaseAlong: round(LV_CAVITY_BASE_LY * S), cavityApexAlong: round((MODEL.LV_CAV.c + MODEL.LV_CAV.rl) * S),
      epiApexAlong: round(LV_APEX_LY * S), meanCavityRadius: round(((MODEL.LV_CAV.rx + MODEL.LV_CAV.rz) / 2) * S),
      meanWallThickness: round(((MODEL.LV_OUT.rx + MODEL.LV_OUT.rz - MODEL.LV_CAV.rx - MODEL.LV_CAV.rz) / 2) * S),
    },
    rv: { center: r3(sv(rvCenter)), axis: r3(LV_AXIS), septalDir: r3(RV_INFO.sepDir), wall: round(MODEL.RV_WALL * S) },
    la: { center: r3(sv(LA_CENTER)) },
    ra: { center: r3(sv(RA_CENTER)) },
    segmentConvention: "AHA 17-segment; angle measured around the LV long axis from the septal direction toward anterior",
  },
  valves: Object.fromEntries(Object.entries(VALVES).map(([k, v]) => [k, { center: r3(sv(v.center)), normal: r3(v.normal), radius: round(v.radius * S) }])),
  papillary: { anterolateral: pap(PAPILLARY.anterolateral), posteromedial: pap(PAPILLARY.posteromedial), rvAnterior: pap(PAPILLARY.rvAnterior) },
  coronaryOstia: { right: r3(sv(coronary.ostia.rightOs)), left: r3(sv(coronary.ostia.leftOs)) },
  anchors: {
    lv: r3(sv(add(LV_BASE, add(mul(LV_AXIS, 5.0), mul(sep, -2.9))))),
    rv: r3(sv(add(rvCenter, [-0.2, -0.3, 1.6]))),
    la: r3(sv(add(LA_CENTER, [1.4, 0.6, -1.0]))),
    ra: r3(sv(add(RA_CENTER, [-1.6, 0.2, 0.3]))),
    apex: r3(sv(add(LV_BASE, mul(LV_AXIS, LV_APEX_LY - 0.2)))),
    aorta: r3(sv(VESSELS.aorta.tube.pts[Math.floor(VESSELS.aorta.tube.pts.length * 0.28)])),
    pulmonary_artery: r3(sv(VESSELS.pulmonaryTrunk.tube.pts[Math.floor(VESSELS.pulmonaryTrunk.tube.pts.length * 0.5)])),
    vena_cava: r3(sv(VESSELS.svc.tube.pts[Math.floor(VESSELS.svc.tube.pts.length * 0.6)])),
    pulmonary_veins: r3(sv(VESSELS.lspv.tube.pts[Math.floor(VESSELS.lspv.tube.pts.length * 0.7)])),
    coronary_vessels: r3(sv(coronary.paths.find((p) => p.name === "lad")!.pts[Math.floor(coronary.paths.find((p) => p.name === "lad")!.pts.length * 0.35)])),
    myocardium: r3(sv(add(LV_BASE, add(mul(LV_AXIS, 3.4), mul(sep, -3.0))))),
    ...Object.fromEntries(Object.entries(VALVES).map(([k, v]) => [k, r3(sv(v.center))])),
  },
  baseline: {
    note: "Measured from this asset at its rest (end-diastolic) pose. Not a clinical reference range.",
    lvEndDiastolicVolumeMl: round(lvEdvMl, 1),
    lvEpicardialVolumeMl: round(lvEpiMl, 1),
    lvEndDiastolicDiameterMm: round(lvEddMm, 1),
    ivsThicknessMm: round(ivsMm, 1),
    lvPosteriorWallThicknessMm: round(lvpwMm, 1),
    laVolumeMl: round(laVolMl, 1),
    rvBasalDiameterMm: round(rvBasalMm, 1),
    raMinorDimensionMm: round(2 * (MODEL.RA_R[0] - MODEL.ATRIAL_WALL) * 10 * S, 1),
    measurementLevelAlong: round(lvEddLevel * S),
  },
  morphTargets: [],
  layers: ["outer", "chambers", "vessels", "coronary", "valves", "overlays"],
  cutaway: "Clip plane with back-face section shading; closed solid mesh so wall thickness reads in section",
  animationChannels: ["ventricular volume", "longitudinal shortening", "torsion", "atrial volume", "valve opening"],
  knownLimitations: [
    "Shape is an idealised illustration; not derived from imaging of any person",
    "No atrial septal detail (fossa ovalis), no conduction system, no pericardium",
    "Trabeculae and pectinate muscles are approximated by procedural ridges",
    "Coronary course follows one common right-dominant pattern; variants are not modelled",
    "Valve leaflets are generated at runtime and are thin-shell approximations",
    "Deformation uses smooth chamber handles, not a biomechanical model",
  ],
};
mkdirSync(resolve(ROOT, "src/scene/asset-adapters"), { recursive: true });
writeFileSync(resolve(ROOT, "src/scene/asset-adapters/procedural-heart-v1.manifest.json"), JSON.stringify(manifest, null, 2));
log(`wrote GLB ${(glbHigh.byteLength / 1e6).toFixed(2)} MB (high) ${(glbLowBytes / 1e6).toFixed(2)} MB (low)`);
