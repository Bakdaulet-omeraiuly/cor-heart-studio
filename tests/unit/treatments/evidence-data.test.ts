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

  it("ad-antiamyloid is listed without an effect", () => {
    expect(byId("ad-antiamyloid").effect).toBeUndefined();
  });

  it("every entry with an effect has likely, best and worst ordered best <= likely <= worst for LVH and worst <= likely <= best for the brain", () => {
    for (const e of EVIDENCE.entries) {
      if (!e.effect) continue;
      const { likely, best, worst, quantity } = e.effect;
      const [low, high] = quantity === "lvmi_gm2" ? [best, worst] : [worst, best];
      expect(low).toBeLessThanOrEqual(likely);
      expect(likely).toBeLessThanOrEqual(high);
    }
  });

  it("every source carries a DOI", () => {
    for (const s of Object.values(EVIDENCE.sources)) expect(s.doi).toMatch(/^10\./);
  });
});
