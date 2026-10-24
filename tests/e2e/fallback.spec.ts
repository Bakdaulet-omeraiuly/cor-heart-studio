import { expect, test } from "@playwright/test";

test("shows a labelled 2D data fallback when WebGL is unavailable", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("fallback-2d")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/this is a schematic, not the 3D model/)).toBeVisible();
  // essential information stays available outside the canvas
  await expect(page.getByRole("tab", { name: /Observations/ })).toBeVisible();
  await page.screenshot({ path: "docs/visual-review/e2e-fallback-no-webgl.png" });
});
