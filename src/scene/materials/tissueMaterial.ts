// Physically based tissue material with vertex deformation, natural / clinical colouring, section shading
// and structure masks. Subsurface scattering is *approximated* (sheen + wrapped warm emission), see docs.
import * as THREE from "three";
import type { DeformParams } from "../animation/deform";
import { DEFORM_FN_GLSL, DEFORM_UNIFORMS_GLSL, SEGMENT_GLSL } from "./deformGlsl";

export interface TissueUniforms {
  [k: string]: THREE.IUniform;
}

export function createTissueUniforms(): TissueUniforms {
  return {
    uLvBase: { value: new THREE.Vector3() }, uLvAxis: { value: new THREE.Vector3(0, -1, 0) },
    uLvSep: { value: new THREE.Vector3(1, 0, 0) }, uLvAnt: { value: new THREE.Vector3(0, 0, 1) },
    uLvGeom: { value: new THREE.Vector3(0.5, 9, 10) },
    uLvStatic: { value: new THREE.Vector3(1, 1, 1) }, uLvCycle: { value: new THREE.Vector3(1, 1, 1) }, uLvTwist: { value: 0 },
    uSegMotion: { value: new Array(17).fill(1) }, uSegThick: { value: new Array(17).fill(0) },
    uRvR0: { value: 3 }, uRvStatic: { value: new THREE.Vector3(1, 1, 1) }, uRvCycle: { value: new THREE.Vector3(1, 1, 1) },
    uLaCenter: { value: new THREE.Vector3() }, uRaCenter: { value: new THREE.Vector3() }, uAtrialScale: { value: new THREE.Vector2(1, 1) },
    // appearance
    uMode: { value: 0 }, // 0 natural tissue, 1 clinical overlay
    uDark: { value: 1 },
    uHidden: { value: new Array(9).fill(0) },
    uShowOuter: { value: 1 }, uShowInner: { value: 1 },
    uIsolate: { value: -1 },
    uSelected: { value: -1 }, uHover: { value: -1 },
    uSegFlag: { value: new Array(17).fill(0) }, // 1 reported finding, 2 data-driven geometry change
    uSegSelected: { value: 0 },
    uHighlight: { value: 1 },
    uRegionFlag: { value: new Array(9).fill(0) },
    uTime: { value: 0 },
  };
}

export function applyDeformUniforms(u: TissueUniforms, P: DeformParams) {
  (u.uLvBase.value as THREE.Vector3).fromArray(P.lvBase);
  (u.uLvAxis.value as THREE.Vector3).fromArray(P.lvAxis);
  (u.uLvSep.value as THREE.Vector3).fromArray(P.lvSep);
  (u.uLvAnt.value as THREE.Vector3).fromArray(P.lvAnt);
  (u.uLvGeom.value as THREE.Vector3).set(P.cavBase, P.cavApex, P.epiApex);
  (u.uLvStatic.value as THREE.Vector3).fromArray(P.lvStatic);
  (u.uLvCycle.value as THREE.Vector3).fromArray(P.lvCycle);
  u.uLvTwist.value = P.lvTwist;
  const sm = u.uSegMotion.value as number[], st = u.uSegThick.value as number[];
  for (let i = 0; i < 17; i++) { sm[i] = P.segMotion[i]; st[i] = P.segThick[i]; }
  u.uRvR0.value = P.rvR0;
  (u.uRvStatic.value as THREE.Vector3).fromArray(P.rvStatic);
  (u.uRvCycle.value as THREE.Vector3).fromArray(P.rvCycle);
  (u.uLaCenter.value as THREE.Vector3).fromArray(P.laCenter);
  (u.uRaCenter.value as THREE.Vector3).fromArray(P.raCenter);
  (u.uAtrialScale.value as THREE.Vector2).set(P.laScale, P.raScale);
}

const NOISE_GLSL = /* glsl */ `
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03) + 0.125 * vnoise(p * 4.01); }
`;

const VERTEX_HEAD = /* glsl */ `
#include <common>
attribute vec4 _weights;
attribute vec4 _tissue;
varying vec4 vTissue;
varying vec3 vRest;
varying float vStatic;
varying vec4 vW;
${DEFORM_UNIFORMS_GLSL}
${SEGMENT_GLSL}
${DEFORM_FN_GLSL}
`;

