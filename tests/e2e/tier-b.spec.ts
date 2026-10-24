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

  // key numbers come from the segmentation, with their source
  await expect(page.getByTestId("heart-metrics")).toContainText("LV cavity");
  await expect(page.getByTestId("heart-metrics")).toContainText("126.5");
  await expect(page.getByTestId("heart-metrics")).toContainText("CT segmentation");

  // COR-Fit accuracy: headline on the badge, full table in the CT panel
  await expect(page.getByTestId("corfit-line")).toContainText(/COR-Fit: 9\d\.\d% of the surface within 1\.5 mm/);

  // source CT evidence: three planes, crosshair shared between them
  await expect(page.getByTestId("ct-evidence")).toBeVisible();
  for (const v of ["axial", "coronal", "sagittal"]) await expect(page.getByTestId(`slice-${v}`)).toBeVisible();
  const axial = page.getByTestId("slice-axial").locator("canvas");
  const coronal = page.getByTestId("slice-coronal").locator("canvas");
  await expect(coronal).toHaveAttribute("data-crosshair", /\d/);
  const before = await coronal.getAttribute("data-crosshair");
  const box = (await axial.boundingBox())!;
  await axial.click({ position: { x: box.width * 0.55, y: box.height * 0.45 } });
  await expect(coronal).not.toHaveAttribute("data-crosshair", before!);
  await page.getByRole("radio", { name: "COR-Fit accuracy" }).click();
  await expect(page.getByTestId("heart-fidelity")).toContainText("LV cavity (endocardium)");
  await expect(page.getByTestId("heart-fidelity")).toContainText("fixed thickness, not from imaging");
  await page.getByRole("radio", { name: "Volumes" }).click();
  await page.getByRole("button", { name: "Soft tissue" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("main").screenshot({ path: `${shots}/e2e-tier-b-s0270-ct-evidence.png` });

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

test("the inspector can be collapsed to widen the 3D view", async ({ page }) => {
  await openCtCase(page, "s0270");
  const before = (await viewport(page).boundingBox())!.width;
  await page.getByRole("button", { name: "Hide inspector" }).click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toHaveCount(0);
  await expect.poll(async () => (await viewport(page).boundingBox())!.width).toBeGreaterThan(before + 200);
  const start = await frames(page);
  await expect.poll(async () => (await frames(page)) - start, { timeout: 30_000 }).toBeGreaterThan(30);
  await page.waitForTimeout(1200);
  await page.getByRole("main").screenshot({ path: `${shots}/e2e-tier-b-wide.png` });
  // reopen from the slim rail, close with the panel's own ✕
  await page.getByRole("button", { name: "Open inspector" }).click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toBeVisible();
  await page.getByRole("button", { name: "Close inspector" }).click();
  await expect(page.getByRole("complementary", { name: "Inspector" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show inspector" }).click();

  // resize from its left edge (keyboard here; pointer drag uses the same handler)
  const inspector = page.getByRole("complementary", { name: "Inspector" });
  const w0 = (await inspector.boundingBox())!.width;
  const handle = page.getByRole("separator", { name: "Resize inspector" });
  await handle.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeLessThan(w0 - 60);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 150, box.y + 200, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await inspector.boundingBox())!.width).toBeGreaterThan(w0 + 40);
});
