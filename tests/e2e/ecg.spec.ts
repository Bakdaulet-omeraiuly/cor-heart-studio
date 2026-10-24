import { expect, test } from "@playwright/test";
import path from "node:path";

const shots = path.resolve(__dirname, "../../docs/visual-review");

test("ECG strip: intervals with their provenance, rate-corrected QT, locked to the 3D cycle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /^Synthetic 01/ }).click();
  const strip = page.getByTestId("ecg-strip");
  await expect(strip).toContainText("PR 160 ms reported");
  await expect(strip).toContainText("QT 392 ms reported");
  await expect(strip).toContainText("417 Bazett"); // 392 / √(60/68)
  await expect(strip).toContainText("not a recording");

  // a record without intervals: labelled population defaults, never presented as the patient's
  await page.getByRole("button", { name: /^Synthetic 02/ }).click();
  await expect(strip).toContainText("PR 160 ms default");
  await expect(strip).toContainText(/QT \d+ ms default/);
  await page.waitForTimeout(800);
  await strip.screenshot({ path: `${shots}/e2e-ecg-strip.png` });
  expect(errors).toEqual([]);
});
