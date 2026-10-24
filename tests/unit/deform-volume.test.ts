// Verifies that the deformation actually rendered (TS reference of the shader) produces the cavity
// volumes the mapping engine targets — on the real LV cavity mesh of the shipped asset.
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/lv-cavity-proxy.json";
import { cyclePhases, sampleCycle } from "@/domain/mapping/cycle";
import { deformPoint, frameParams, restParams, segmentAt, segmentField } from "@/scene/animation/deform";
import { meshVolume } from "../../scripts/heart-asset/surface-nets";
import { map, minimal, norm, obs } from "./helpers";

const P0 = new Float32Array(fixture.positions);
const I = new Uint32Array(fixture.indices);
const W = [1, 0, 0, 0];

function volumeAt(vs: ReturnType<typeof map>, ventricular: number) {
  const P = frameParams(vs, { ventricular, atrial: 0 }, restParams());
  const out = new Float32Array(P0.length);
  const v: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < P0.length; i += 3) {
    deformPoint(P, P0[i], P0[i + 1], P0[i + 2], W, 1, 0, v);
    out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2];
  }
  return meshVolume(out, I);
}

describe("rendered LV cavity volume", () => {
  const baseVol = meshVolume(P0, I);

  it("baseline cavity volume matches the manifest", () => {
    const vs = map(norm(minimal()));
    expect(volumeAt(vs, 0)).toBeCloseTo(baseVol, 6);
    expect(baseVol).toBeGreaterThan(80);
  });

  it("end-diastolic volume reaches the reported EDV (within 3%)", () => {
    const vs = map(norm(minimal({ observations: { lvEndDiastolicVolume: obs(170, "mL") } })));
    const rendered = volumeAt(vs, 0);
    expect(Math.abs(rendered - 170) / 170).toBeLessThan(0.03);
  });

  it("end-systolic volume reaches ESV, so the rendered EF matches the input (within 3 points)", () => {
    const vs = map(norm(minimal({ observations: { lvEndDiastolicVolume: obs(150, "mL"), lvEndSystolicVolume: obs(90, "mL") } })));
    const ed = volumeAt(vs, 0), es = volumeAt(vs, 1);
    const ef = (100 * (ed - es)) / ed;
    expect(Math.abs(ef - 40)).toBeLessThan(3);
  });

  it("does not inflate like a balloon: a reduced EF contracts less", () => {
    const good = map(norm(minimal({ observations: { lvEjectionFraction: obs(65, "%") } })));
    const poor = map(norm(minimal({ observations: { lvEjectionFraction: obs(25, "%") } })));
    expect(volumeAt(poor, 1)).toBeGreaterThan(volumeAt(good, 1));
  });
});

describe("segment field", () => {
  it("interpolates continuously across segment borders (no tearing)", () => {
    const arr = new Array(17).fill(1);
    arr[6] = 0; // mid anterior
    let prev = segmentField(arr, 0.5, 0);
    for (let th = 0; th <= 360; th += 0.5) {
      const v = segmentField(arr, 0.5, th);
      expect(Math.abs(v - prev)).toBeLessThan(0.02);
      prev = v;
    }
    expect(segmentField(arr, 0.5, 90)).toBe(0);
  });
  it("labels AHA segments by ring and angle", () => {
    expect(segmentAt(0.2, 90)).toBe(1);
    expect(segmentAt(0.2, 330)).toBe(3);
    expect(segmentAt(0.5, 30)).toBe(8);
    expect(segmentAt(0.8, 0)).toBe(14);
    expect(segmentAt(0.97, 123)).toBe(17);
  });
});

describe("cardiac cycle", () => {
  it("orders phases and keeps systole plausible across heart rates", () => {
    for (const hr of [40, 70, 110, 180]) {
      const p = cyclePhases(hr);
      expect(p.ivcEnd).toBeLessThan(p.ejectionEnd);
      expect(p.ejectionEnd).toBeLessThan(p.ivrEnd);
      expect(p.ivrEnd).toBeLessThanOrEqual(p.rapidFillEnd);
      expect(p.rapidFillEnd).toBeLessThanOrEqual(p.atrialStart);
      expect(p.atrialStart).toBeLessThan(1);
    }
    expect(cyclePhases(150).ejectionEnd).toBeGreaterThan(cyclePhases(60).ejectionEnd); // systole takes more of a short cycle
  });
  it("valves never open simultaneously on the same side and the cycle is continuous", () => {
    const p = cyclePhases(75);
    let prev = sampleCycle(p, 0);
    for (let phi = 0.001; phi <= 1.0001; phi += 0.001) {
      const s = sampleCycle(p, phi);
      expect(s.semilunarOpen > 0.05 && s.atrioventricularOpen > 0.05).toBe(false);
      expect(Math.abs(s.ventricular - prev.ventricular)).toBeLessThan(0.06);
      expect(Math.abs(s.atrial - prev.atrial)).toBeLessThan(0.06);
      prev = s;
    }
  });
});
