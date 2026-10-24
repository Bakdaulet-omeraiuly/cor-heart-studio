import { describe, expect, it } from "vitest";
import { cyclePhases } from "@/domain/mapping/cycle";
import { ecgAt, ecgTiming, pepMs, qtcBazett, qtcFramingham, qtcFridericia } from "@/domain/ecg";

describe("QT rate correction", () => {
  it("matches the published formulas", () => {
    expect(qtcBazett(400, 1)).toBe(400);
    expect(qtcBazett(392, 0.81)).toBeCloseTo(392 / 0.9, 6);
    expect(qtcFridericia(392, 0.729)).toBeCloseTo(392 / 0.9, 6);
    expect(qtcFramingham(350, 0.81)).toBeCloseTo(350 + 154 * 0.19, 6); // Sagie 1992
  });
});

describe("ECG timing", () => {
  const hr = 71;
  const phases = cyclePhases(hr);

  it("uses the record's intervals and marks them reported", () => {
    const t = ecgTiming({ heartRateBpm: hr, prMs: 168, qrsMs: 96, qtMs: 392 }, phases);
    expect([t.pr.evidence, t.qrs.evidence, t.qt.evidence]).toEqual(["reported", "reported", "reported"]);
    expect(t.qtc.bazett).toBeCloseTo(392 / Math.sqrt(60 / 71), 6);
  });

  it("derives QT from a reported QTc and falls back to labelled population defaults", () => {
    const d = ecgTiming({ heartRateBpm: hr, qtcMs: 426, qtcMethod: "Bazett" }, phases);
    expect(d.qt.evidence).toBe("derived");
    expect(d.qtc.bazett).toBeCloseTo(426, 6);
    const p = ecgTiming({ heartRateBpm: hr }, phases);
    expect([p.pr.evidence, p.qrs.evidence, p.qt.evidence]).toEqual(["population_default", "population_default", "population_default"]);
  });

  it("places QRS onset one pre-ejection period before aortic valve opening", () => {
    const t = ecgTiming({ heartRateBpm: hr }, phases);
    const avoS = phases.ivcEnd * t.rrS;
    const qS = t.qrsOnsetPhase * t.rrS;
    const gap = ((avoS - qS) % t.rrS + t.rrS) % t.rrS;
    expect(gap * 1000).toBeCloseTo(pepMs(hr), 6);
  });

  it("peaks at the R wave, and the T wave ends at the QT", () => {
    const t = ecgTiming({ heartRateBpm: hr, prMs: 168, qrsMs: 96, qtMs: 392 }, phases);
    let best = 0, bestV = -Infinity;
    for (let i = 0; i < 2000; i++) { const v = ecgAt(t, i / 2000); if (v > bestV) { bestV = v; best = i / 2000; } }
    const rS = ((best - t.qrsOnsetPhase + 1) % 1) * t.rrS;
    expect(rS * 1000).toBeCloseTo(0.42 * 96, -1);
    const tEnd = t.qrsOnsetPhase + 0.392 / t.rrS;
    expect(Math.abs(ecgAt(t, tEnd % 1))).toBeLessThan(0.02);
  });
});
