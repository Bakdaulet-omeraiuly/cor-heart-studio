import { describe, expect, it } from "vitest";
import { qtcGrade } from "@/domain/diagnosis/ecg";
import { female, find, male, missingFields, o, run } from "./helpers";

const ecg = (e: Record<string, unknown>, extra = {}) => run({ ecg: e, ...extra });
const qtc = (ms: number, extra = {}) => ecg({ qtc: o(ms, "ms") }, extra);

describe("QTc — AHA/ACCF/HRS 2009", () => {
  it("men 449 normal / 450 prolonged; women 459 normal / 460 prolonged", () => {
    expect(qtcGrade(449, "male")).toBe("normal");
    expect(qtcGrade(450, "male")).toBe("prolonged");
    expect(qtcGrade(459, "female")).toBe("normal");
    expect(qtcGrade(460, "female")).toBe("prolonged");
    expect(find(qtc(450, male), "qtc")?.grade).toBe("prolonged");
    expect(find(qtc(450, female), "qtc")?.grade).toBe("normal");
  });

  it("short ≤ 390 ms", () => {
    expect(qtcGrade(390, null)).toBe("short");
    expect(qtcGrade(391, null)).toBe("normal");
  });

  it("unknown sex: 449 normal, 455 indeterminate (sex asked for), 460 prolonged", () => {
    expect(find(qtc(449), "qtc")?.grade).toBe("normal");
    const a = qtc(455);
    expect(find(a, "qtc")?.grade).toBe("indeterminate");
    expect(missingFields(a)).toContain("demographics.biologicalSex");
    expect(find(qtc(460), "qtc")?.grade).toBe("prolonged");
  });

  it("red flag above 500 ms (reported)", () => {
    expect(qtc(500, male).redFlags).toEqual([]);
    expect(qtc(501, male).redFlags[0]).toContain("501");
  });

  it("computes Bazett and Fridericia from QT and heart rate (ecg.ts)", () => {
    const f = find(ecg({ qtInterval: o(400, "ms"), heartRate: o(60, "bpm") }), "qtc")!;
    expect(f.grade).toBe("normal");
    expect(f.evidence.filter((e) => e.field.startsWith("derived.")).map((e) => [e.field, e.value])).toEqual([["derived.qtcBazett", 400], ["derived.qtcFridericia", 400]]);
  });

  it("formula-dependent when Bazett and Fridericia classify differently", () => {
    // QT 380 ms at 90 bpm: Bazett 465, Fridericia 435
    const f = find(ecg({ qtInterval: o(380, "ms"), heartRate: o(90, "bpm") }, male), "qtc")!;
    expect(f.grade).toBe("formula-dependent");
    expect(f.evidence.find((e) => e.field === "derived.qtcBazett")?.value).toBe(465);
    expect(f.evidence.find((e) => e.field === "derived.qtcFridericia")?.value).toBe(435);
  });

  it("QT without a heart rate → heart rate missing, no QTc", () => {
    const a = ecg({ qtInterval: o(400, "ms") });
    expect(find(a, "qtc")).toBeUndefined();
    expect(missingFields(a)).toContain("ecg.heartRate");
  });

});

describe("PR, QRS, rate, rhythm", () => {
  it("PR 200 normal, 201 first-degree AV block", () => {
    expect(find(ecg({ prInterval: o(200, "ms") }), "first-degree-av-block")).toBeUndefined();
    expect(find(ecg({ prInterval: o(201, "ms") }), "first-degree-av-block")).toBeDefined();
  });
  it("QRS 119 normal, 120 wide; seconds are converted", () => {
    expect(find(ecg({ qrsDuration: o(119, "ms") }), "wide-qrs")).toBeUndefined();
    expect(find(ecg({ qrsDuration: o(0.12, "s") }), "wide-qrs")).toBeDefined();
  });
  it("heart rate 49 brady, 50 none, 100 none, 101 tachy", () => {
    expect(find(ecg({ heartRate: o(49, "bpm") }), "bradycardia")).toBeDefined();
    expect(find(ecg({ heartRate: o(50, "bpm") }), "bradycardia")).toBeUndefined();
    expect(find(ecg({ heartRate: o(100, "bpm") }), "tachycardia")).toBeUndefined();
    expect(find(ecg({ heartRate: o(101, "bpm") }), "tachycardia")).toBeDefined();
  });
  it("reported atrial fibrillation; a negated mention does not count", () => {
    expect(find(ecg({ rhythm: "Atrial fibrillation" }), "atrial-fibrillation")?.basis).toBe("supported");
    expect(find(ecg({ arrhythmias: ["paroxysmal AF"] }), "atrial-fibrillation")).toBeDefined();
    expect(find(ecg({ rhythm: "Sinus rhythm, no atrial fibrillation" }), "atrial-fibrillation")).toBeUndefined();
  });
});
