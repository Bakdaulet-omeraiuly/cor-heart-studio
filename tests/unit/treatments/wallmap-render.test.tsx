import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WallMap } from "@/outlook/WallMap";

describe("WallMap", () => {
  it("draws both rings, the dashed ghost of today on the projection, and the wall values", () => {
    const html = renderToStaticMarkup(<WallMap today={{ ivsMm: 14, pwMm: 13 }} later={{ ivsMm: 12.3, pwMm: 11.4 }} lvidMm={46} years={10} />);
    expect(html).toContain("septum 14.0 · posterior 13.0 mm");
    expect(html).toContain("septum 12.3 · posterior 11.4 mm");
    expect(html.match(/data-testid="wall-ghost"/g)).toHaveLength(1);
    expect(html).toContain("+10 y");
  });
});
