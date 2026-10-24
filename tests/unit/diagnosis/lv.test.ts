import { describe, expect, it } from "vitest";
import { aseEfGrade, efCategory, isConcentric, lvMassIncreased } from "@/domain/diagnosis/lv";
import { alt, bsa2, female, find, male, missingFields, o, obsRec } from "./helpers";

const ef = (v: number, extra = {}) => obsRec({ lvEjectionFraction: o(v, "%") }, extra);

describe("LVEF category — ESC 2021 / AHA-ACC-HFSA 2022", () => {
  for (const [v, g] of [[40, "reduced"], [41, "mildly reduced"], [49, "mildly reduced"], [50, "preserved"]] as const) {
    it(`EF ${v} % → ${g}`, () => {
      expect(efCategory(v)).toBe(g);
      expect(find(ef(v), "lv-ef-category")).toMatchObject({ grade: g, basis: "rule-defined", target: "lv" });
    });
  }
});

describe("LVEF vs the ASE/EACVI 2015 normal range", () => {
  it("men: 51 abnormal, 52 normal; women: 53 abnormal, 54 normal", () => {
    expect(aseEfGrade(51, "male")).toBe("mildly abnormal");
    expect(aseEfGrade(52, "male")).toBe("normal");
    expect(aseEfGrade(53, "female")).toBe("mildly abnormal");
    expect(aseEfGrade(54, "female")).toBe("normal");
  });

  it("partitions: 41 mildly, 40 and 30 moderately, 29 severely abnormal", () => {
    expect([41, 40, 30, 29].map((v) => aseEfGrade(v, "male"))).toEqual(["mildly abnormal", "moderately abnormal", "moderately abnormal", "severely abnormal"]);
  });

  it("reports dysfunction only when abnormal for the sex", () => {
    expect(find(ef(53, female), "lv-systolic-dysfunction")?.grade).toBe("mildly abnormal");
    expect(find(ef(53, male), "lv-systolic-dysfunction")).toBeUndefined();
  });

  it("unknown sex: grades when both sexes agree, otherwise asks for sex", () => {
    expect(find(ef(45), "lv-systolic-dysfunction")?.grade).toBe("mildly abnormal");
    expect(missingFields(ef(45))).not.toContain("demographics.biologicalSex");
    const a = ef(53);
    expect(find(a, "lv-systolic-dysfunction")).toBeUndefined();
    expect(missingFields(a)).toContain("demographics.biologicalSex");
  });
});

describe("derived and conflicting EF", () => {
  it("grades the volume-derived EF when no LVEF is reported", () => {
    const a = obsRec({ lvEndDiastolicVolume: o(150, "mL"), lvEndSystolicVolume: o(90, "mL") });
    const f = find(a, "lv-ef-category")!;
    expect(f.grade).toBe("reduced");
    expect(f.label).toContain("derived");
    expect(f.evidence[0]).toMatchObject({ field: "derived.lvEfFromVolumes", value: 40 });
  });

  it("flags reported vs derived EF more than 5 points apart", () => {
    const a = obsRec({ lvEjectionFraction: o(60, "%"), lvEndDiastolicVolume: o(150, "mL"), lvEndSystolicVolume: o(90, "mL") });
    expect(find(a, "lv-ef-category")?.grade).toBe("preserved");
    expect(alt(a, "lvef-measurements-disagree")).toBeDefined();
    const ok = obsRec({ lvEjectionFraction: o(44, "%"), lvEndDiastolicVolume: o(150, "mL"), lvEndSystolicVolume: o(90, "mL") });
    expect(alt(ok, "lvef-measurements-disagree")).toBeUndefined();
  });

  it("asks for LVEF when there is none", () => {
    expect(missingFields(obsRec({ heartRate: o(70, "bpm") }))).toContain("observations.lvEjectionFraction");
  });
});

