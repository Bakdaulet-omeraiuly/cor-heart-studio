import { describe, expect, it } from "vitest";
import { cadRads, DISPLAY_NAME, stenosisCategory } from "@/domain/coronary";
import roderoManifest from "@/scene/asset-adapters/template/rodero-01.manifest.json";
import { mapPatientToVisual } from "@/domain/mapping/mapPatientToVisual";
import { HEART_ASSETS, PROCEDURAL_ASSET_ID, RODERO_TEMPLATE_ID } from "@/scene/asset-adapters/registry";
import { minimal, norm, samplePatients } from "./helpers";

const f = (vessel: "LM" | "LAD" | "LCx" | "RCA" | "PDA", stenosisPercent: number, segment?: "proximal" | "mid" | "distal") => ({ vessel, stenosisPercent, segment });

describe("CAD-RADS 2.0", () => {
  it("grades a single lesion by diameter stenosis", () => {
    expect([0, 10, 24, 25, 49, 50, 69, 70, 99, 100].map(stenosisCategory)).toEqual(["0", "1", "1", "2", "2", "3", "3", "4A", "4A", "5"]);
  });

  it("takes the most severe lesion per patient", () => {
    expect(cadRads([f("RCA", 40), f("LAD", 75), f("LCx", 20)])).toMatchObject({ category: "4A", driver: { vessel: "LAD" } });
    expect(cadRads([]).category).toBe("0");
  });

  it("applies the 4B modifiers: left main ≥ 50 % or three-vessel ≥ 70 %", () => {
    expect(cadRads([f("LM", 55)]).category).toBe("4B");
    expect(cadRads([f("LAD", 80), f("LCx", 70), f("PDA", 90)]).category).toBe("4B");
    expect(cadRads([f("LAD", 80), f("LCx", 70)]).category).toBe("4A");
    expect(cadRads([f("LM", 55), f("RCA", 100)]).category).toBe("5");
  });
});

describe("coronary mapping", () => {
  const syn8 = norm(samplePatients().find((p) => p.patientId === "SYN-008")!);
  const tpl = HEART_ASSETS[RODERO_TEMPLATE_ID];

  it("normalizes vessel aliases", () => {
    const p = norm(minimal({ coronaryFindings: [{ vessel: "left anterior descending", segment: "Mid", stenosisPercent: 50 }, { vessel: "circumflex", stenosisPercent: 30 }] }));
    expect(p.coronaryFindings.map((c) => [c.vessel, c.segment])).toEqual([["LAD", "mid"], ["LCx", undefined]]);
  });

  it("draws each reported lesion on the CT template with its CAD-RADS grade", () => {
    const v = mapPatientToVisual(syn8, tpl.profile, tpl.capabilities);
    expect(v.coronary.cadRads).toBe("4A");
    expect(v.coronary.lesions.map((l) => [l.vessel, l.narrowing, l.category])).toEqual([["LAD", 0.75, "4A"], ["RCA", 0.4, "2"], ["LCx", 0.2, "1"]]);
    const lad = v.coronary.lesions[0];
    expect(lad.tCentre).toBeCloseTo(1 / 6);
    expect(lad.tHalfWidth).toBeGreaterThan(0);
    expect(v.changes.filter((c) => c.ruleId === "R-CORO-STEN-01")).toHaveLength(3);
    expect(v.structureStatus.coronary_vessels.status).toBe("measured_driven");
  });

  it("reports the stenosis as unsupported on the procedural heart (no lumen handles)", () => {
    const proc = HEART_ASSETS[PROCEDURAL_ASSET_ID];
    const v = mapPatientToVisual(syn8, proc.profile, proc.capabilities);
    expect(v.coronary.lesions).toEqual([]);
    expect(v.coronary.cadRads).toBe("4A"); // the grade is about the record, not the drawing
    expect(v.unsupported.filter((u) => u.label === "Coronary stenosis")).toHaveLength(3);
  });
});

describe("vessel naming", () => {
  it("DISPLAY_NAME covers every manifest vessel id", () => {
    const ids = Object.keys((roderoManifest as { coronary: { vessels: Record<string, unknown> } }).coronary.vessels).map(Number);
    expect(ids.length).toBeGreaterThan(15);
    for (const id of ids) expect(DISPLAY_NAME[id], `vessel ${id}`).toBeTruthy();
  });
});
