import { beforeEach, describe, expect, it } from "vitest";
import { useOutlook } from "@/outlook/outlookStore";

beforeEach(() => useOutlook.setState({ active: [], heartScenario: "as", brainScenario: "alzheimers" }));

describe("outlook store treatment buttons", () => {
  it("toggle adds then removes an id", () => {
    useOutlook.getState().toggle("lvh-losartan");
    expect(useOutlook.getState().active).toEqual(["lvh-losartan"]);
    useOutlook.getState().toggle("lvh-losartan");
    expect(useOutlook.getState().active).toEqual([]);
  });

  it("toggle in the same group replaces the earlier button", () => {
    useOutlook.getState().toggle("lvh-losartan");
    useOutlook.getState().toggle("lvh-atenolol");
    expect(useOutlook.getState().active).toEqual(["lvh-atenolol"]);
  });

  it("switching the heart scenario clears active", () => {
    useOutlook.getState().toggle("lvh-losartan");
    useOutlook.getState().set({ heartScenario: "lvh" });
    expect(useOutlook.getState().active).toEqual([]);
  });

  it("switching the brain scenario clears active", () => {
    useOutlook.getState().toggle("ad-exercise");
    useOutlook.getState().set({ brainScenario: "aging" });
    expect(useOutlook.getState().active).toEqual([]);
  });

  it("keeps active when a setting that is not a scenario changes", () => {
    useOutlook.getState().toggle("ad-exercise");
    useOutlook.getState().set({ years: 7 });
    expect(useOutlook.getState().active).toEqual(["ad-exercise"]);
  });
});