describe("LV dilatation", () => {
  const edd = (v: number, extra = {}, unit = "mm") => find(obsRec({ lvEndDiastolicDiameter: o(v, unit) }, extra), "lv-dilatation");
  it("men > 58.4 mm, women > 52.2 mm", () => {
    expect(edd(58.4, male)).toBeUndefined();
    expect(edd(58.5, male)?.grade).toBe("dilated");
    expect(edd(52.2, female)).toBeUndefined();
    expect(edd(52.3, female)?.grade).toBe("dilated");
  });
  it("accepts cm and asks for sex in the sex-dependent band", () => {
    expect(edd(6.0, {}, "cm")?.grade).toBe("dilated");
    const a = obsRec({ lvEndDiastolicDiameter: o(55, "mm") });
    expect(find(a, "lv-dilatation")).toBeUndefined();
    expect(missingFields(a)).toContain("demographics.biologicalSex");
  });
  it("LVEDV index > 74 (men) with BSA 2.00", () => {
    expect(find(obsRec({ lvEndDiastolicVolume: o(148, "mL") }, bsa2()), "lv-dilatation")).toBeUndefined();
    expect(find(obsRec({ lvEndDiastolicVolume: o(150, "mL") }, bsa2()), "lv-dilatation")?.evidence.map((e) => e.field)).toContain("derived.lvEndDiastolicVolumeIndex");
  });
});

describe("LV mass and geometry", () => {
  it("LVMI thresholds 115 (men) / 95 (women) g/m²", () => {
    expect(lvMassIncreased(115, "male")).toBe(false);
    expect(lvMassIncreased(115.1, "male")).toBe(true);
    expect(lvMassIncreased(95, "female")).toBe(false);
    expect(lvMassIncreased(95.1, "female")).toBe(true);
  });
  it("RWT 0.42 is not concentric, 0.43 is", () => {
    expect(isConcentric(0.42)).toBe(false);
    expect(isConcentric(0.43)).toBe(true);
  });

  const walls = (ivs: number, pw: number, lvedd: number, extra = bsa2()) =>
    obsRec({ ivsThickness: o(ivs, "mm"), lvPosteriorWallThickness: o(pw, "mm"), lvEndDiastolicDiameter: o(lvedd, "mm") }, extra);

  it("concentric LVH: thick walls, normal cavity (LVMI 144.2, RWT 0.58)", () => {
    const f = find(walls(15, 14, 48), "lv-hypertrophy")!;
    expect(f.grade).toBe("concentric");
    expect(f.evidence.find((e) => e.field === "derived.lvMassIndex")?.value).toBe(144.2);
    expect(f.evidence.find((e) => e.field === "derived.relativeWallThickness")?.value).toBe(0.58);
  });
  it("eccentric LVH: dilated cavity, normal walls", () => {
    expect(find(walls(11, 10, 64), "lv-hypertrophy")?.grade).toBe("eccentric");
  });
  it("concentric remodelling: normal mass, RWT > 0.42", () => {
    expect(find(walls(10, 10, 42), "lv-concentric-remodelling")).toBeDefined();
    expect(find(walls(10, 10, 42), "lv-hypertrophy")).toBeUndefined();
  });
  it("normal geometry gives no finding", () => {
    const a = walls(9, 9, 48);
    expect(find(a, "lv-hypertrophy")).toBeUndefined();
    expect(find(a, "lv-concentric-remodelling")).toBeUndefined();
  });

  it("without BSA: wall > 10 mm (men) / > 9 mm (women) is supported, and height/weight are asked for", () => {
    const thick = (v: number, extra: Record<string, unknown>) => find(obsRec({ ivsThickness: o(v, "mm") }, extra), "lv-increased-wall-thickness");
    expect(thick(10, male)).toBeUndefined();
    expect(thick(11, male)?.basis).toBe("supported");
    expect(thick(9, female)).toBeUndefined();
    expect(thick(10, female)?.basis).toBe("supported");
    const a = obsRec({ ivsThickness: o(13, "mm"), lvPosteriorWallThickness: o(12, "mm"), lvEndDiastolicDiameter: o(48, "mm") });
    expect(missingFields(a)).toContain("demographics.heightCm");
  });
});

describe("regional wall motion by territory (AHA 17-segment)", () => {
  it("groups abnormal segments by coronary territory; normal segments are ignored", () => {
    const a = obsRec({}, { echo: { regionalWallMotion: [{ segment: 3, motion: "hypokinetic" }, { segment: 5, motion: "akinetic" }, { segment: 1, motion: "normal" }, { segment: 9, motion: "akinetic" }] } });
    const w = a.findings.filter((f) => f.condition === "regional-wall-motion-abnormality");
    expect(w.map((f) => [f.label.includes("RCA") ? "RCA" : "LCx", f.grade, f.target])).toEqual([["RCA", "akinetic", "lv#3"], ["LCx", "akinetic", "lv#5"]]);
    expect(w[0].evidence.map((e) => e.field)).toEqual(["echo.regionalWallMotion[3]", "echo.regionalWallMotion[9]"]);
    expect(w[0].basis).toBe("supported");
  });
});
