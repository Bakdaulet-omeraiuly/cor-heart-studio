import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const shots = path.resolve(__dirname, "../../docs/visual-review");
const viewport = (page: Page) => page.getByTestId("viewport");

async function ready(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("patient-list").getByRole("button", { name: /^Synthetic 01/ })).toBeVisible();
  // the render loop is running (frame counter advances) — proves WebGL initialised, not just that a canvas exists
  await expect.poll(async () => Number(await viewport(page).locator("[data-frames]").getAttribute("data-frames").catch(() => "0")), { timeout: 30_000 }).toBeGreaterThan(60);
}

test("loads samples and renders the 3D heart", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await ready(page);
  await expect(page.getByTestId("fallback-2d")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Visual changes/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await viewport(page).screenshot({ path: `${shots}/e2e-anterior-dark.png` });
  expect(errors).toEqual([]);
});

test("import → select → render → explanation (complete user flow)", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Import JSON / CSV" }).click();
  await page.getByTestId("file-input").setInputFiles(path.resolve(__dirname, "../../public/samples/invalid/duplicates.csv"));
  const rows = page.locator("tbody tr[data-status]");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute("data-status", "valid");
  await expect(rows.nth(1)).toHaveAttribute("data-status", "duplicate_in_file");
  await page.getByTestId("commit-import").click();
  await expect(page.getByText(/Imported 2 records/)).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  // the first imported record is selected and explained
  await expect(page.getByRole("heading", { name: "DUP-040" })).toBeVisible();
  await page.getByRole("tab", { name: /Visual changes/ }).click();
  await expect(page.getByText("R-HR-01 v1.0.0")).toBeVisible();
  await expect(page.getByText(/observations\.heartRate = 70 bpm/)).toBeVisible();
  await expect(page.getByText(/R-LV-EF-01/)).toBeVisible();
});

test("rejected and duplicate rows require an explicit decision", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Import JSON / CSV" }).click();
  await page.getByTestId("file-input").setInputFiles(path.resolve(__dirname, "../../public/samples/synthetic-patients.json"));
  await expect(page.locator("tbody tr[data-status=duplicate_existing]")).toHaveCount(8);
  await expect(page.getByTestId("commit-import")).toBeDisabled();
  await page.getByRole("button", { name: "Skip all" }).click();
  await expect(page.getByTestId("commit-import")).toBeDisabled(); // 0 records to import
  await page.getByRole("button", { name: "Replace all" }).click();
  await expect(page.getByTestId("commit-import")).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Import JSON / CSV" }).click();
  await page.getByTestId("file-input").setInputFiles(path.resolve(__dirname, "../../public/samples/invalid/missing-identifiers.json"));
  await expect(page.locator("tbody tr[data-status=rejected]")).toHaveCount(2);
  await expect(page.getByText(/Add a study identifier/).first()).toBeVisible();
});

test("patient switching updates explanations without stale data", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: /^Synthetic 02/ }).click();
  await page.getByRole("tab", { name: /Visual changes/ }).click();
  await expect(page.getByRole("tabpanel").getByText(/LVEDD 65 mm/)).toBeVisible();
  await page.getByRole("button", { name: /^Synthetic 06/ }).click();
  await expect(page.getByRole("tabpanel").getByText(/LVEDD 65 mm/)).toHaveCount(0);
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(page.getByText(/No LV diameter or volume supplied/)).toBeVisible();
});

test("structure list selects, isolates and restores structures", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Layers and structures" }).click();
  await page.getByRole("button", { name: "Left ventricle", exact: true }).click();
  await expect(page.getByRole("region", { name: /Selected structure Left ventricle/ })).toBeVisible();
  await page.getByRole("button", { name: "Isolate Left ventricle" }).click();
  await page.getByRole("button", { name: "Restore all structures" }).click();
  await page.keyboard.press("Escape");
});

test("cutaway, overlay, playback controls and keyboard", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: /^Synthetic 07/ }).click();
  await page.getByRole("radio", { name: "Clinical overlay" }).click();
  await page.waitForTimeout(800);
  await viewport(page).screenshot({ path: `${shots}/e2e-clinical-overlay-syn07.png` });
  await page.getByRole("button", { name: "Cutaway" }).click();
  await page.getByRole("switch", { name: "Cutaway plane" }).click();
  await page.keyboard.press("Escape");
  await page.locator("#view-preset").selectOption("four_chamber");
  await page.getByRole("radio", { name: "Natural tissue" }).click();
  await page.waitForTimeout(1200);
  await viewport(page).screenshot({ path: `${shots}/e2e-cutaway-four-chamber.png` });
  // pause with the keyboard, then jump to end-systole
  await page.getByRole("button", { name: /Pause/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Play/ })).toBeVisible();
  await page.getByRole("button", { name: "End-systole" }).click();
  await expect(page.getByText("Ventricular ejection")).toBeVisible();
  await page.getByRole("combobox", { name: "Slow motion" }).selectOption("0.25");
  await expect(page.getByText(/patient's heart rate \(76 bpm\) is unchanged/)).toBeVisible();
});

test("comparison of two and four records with a difference table", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Compare patients" }).click();
  await expect(page.getByTestId("compare-view")).toHaveCount(2);
  for (const n of ["Synthetic 03", "Synthetic 04"]) await page.getByRole("checkbox", { name: new RegExp(`Compare ${n}`) }).check();
  await expect(page.getByTestId("compare-view")).toHaveCount(4);
  const table = page.getByRole("table", { name: "Difference table" });
  await expect(table.getByText("+24 bpm")).toBeVisible();
  await expect(table.getByText(/Δ not computed/).first()).toBeVisible();
  await page.getByRole("radio", { name: "Real time" }).click();
  await expect(page.getByText(/each heart beats at its own heart rate/i)).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByTestId("compare").screenshot({ path: `${shots}/e2e-compare-four.png` });
});

test("manual entry validates identifiers and saves a record", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "New patient record" }).click();
  await expect(page.getByTestId("save-record")).toBeDisabled();
  await page.getByLabel("patientId *").fill("MAN-001");
  await page.getByLabel("studyId *").fill("MAN-001-A");
  await page.getByLabel("LV ejection fraction (LVEF)").fill("28");
  await page.getByLabel("LV end-diastolic diameter (LVEDD)").fill("6.8");
  await page.getByLabel("LV end-diastolic diameter unit").selectOption("cm");
  await page.getByTestId("save-record").click();
  await page.getByRole("tab", { name: /Visual changes/ }).click();
  await expect(page.getByRole("tabpanel").getByText(/LVEDD 68 mm/)).toBeVisible();
});

test("light theme", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${shots}/e2e-light-theme.png` });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("structure labels: clean image by default, all labels with L", async ({ page }) => {
  await ready(page);
  const shown = () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".structure-label")].filter((el) => el.style.opacity === "1").length);
  await page.waitForTimeout(800);
  expect(await shown()).toBe(0);
  await page.getByTestId("viewport").click({ position: { x: 5, y: 60 } }); // focus the page, not a text field
  await page.keyboard.press("l");
  await expect.poll(shown).toBeGreaterThan(3);
  await page.waitForTimeout(600);
  await viewport(page).screenshot({ path: `${shots}/e2e-labels-on.png` });
  await page.keyboard.press("l");
  await expect.poll(shown).toBe(0);
});
