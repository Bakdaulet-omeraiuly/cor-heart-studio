import { describe, expect, it } from "vitest";
import { EVIDENCE, entriesFor, sourceById } from "@/domain/treatments/load";

const byId = (id: string) => {
  const e = EVIDENCE.entries.find((x) => x.id === id);
  if (!e) throw new Error(`missing entry ${id}`);
  return e;
};

describe("treatment evidence data", () => {
  it("lvh has a natural-course entry from the Simpson 2009 placebo arm", () => {
    const [n] = entriesFor("lvh", "natural");
    expect(n.id).toBe("lvh-natural");
    expect(n.effect?.likely).toBeCloseTo(1.97, 2);
    expect(n.effect?.evidenceYears).toBe(1);
    expect(n.sources).toContain("simpson2009");
  });

  it("lvh-losartan and lvh-atenolol share group bp-regimen with the LIFE changes", () => {
    expect(byId("lvh-losartan").group).toBe("bp-regimen");
    expect(byId("lvh-atenolol").group).toBe("bp-regimen");
    expect(byId("lvh-losartan").effect?.likely).toBeCloseTo(-21.7, 1);
    expect(byId("lvh-atenolol").effect?.likely).toBeCloseTo(-17.7, 1);
    expect(byId("lvh-losartan").effect?.evidenceYears).toBeCloseTo(4.8, 1);
  });

  it("as-statin has no effect and cites randomised sources only", () => {
    const e = byId("as-statin");
    expect(e.effect).toBeUndefined();
    for (const id of e.sources) expect(["rct", "meta-analysis"]).toContain(sourceById(id).studyType);
    expect(e.sources).toEqual(expect.arrayContaining(["chan2010", "cowell2005", "rossebo2008"]));
  });

  it("ad-exercise effect spans zero (worst <= 0 <= best) with the Erickson difference as the favourable end", () => {
    const eff = byId("ad-exercise").effect!;
    expect(eff.quantity).toBe("hippocampus_pct");
    expect(eff.worst).toBeLessThanOrEqual(0);
    expect(eff.best).toBeGreaterThanOrEqual(0);
    expect(eff.best).toBeCloseTo(3.46, 2);
  });

  it("ad-antiamyloid enlarges the ventricles by the Alves 2023 difference, 2.1 mL (95% CI 1.5 to 2.8)", () => {
    const eff = byId("ad-antiamyloid").effect!;
    expect(eff.quantity).toBe("ventricles_ml");
    expect([eff.best, eff.likely, eff.worst]).toEqual([1.5, 2.1, 2.8]);
    expect(byId("ad-antiamyloid").sources).toContain("alves2023");
  });

  it("ad-bvitamins slows the loss by the VITACOG difference: (1.08 - 0.76) / 1.08 = 29.6%, 53% with high homocysteine, 0 when omega-3 is low", () => {
    const eff = byId("ad-bvitamins").effect!;
    expect(eff.quantity).toBe("cortex_slowing_pct");
    expect(eff.likely).toBeCloseTo((100 * (1.08 - 0.76)) / 1.08, 1);
    expect([eff.best, eff.worst, eff.evidenceYears]).toEqual([53, 0, 2]);
    expect(byId("ad-bvitamins").sources).toEqual(["smith2010", "jerneren2015"]);
  });

  it("the drug-class buttons carry the Klingbeil 2003 LV mass index changes with their 95% confidence intervals", () => {
    const want: Record<string, [number, number, number]> = { "lvh-ace": [-10, -12, -8], "lvh-ccb": [-11, -13, -9], "lvh-diuretic": [-8, -10, -5] };
    for (const [id, [likely, best, worst]] of Object.entries(want)) {
      const e = byId(id);
      expect(e.group).toBe("bp-regimen");
      expect(e.effect).toMatchObject({ quantity: "lvmi_pct", likely, best, worst });
      expect(e.sources).toEqual(["klingbeil2003"]);
    }
  });

  it("lvh-weightloss is the diet-only arm of the Heart Health Study: -2.9 g (95% CI -5.2 to -0.7) over 12 months", () => {
    const e = byId("lvh-weightloss");
    expect(e.effect).toMatchObject({ quantity: "lvm_g", likely: -2.9, best: -5.2, worst: -0.7, evidenceYears: 1 });
    expect(e.group).toBe("lifestyle");
  });

  it("the valve buttons carry the PARTNER 3 one-year valve areas, 1.72 ± 0.37 (TAVR) and 1.76 ± 0.42 cm² (surgery), and exclude each other", () => {
    const tavr = byId("as-tavr"), savr = byId("as-savr");
    expect(tavr.effect).toMatchObject({ quantity: "ava_cm2", likely: 1.72, best: 2.09, worst: 1.35, evidenceYears: 1 });
    expect(savr.effect).toMatchObject({ quantity: "ava_cm2", likely: 1.76, best: 2.18, worst: 1.34, evidenceYears: 1 });
    expect(tavr.group).toBe(savr.group);
    expect(tavr.sources).toContain("pibarot2020");
  });

  it("every entry with an effect has likely, best and worst ordered best <= likely <= worst for LVH and worst <= likely <= best for the brain", () => {
    for (const e of EVIDENCE.entries) {
      if (!e.effect) continue;
      const { likely, best, worst, quantity } = e.effect;
      // for LV mass and added ventricular volume the favourable end is the lowest value
      const [low, high] = ["lvmi_gm2", "lvmi_pct", "lvm_g", "ventricles_ml"].includes(quantity) ? [best, worst] : [worst, best];
      expect(low).toBeLessThanOrEqual(likely);
      expect(likely).toBeLessThanOrEqual(high);
    }
  });

  it("every source carries a DOI", () => {
    for (const s of Object.values(EVIDENCE.sources)) expect(s.doi).toMatch(/^10\./);
  });
});
