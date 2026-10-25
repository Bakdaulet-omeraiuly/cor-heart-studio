import { describe, expect, it } from "vitest";
import { outerOutline, thicknessAt, thicknessColor, wallSegments } from "@/outlook/wallGeometry";

describe("wall map geometry", () => {
  it("is the septum thickness on the left and the posterior thickness on the right", () => {
    expect(thicknessAt(Math.PI, 14, 12)).toBeCloseTo(14);
    expect(thicknessAt(0, 14, 12)).toBeCloseTo(12);
  });
  it("is blue when thin, red when thick, and clamped outside 8 to 16 mm", () => {
    expect(thicknessColor(8)).toBe("hsl(210 70% 50%)");
    expect(thicknessColor(16)).toBe("hsl(0 70% 50%)");
    expect(thicknessColor(30)).toBe(thicknessColor(16));
    expect(thicknessColor(2)).toBe(thicknessColor(8));
  });
  it("builds a full ring of segments", () => {
    const seg = wallSegments(14, 13, 46, 36);
    expect(seg).toHaveLength(36);
    expect(Math.max(...seg.map((s) => s.mm))).toBeLessThanOrEqual(14);
  });
  it("gives a thicker wall a larger outline than a thinner one", () => {
    expect(outerOutline(14, 13, 46)).not.toBe(outerOutline(12, 11, 46));
  });
});
