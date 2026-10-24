import { expect, test } from "@playwright/test";
import path from "node:path";

const shots = path.resolve(__dirname, "../../docs/visual-review");

test("coronary stenosis: CAD-RADS in the inspector, lesion drawn on the CT anatomy template", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^Synthetic 08/ }).click();
  const vp = page.getByTestId("viewport");
  await expect.poll(async () => Number(await vp.locator("[data-frames]").getAttribute("data-frames").catch(() => "0")), { timeout: 30_000 }).toBeGreaterThan(60);

  const card = page.getByTestId("coronary-findings");
  await expect(card).toContainText("CAD-RADS 4A");
  await expect(card).toContainText("Left anterior descending · proximal");
  await expect(card).toContainText("75%");

  // the lesion's "View" turns the camera toward it (superior view for the proximal LAD)
  await card.getByRole("button", { name: "View" }).first().click();
  await page.waitForTimeout(1200);
  await vp.screenshot({ path: `${shots}/e2e-coronary-syn08-lad.png` });

  // the procedural heart has no lumen handles: the stenosis is listed as not drawn, the grade stays
  await page.getByRole("radio", { name: "Procedural" }).click();
  await expect(card).toContainText("CAD-RADS 4A");
  await page.getByRole("tab", { name: /Warnings|Issues/ }).click().catch(() => {});
  await page.getByRole("radio", { name: "CT anatomy" }).click();
  expect(errors).toEqual([]);
});
