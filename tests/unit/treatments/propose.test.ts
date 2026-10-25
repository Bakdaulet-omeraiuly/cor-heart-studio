import { describe, expect, it } from "vitest";
import { allowedIds, sanitizeProposals } from "@/domain/treatments/propose";
import { EVIDENCE } from "@/domain/treatments/load";

const why = (id: string) => EVIDENCE.entries.find((e) => e.id === id)!.why;

describe("allowedIds", () => {
  it("lists every treatment entry of the condition and nothing else", () => {
    expect(allowedIds("lvh").sort()).toEqual(["lvh-atenolol", "lvh-bp-control", "lvh-losartan"]);
    expect(allowedIds("ad").sort()).toEqual(["ad-antiamyloid", "ad-bvitamins", "ad-exercise"]);
  });
});

describe("sanitizeProposals", () => {
  it("drops an id that is not in the list for the condition", () => {
    const out = sanitizeProposals([{ id: "lvh-losartan", reason: "Regresses mass." }, { id: "ad-exercise", reason: "Wrong organ." }, { id: "nope", reason: "Invented." }], "lvh");
    expect(out.map((p) => p.id)).toEqual(["lvh-losartan"]);
  });

  it("replaces a reason that contains a digit by the table's own sentence", () => {
    const out = sanitizeProposals([{ id: "lvh-atenolol", reason: "Cuts mass by 12 g/m2." }], "lvh");
    expect(out).toEqual([{ id: "lvh-atenolol", reason: why("lvh-atenolol") }]);
  });

  it("keeps a clean reason", () => {
    const out = sanitizeProposals([{ id: "lvh-losartan", reason: "Regresses mass more than atenolol." }], "lvh");
    expect(out[0].reason).toBe("Regresses mass more than atenolol.");
  });

  it("caps the list at five and removes duplicates", () => {
    const raw = Array.from({ length: 9 }, () => ({ id: "lvh-losartan", reason: "x" }));
    expect(sanitizeProposals(raw, "lvh")).toHaveLength(1);
  });

  it("returns an empty list for anything that is not an array of objects", () => {
    expect(sanitizeProposals("lvh-losartan", "lvh")).toEqual([]);
    expect(sanitizeProposals([null, 3, "x"], "lvh")).toEqual([]);
    expect(sanitizeProposals(undefined, "lvh")).toEqual([]);
  });
});