const FRAGMENT_HEAD = /* glsl */ `
#include <common>
varying vec4 vTissue;
varying vec3 vRest;
varying float vStatic;
varying vec4 vW;
uniform float uMode; uniform float uDark;
uniform float uHidden[9]; uniform float uShowOuter; uniform float uShowInner;
uniform float uIsolate; uniform float uSelected; uniform float uHover;
uniform float uSegFlag[17]; uniform float uSegSelected; uniform float uHighlight; uniform float uRegionFlag[9];
uniform vec3 uLvBase; uniform vec3 uLvAxis; uniform vec3 uLvSep; uniform vec3 uLvAnt; uniform vec3 uLvGeom;
uniform float uSegMotion[17]; uniform float uSegThick[17];
${SEGMENT_GLSL}
${NOISE_GLSL}
vec3 regionColor(float r) {
  if (r < 0.5) return vec3(0.80, 0.33, 0.06);   // LV  (orange)
  if (r < 1.5) return vec3(0.05, 0.38, 0.68);   // RV  (blue)
  if (r < 2.5) return vec3(0.86, 0.60, 0.10);   // LA  (amber)
  if (r < 3.5) return vec3(0.30, 0.62, 0.85);   // RA  (sky)
  if (r < 4.5) return vec3(0.72, 0.36, 0.55);   // aorta (reddish purple)
  if (r < 5.5) return vec3(0.10, 0.58, 0.44);   // pulmonary artery (bluish green)
  if (r < 6.5) return vec3(0.38, 0.40, 0.62);   // venae cavae (slate)
  if (r < 7.5) return vec3(0.80, 0.74, 0.30);   // pulmonary veins (straw)
  return vec3(0.78, 0.18, 0.18);                // coronary vessels
}
`;

