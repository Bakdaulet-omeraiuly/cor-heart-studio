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
