import { describe, expect, it } from "vitest";
import { EvidenceFileSchema } from "@/domain/treatments/schema";

const source = (over: Record<string, unknown> = {}) => ({
  id: "s1", cite: "Test 2020", title: "A trial", journal: "J Test", doi: "10.1000/test", studyType: "rct",
  n: 100, durationMonths: 12, population: "adults", ...over,
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1", condition: "lvh", kind: "treatment", label: "Drug", why: "Lowers pressure.", caveat: "n=100, 12 months.",
  sources: ["s1"], effect: { quantity: "lvmi_gm2", likely: -5, best: -8, worst: -1, evidenceYears: 1 }, ...over,
});

const file = (sources: Record<string, unknown>, entries: unknown[]) => ({ sources, entries });
const ok = (f: unknown) => EvidenceFileSchema.safeParse(f).success;

describe("treatment evidence schema", () => {
  it("accepts a treatment entry backed by a randomised source", () => {
    expect(ok(file({ s1: source() }, [entry()]))).toBe(true);
  });

  it("rejects an entry whose source has no DOI", () => {
    expect(ok(file({ s1: source({ doi: "" }) }, [entry()]))).toBe(false);
  });

  it("rejects an entry with an empty caveat", () => {
    expect(ok(file({ s1: source() }, [entry({ caveat: "" })]))).toBe(false);
  });

  it("rejects a treatment effect whose sources are not rct or meta-analysis", () => {
    expect(ok(file({ s1: source({ studyType: "observational" }) }, [entry()]))).toBe(false);
  });

  it("rejects a source id that is not in sources", () => {
    expect(ok(file({ s1: source() }, [entry({ sources: ["missing"] })]))).toBe(false);
  });

  it("accepts a natural-course entry from a placebo-arm source", () => {
    const e = entry({ kind: "natural", id: "n1" });
    expect(ok(file({ s1: source({ studyType: "placebo-arm" }) }, [e]))).toBe(true);
  });

  it("accepts a treatment entry with no effect", () => {
    const e = entry({ effect: undefined });
    expect(ok(file({ s1: source({ studyType: "observational" }) }, [e]))).toBe(true);
  });
});
