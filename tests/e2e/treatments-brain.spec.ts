import { expect, test } from "@playwright/test";
import path from "node:path";

const shots = path.resolve(__dirname, "../../docs/visual-review");

test("Brain: Now | In N years side by side, and the exercise button lifts the projected hippocampus", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Brain" }).click();
  await expect(page.getByTestId("brain-workspace")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("brain-canvas")).toHaveCount(1);

  await page.getByTestId("outlook-toggle").click();
  await expect(page.getByTestId("brain-canvas")).toHaveCount(2);
  await expect(page.getByTestId("brain-compare-now")).toContainText("Now");

  await page.getByRole("slider", { name: "Years from today" }).fill("1");
  await expect(page.getByTestId("brain-compare-later")).toContainText("In 1 year");
  await page.getByRole("radio", { name: "Slower" }).click();
  const table = page.getByTestId("brain-outlook-table");
  // Barnes 2009 Alzheimer's hippocampi, favourable end of the CI: −3.92 %/y
  await expect(table).toContainText("-3.9 %");

  const exercise = page.getByTestId("treatment-ad-exercise");
  await exercise.click();
  await expect(exercise).toHaveAttribute("aria-pressed", "true");
  // (1 − 0.0392) × (1 + 0.0346) − 1 ≈ −0.6 %
  await expect(table).toContainText("-0.6 %");
  await expect(table).not.toContainText("-3.9 %");

  await exercise.click();
  await expect(table).toContainText("-3.9 %");

  // ten years, average pace, no button on: the picture for the visual review
  await page.getByRole("slider", { name: "Years from today" }).fill("10");
  await page.getByRole("radio", { name: "Average" }).click();
  await page.waitForTimeout(1500);
  await page.getByTestId("brain-workspace").screenshot({ path: `${shots}/e2e-treatments-brain-ad-10y.png` });

  // typical ageing is not a disease scenario: no treatment buttons
  await page.getByRole("radio", { name: "Typical ageing" }).click();
  await expect(page.getByTestId("treatment-ad-exercise")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Brain: the anti-amyloid and B-vitamin buttons each change a structure in the projected brain, and off returns it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Brain" }).click();
  await expect(page.getByTestId("brain-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("outlook-toggle").click();
  await page.getByRole("slider", { name: "Years from today" }).fill("2");
  const row = (name: string) => page.getByTestId("brain-outlook-table").locator("tr", { hasText: name });
  const text = async (name: string) => (await row(name).innerText()).replace(/\s+/g, " ");

  const ventricles = await text("Ventricles");
  const cortex = await text("Cortex");

  // Alves 2023: larger ventricles (a harm signal), nothing else moves
  await page.getByTestId("treatment-ad-antiamyloid").click();
  await expect.poll(() => text("Ventricles")).not.toBe(ventricles);
  expect(await text("Cortex")).toBe(cortex);
  await page.getByTestId("treatment-ad-antiamyloid").click();
  await expect.poll(() => text("Ventricles")).toBe(ventricles);

  // VITACOG: the cortex loses less
  await page.getByTestId("treatment-ad-bvitamins").click();
  await expect.poll(() => text("Cortex")).not.toBe(cortex);
  expect(await text("Ventricles")).toBe(ventricles);
  await page.getByTestId("treatment-ad-bvitamins").click();
  await expect.poll(() => text("Cortex")).toBe(cortex);
  expect(errors).toEqual([]);
});

test("Brain: the 95 % intervals list the structures that have a reported spread, and anti-amyloid adds the ventricles", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Brain" }).click();
  await expect(page.getByTestId("brain-workspace")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("outlook-toggle").click();
  await page.getByRole("slider", { name: "Years from today" }).fill("3");
  const band = page.getByTestId("uncertainty-brain");
  await expect(band).toContainText("Hippocampi");   // Barnes 2009: 95 % CI of the cohort mean
  await expect(band).toContainText("Cortex");       // Sluimer 2008: SD between patients
  await expect(band).not.toContainText("Ventricles"); // de Leon 1989 reported no spread
  await page.getByTestId("treatment-ad-antiamyloid").click();
  await expect(band).toContainText("Ventricles");   // Alves 2023: 95 % CI of the +2.1 mL
});
