import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const shots = path.resolve(__dirname, "../../docs/visual-review");
const viewport = (page: Page) => page.getByTestId("viewport");
const frames = (page: Page) => viewport(page).locator("[data-frames]").getAttribute("data-frames").then(Number).catch(() => 0);

/** Open a CT case and wait until its heart is rendering (frame counter advances after the switch). */
async function openCtCase(page: Page, caseId: string) {
  await page.goto("/");
  const item = page.getByTestId("patient-list").getByRole("button", { name: new RegExp(`^Open CT · ${caseId}`) });
  await expect(item).toBeVisible();
  await item.click();
  await expect(page.getByTestId("geometry-badge")).toContainText("Tier B");
  const start = await frames(page);
  await expect.poll(async () => (await frames(page)) - start, { timeout: 30_000 }).toBeGreaterThan(60);
}

test("a CT-derived heart (Tier B) renders with its provenance", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openCtCase(page, "s0270");
  await expect(page.getByTestId("fallback-2d")).toHaveCount(0);
  await expect(page.getByTestId("geometry-badge")).toContainText("not reviewed by a clinician");
  await expect(page.getByTestId("geometry-badge")).toContainText("CC BY 4.0");
  await page.waitForTimeout(1500);
  await viewport(page).screenshot({ path: `${shots}/e2e-tier-b-s0270-anterior.png` });

  await page.getByRole("button", { name: "Cutaway" }).click();
  await page.getByRole("switch", { name: "Cutaway plane" }).click();
  await page.keyboard.press("Escape");
  await page.locator("#view-preset").selectOption("four_chamber");
  await page.waitForTimeout(1500);
  await viewport(page).screenshot({ path: `${shots}/e2e-tier-b-s0270-four-chamber.png` });

  // the Inspector states the tier and the dataset
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(page.getByText(/^B — CT segmentation/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("switching between a procedural and a CT heart keeps rendering", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openCtCase(page, "s0338");
  await page.getByTestId("patient-list").getByRole("button", { name: /^Synthetic 01/ }).click();
  await expect(page.getByTestId("geometry-badge")).toContainText("Tier A");
  const start = await frames(page);
  await expect.poll(async () => (await frames(page)) - start, { timeout: 30_000 }).toBeGreaterThan(60);
  await page.getByTestId("patient-list").getByRole("button", { name: /^Open CT · s0338/ }).click();
  await expect(page.getByTestId("geometry-badge")).toContainText("Tier B");
  await page.waitForTimeout(1500);
  await viewport(page).screenshot({ path: `${shots}/e2e-tier-b-s0338-anterior.png` });
  expect(errors).toEqual([]);
});

test("comparison mixes a procedural and a CT heart", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openCtCase(page, "s0270");
  await page.getByRole("button", { name: "Compare patients" }).click();
  // the compare view starts with the first two records (synthetic); add the CT case as the third
  await page.getByRole("checkbox", { name: /Compare Open CT · s0270/ }).check();
  await expect(page.getByTestId("compare-view")).toHaveCount(3);
  await expect(page.getByText("Loading anatomical asset…")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await page.getByTestId("compare").screenshot({ path: `${shots}/e2e-tier-b-compare.png` });
  expect(errors).toEqual([]);
});
