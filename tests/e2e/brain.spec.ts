import { expect, test } from "@playwright/test";
import path from "node:path";

const shots = path.resolve(__dirname, "../../docs/visual-review");

test("brain module: 3D model, MRI slices with segmentation, linked crosshair", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Brain" }).click();
  await expect(page.getByTestId("brain-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("brain-provenance")).toContainText("CC BY 4.0");
  await expect(page.getByTestId("brain-provenance")).toContainText("Not reviewed by a clinician");
  for (const v of ["axial", "coronal", "sagittal"]) await expect(page.getByTestId(`slice-${v}`)).toBeVisible();

  // clicking the axial slice moves the shared crosshair (other views follow) and selects the structure there
  const axial = page.getByTestId("slice-axial").locator("canvas");
  const coronal = page.getByTestId("slice-coronal").locator("canvas");
  const before = await coronal.getAttribute("data-crosshair");
  const box = (await axial.boundingBox())!;
  await axial.click({ position: { x: box.width * 0.42, y: box.height * 0.5 } });
  await expect(coronal).not.toHaveAttribute("data-crosshair", before!);
  await expect(page.getByTestId("brain-selection")).toBeVisible();

  // choosing a structure from the list (deep grey matter is expanded by default) jumps the slices to it
  await page.getByRole("button", { name: /^Hippocampus \(left\)/ }).click();
  await expect(page.getByTestId("brain-selection")).toContainText("Hippocampus (left)");
  await expect(page.getByTestId("brain-selection")).toContainText("Automatically (FreeSurfer)");
  await expect(page.getByTestId("brain-selection")).toContainText("COR-Fit ≤1 vox");
  await expect(page.getByTestId("brain-workspace")).toContainText(/COR-Fit ≤ 1\.2 mm/);
  // a deep structure chosen from the list makes the cortex see-through (and the camera turns to it)
  await expect(page.getByRole("slider", { name: "Cortex opacity" })).toHaveValue("0.2");
  await page.waitForTimeout(1500);
  await page.getByTestId("brain-workspace").screenshot({ path: `${shots}/e2e-brain-hippocampus.png` });

  await page.getByRole("slider", { name: "Cortex opacity" }).fill("0.15");
  await page.waitForTimeout(800);
  await page.getByTestId("brain-workspace").screenshot({ path: `${shots}/e2e-brain-deep.png` });
  expect(errors).toEqual([]);
});

test("switching back to the heart module keeps the heart working", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Brain" }).click();
  await expect(page.getByTestId("brain-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Heart" }).click();
  await expect(page.getByTestId("viewport")).toBeVisible();
  await expect(page.getByTestId("patient-list")).toBeVisible();
});
