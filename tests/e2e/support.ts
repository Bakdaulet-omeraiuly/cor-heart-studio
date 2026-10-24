import { expect, type Page } from "@playwright/test";
import path from "node:path";

/** SYN-001…SYN-007. The site ships only SYN-008; tests that need the others import this fixture through the import dialog. */
export const OTHER_SAMPLES = path.resolve(__dirname, "../fixtures/synthetic-patients.001-007.json");

export async function loadFullSamples(page: Page) {
  await page.getByRole("button", { name: "Import JSON / CSV" }).click();
  await page.getByTestId("file-input").setInputFiles(OTHER_SAMPLES);
  await page.getByTestId("commit-import").click();
  await expect(page.getByRole("status").filter({ hasText: /Imported 7 records/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("patient-list").getByRole("button", { name: /^Synthetic 01/ })).toBeVisible();
}