export function createTissueMaterial(uniforms: TissueUniforms, opts: { clippingPlanes: THREE.Plane[]; ghost?: boolean }) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0,
    clearcoat: 0.32,
    clearcoatRoughness: 0.38,
    sheen: 0.45,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0.55, 0.12, 0.1),
    side: opts.ghost ? THREE.FrontSide : THREE.DoubleSide,
    clippingPlanes: opts.clippingPlanes,
    transparent: !!opts.ghost,
    opacity: opts.ghost ? 0.22 : 1,
    depthWrite: !opts.ghost,
  });
  mat.customProgramCacheKey = () => (opts.ghost ? "cor-tissue-ghost-v1" : "cor-tissue-v1");
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", VERTEX_HEAD)
      .replace("#include <beginnormal_vertex>", /* glsl */ `
        vec3 restN = normalize(normal);
        vec3 tA = normalize(cross(restN, abs(restN.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
        vec3 tB = cross(restN, tA);
        float rgn = floor(_tissue.w * 255.0 + 0.5);
        vec3 p0 = deformPoint(position, _weights, _tissue.x, rgn);
        vec3 p1 = deformPoint(position + tA * 0.04, _weights, _tissue.x, rgn);
        vec3 p2 = deformPoint(position + tB * 0.04, _weights, _tissue.x, rgn);
        vec3 objectNormal = normalize(cross(p1 - p0, p2 - p0));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif
      `)
      .replace("#include <begin_vertex>", /* glsl */ `
        vec3 transformed = p0;
        vTissue = _tissue; vRest = position; vW = _weights;
        vStatic = clamp(1.0 - (_weights.x + _weights.y + _weights.z + _weights.w), 0.0, 1.0);
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", FRAGMENT_HEAD)
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );", /* glsl */ `
        float depth = vTissue.x;
        float fat = vTissue.y;
        float kind = floor(vTissue.z * 255.0 + 0.5);
        float region = floor(vTissue.w * 255.0 + 0.5);
        int ri = int(region);
        if (uHidden[ri] > 0.5) discard;
        bool chamberWall = region < 3.5;
        bool inner = depth > 0.5;
        if (chamberWall && !inner && uShowOuter < 0.5) discard;
        if (chamberWall && inner && uShowInner < 0.5) discard;
        if (uIsolate > -0.5 && abs(region - uIsolate) > 0.5) discard;

        // ---- LV segment (for overlays)
        vec3 radialDummy;
        vec4 lc = lvCoords(vRest, radialDummy);
        bool lvTissue = vW.x > 0.45 && region < 0.5;
        int seg = lvTissue && lc.w > -0.05 ? segmentAt(lc.w, lc.z) : 0;

        vec3 col;
        float n1 = fbm3(vRest * 3.1);
        float n2 = vnoise(vRest * 11.0);
        if (uMode < 0.5) {
          // natural tissue
          vec3 myo = vec3(0.34, 0.062, 0.052) * (0.82 + 0.34 * n1);
          // faint circumferential fibre striation
          myo *= 0.94 + 0.06 * sin(lc.z * 0.9 + lc.x * 6.0 + n2 * 2.0);
          vec3 endo = vec3(0.50, 0.17, 0.15) * (0.88 + 0.24 * n1);
          col = inner ? endo : myo;
          vec3 artery = vec3(0.74, 0.55, 0.50) * (0.92 + 0.12 * n1);
          vec3 vein = vec3(0.34, 0.13, 0.21) * (0.9 + 0.15 * n1);
          if (kind > 0.5 && kind < 2.5) col = mix(col, kind < 1.5 ? artery : vein, smoothstep(0.3, 0.75, vStatic));
          if (kind > 2.5 && kind < 3.5) col = vec3(0.56, 0.10, 0.08) * (0.9 + 0.2 * n2);
          if (kind > 3.5) col = vec3(0.24, 0.07, 0.15) * (0.9 + 0.2 * n2);
          float lob = smoothstep(0.35, 0.75, fbm3(vRest * 5.5));
          vec3 fatCol = mix(vec3(0.74, 0.55, 0.24), vec3(0.88, 0.72, 0.38), lob);
          col = mix(col, fatCol, fat * 0.92);
        } else {
          col = regionColor(region) * (0.85 + 0.15 * n1);
          if (inner) col *= 0.82;
          if (kind > 2.5 && kind < 3.5) col = vec3(0.78, 0.18, 0.18);
          if (kind > 3.5) col = vec3(0.30, 0.25, 0.55);
          col = mix(col, vec3(0.75), fat * 0.25);
        }

        // ---- findings / data-driven overlays (pattern + tint so colour is not the only signal)
        if (uHighlight > 0.5 && seg > 0) {
          float f = uSegFlag[seg - 1];
          if (f > 0.5) {
            float stripes = step(0.5, fract((vRest.x + vRest.y * 0.7) * 3.2));
            vec3 tint = f > 1.5 ? vec3(0.15, 0.55, 0.95) : vec3(1.0, 0.82, 0.15);
            col = mix(col, tint, 0.35 + 0.3 * stripes);
          }
        }
        if (uHighlight > 0.5 && uRegionFlag[ri] > 0.5) {
          col = mix(col, vec3(1.0, 0.82, 0.15), 0.18);
        }
        if (uSegSelected > 0.5 && float(seg) == uSegSelected) col = mix(col, vec3(1.0), 0.35);
        if (abs(region - uHover) < 0.5) col *= 1.18;
        float selected = abs(region - uSelected) < 0.5 ? 1.0 : 0.0;
        col = mix(col, col + vec3(0.18, 0.16, 0.12), selected);

        if (!gl_FrontFacing) {
          // cut section: muscle cross-section, flat-lit so wall thickness reads clearly
          // vessel walls (anchored, high static weight) vs myocardium — blended, never keyed on the nearest-vessel byte
          vec3 cut = mix(vec3(0.44, 0.095, 0.08), vec3(0.80, 0.66, 0.60), smoothstep(0.35, 0.75, vStatic));
          if (kind > 2.5) cut = vec3(0.5, 0.1, 0.09);
          if (uMode > 0.5) cut = regionColor(region) * 0.75;
          cut *= 0.9 + 0.2 * vnoise(vRest * 22.0);
          col = cut;
        }
        vec4 diffuseColor = vec4(col, opacity);
      `)
      .replace("#include <roughnessmap_fragment>", /* glsl */ `
        float roughnessFactor = roughness;
        roughnessFactor = mix(0.46, 0.34, step(0.5, depth));
        roughnessFactor = mix(roughnessFactor, 0.62, fat);
        roughnessFactor += 0.08 * (n1 - 0.5);
        if (!gl_FrontFacing) roughnessFactor = 0.9;
      `)
      .replace("#include <normal_fragment_maps>", /* glsl */ `
        #include <normal_fragment_maps>
        {
          // subtle deterministic micro-relief (bump from value-noise gradient in rest space)
          float e = 0.02;
          vec3 q = vRest * 9.0;
          float h0 = vnoise(q);
          vec3 g = vec3(vnoise(q + vec3(e * 9.0, 0, 0)) - h0, vnoise(q + vec3(0, e * 9.0, 0)) - h0, vnoise(q + vec3(0, 0, e * 9.0)) - h0);
          vec3 gv = (viewMatrix * vec4(g, 0.0)).xyz;
          float amp = gl_FrontFacing ? (inner ? 0.35 : 0.55) : 0.0;
          normal = normalize(normal - amp * (gv - dot(gv, normal) * normal));
        }
      `)
      .replace("#include <emissivemap_fragment>", /* glsl */ `
        #include <emissivemap_fragment>
        if (!gl_FrontFacing) totalEmissiveRadiance += diffuseColor.rgb * 0.55;
        // warm wrap term approximating light bleeding through thin tissue
        totalEmissiveRadiance += diffuseColor.rgb * vec3(0.10, 0.025, 0.02) * (1.0 - fat) * (uMode < 0.5 ? 1.0 : 0.0);
      `);
  };
  return mat;
}
