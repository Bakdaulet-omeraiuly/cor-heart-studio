// GLSL mirror of scene/animation/deform.ts — keep in sync (tests cover the TypeScript reference).
export const DEFORM_UNIFORMS_GLSL = /* glsl */ `
uniform vec3 uLvBase; uniform vec3 uLvAxis; uniform vec3 uLvSep; uniform vec3 uLvAnt;
uniform vec3 uLvGeom; // cavBase, cavApex, epiApex
uniform vec3 uLvStatic; uniform vec3 uLvCycle; uniform float uLvTwist;
uniform float uSegMotion[17]; uniform float uSegThick[17];
uniform float uRvR0; uniform vec3 uRvStatic; uniform vec3 uRvCycle;
uniform vec3 uLaCenter; uniform vec3 uRaCenter; uniform vec2 uAtrialScale;
`;

export const SEGMENT_GLSL = /* glsl */ `
const int SEG_BASAL[6] = int[6](2, 1, 6, 5, 4, 3);
const int SEG_MID[6] = int[6](8, 7, 12, 11, 10, 9);
const int SEG_APICAL[4] = int[4](14, 13, 16, 15);
float segArr(int which, int seg) { return which == 0 ? uSegMotion[seg - 1] : uSegThick[seg - 1]; }
float ring6(int which, bool mid, float thetaDeg) {
  float t = (thetaDeg - 30.0) / 60.0;
  t = mod(t, 6.0);
  int i0 = int(floor(t)); float f = t - float(i0);
  int i1 = (i0 + 1) % 6;
  int a = mid ? SEG_MID[i0] : SEG_BASAL[i0];
  int b = mid ? SEG_MID[i1] : SEG_BASAL[i1];
  return mix(segArr(which, a), segArr(which, b), f);
}
float ring4(int which, float thetaDeg) {
  float t = mod(thetaDeg / 90.0, 4.0);
  int i0 = int(floor(t)); float f = t - float(i0);
  return mix(segArr(which, SEG_APICAL[i0]), segArr(which, SEG_APICAL[(i0 + 1) % 4]), f);
}
float segmentField(int which, float s, float thetaDeg) {
  float vb = ring6(which, false, thetaDeg), vm = ring6(which, true, thetaDeg), va = ring4(which, thetaDeg), vx = segArr(which, 17);
  if (s <= 0.175) return vb;
  if (s <= 0.5) return mix(vb, vm, (s - 0.175) / 0.325);
  if (s <= 0.785) return mix(vm, va, (s - 0.5) / 0.285);
  if (s <= 0.96) return mix(va, vx, (s - 0.785) / 0.175);
  return vx;
}
int segmentAt(float s, float thetaDeg) {
  float th = mod(thetaDeg, 360.0);
  if (s >= 0.92) return 17;
  if (s >= 0.65) return SEG_APICAL[int(floor(mod(th + 45.0, 360.0) / 90.0))];
  int k = int(floor(th / 60.0));
  return s < 0.35 ? SEG_BASAL[k] : SEG_MID[k];
}
// x: along, y: r, z: theta(deg), w: s
vec4 lvCoords(vec3 p, out vec3 radial) {
  vec3 q = p - uLvBase;
  float along = dot(q, uLvAxis);
  radial = q - along * uLvAxis;
  float r = length(radial);
  float th = degrees(atan(dot(radial, uLvAnt), dot(radial, uLvSep)));
  return vec4(along, r, th, (along - uLvGeom.x) / (uLvGeom.y - uLvGeom.x));
}
`;

export const DEFORM_FN_GLSL = /* glsl */ `
vec3 deformPoint(vec3 p, vec4 w, float depth, float region) {
  vec3 d = vec3(0.0);
  vec3 radial;
  vec4 lc = lvCoords(p, radial);
  float along = lc.x, r = lc.y;
  if (w.x > 0.001) {
    float lvDepth = region == 1.0 ? 0.0 : depth;
    float m = segmentField(0, lc.w, lc.z);
    float thick = segmentField(1, lc.w, lc.z);
    float stat = mix(uLvStatic.y, uLvStatic.x, lvDepth);
    float cyc = mix(uLvCycle.y, uLvCycle.x, lvDepth);
    float rad = stat * (1.0 + m * (cyc - 1.0));
    float aStatic = along * uLvStatic.z;
    float apex = uLvGeom.z * uLvStatic.z;
    float aFinal = apex + (aStatic - apex) * uLvCycle.z;
    float tw = uLvTwist * (0.5 - along / uLvGeom.z);
    vec3 c = cross(uLvAxis, radial);
    float off = thick * (0.35 - lvDepth);
    float scaleR = rad + off / max(r, 1e-4);
    vec3 nr = (radial * cos(tw) + c * sin(tw)) * scaleR;
    vec3 np = uLvBase + uLvAxis * aFinal + nr;
    d += w.x * (np - p);
  }
  if (w.y > 0.001) {
    float stat = mix(uRvStatic.y, uRvStatic.x, depth);
    float cyc = mix(uRvCycle.y, uRvCycle.x, depth);
    float f = stat * cyc;
    float ex = max(r - uRvR0, 0.0);
    float rNew = r + ex * (f - 1.0) + uRvR0 * (uLvStatic.y - 1.0);
    float k = r > 1e-4 ? rNew / r : 1.0;
    float apex = uLvGeom.z * uLvStatic.z;
    float aFinal = apex + (along * uLvStatic.z - apex) * uRvCycle.z * uRvStatic.z;
    vec3 np = uLvBase + uLvAxis * aFinal + radial * k;
    d += w.y * (np - p);
  }
  d += w.z * (p - uLaCenter) * (uAtrialScale.x - 1.0);
  d += w.w * (p - uRaCenter) * (uAtrialScale.y - 1.0);
  return p + d;
}
`;
