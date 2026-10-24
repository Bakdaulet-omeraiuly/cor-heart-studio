import { expect, test } from "@playwright/test";
import path from "node:path";

const shots = path.resolve(__dirname, "../../docs/visual-review");

test("outlook: opens and closes, projects the brain with published rates", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("tab", { name: "Brain" }).click();
  await expect(page.getByTestId("brain-workspace")).toBeVisible({ timeout: 30_000 });

  const toggle = page.getByTestId("outlook-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  const panel = page.getByTestId("brain-outlook");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Barnes 2009");
  await expect(page.getByTestId("outlook-caveat")).toContainText("not a forecast");
  // the MRI column gives way to the outlook panel
  await expect(page.getByTestId("slice-axial")).toHaveCount(0);

  const table = page.getByTestId("brain-outlook-table");
  await page.getByRole("slider", { name: "Years from today" }).fill("10");
  await expect(page.getByTestId("outlook-years")).toHaveText("+10 years");
  // Alzheimer's at the average pace: hippocampi −4.66 %/y compounded over 10 years ≈ −37.9 %
  await expect(table).toContainText("-37.9 %");
  await page.waitForTimeout(1200);
  await page.getByTestId("brain-workspace").screenshot({ path: `${shots}/e2e-outlook-brain-ad-10y.png` });

  await page.getByRole("radio", { name: "Typical ageing" }).click();
  await expect(table).toContainText("-13.2 %"); // −1.41 %/y over 10 years
  await page.waitForTimeout(800);
  await page.getByTestId("brain-workspace").screenshot({ path: `${shots}/e2e-outlook-brain-aging-10y.png` });

  await toggle.click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId("slice-axial")).toBeVisible();
  expect(errors).toEqual([]);
});

test("outlook: aortic stenosis today vs projected, from the record's own numbers", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByText("Synthetic 04 · Aortic valve stenosis").first().click();
  await page.getByTestId("outlook-toggle").click();
  const view = page.getByTestId("heart-outlook");
  await expect(view).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Valve area today" })).toHaveValue("0.8");
  await expect(view).toContainText("from record");

  // a moderate valve typed in becomes severe after 5 years at the Otto 1997 average
  await page.getByRole("spinbutton", { name: "Valve area today" }).fill("1.3");
  await page.getByRole("spinbutton", { name: "Peak velocity today" }).fill("3.2");
  await page.getByRole("slider", { name: "Years from today" }).fill("5");
  const states = page.getByTestId("outlook-state");
  await expect(states.nth(0)).toContainText("moderate stenosis");
  await expect(states.nth(1)).toContainText("severe stenosis");
  await expect(states.nth(1)).toContainText("AVA 0.70 cm²");
  await expect(page.getByTestId("compare-view")).toHaveCount(2);
  await view.getByRole("button", { name: "Aortic valve", exact: true }).click();
  await expect(view.getByRole("button", { name: "X-ray", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(1500);
  await view.screenshot({ path: `${shots}/e2e-outlook-heart-as-5y.png` });

  await page.getByTestId("outlook-toggle").click();
  await expect(view).toHaveCount(0);
  await expect(page.getByTestId("viewport")).toBeVisible();
  expect(errors).toEqual([]);
});

test("outlook: hypertensive LVH regresses on treatment, walls drawn through the thickness rule", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByText("Synthetic 03 · Concentric wall thickening").first().click();
  await page.getByTestId("outlook-toggle").click();
  const view = page.getByTestId("heart-outlook");
  await view.getByRole("radio", { name: "LVH on treatment" }).click();
  await expect(page.getByRole("spinbutton", { name: "IVSd today" })).toHaveValue("15");
  await expect(view).toContainText("from record");
  await expect(view).toContainText("LIFE · Devereux 2004");

  await page.getByRole("slider", { name: "Years from today" }).fill("5");
  const states = page.getByTestId("outlook-state");
  // LIFE losartan arm: −21.7 g/m² reached at 4.8 years, held after
  await expect(states.nth(1)).toContainText("-21.7");
  await view.getByRole("radio", { name: "Atenolol-based" }).click();
  await expect(states.nth(1)).toContainText("-17.7");
  await page.waitForTimeout(1500);
  await view.screenshot({ path: `${shots}/e2e-outlook-heart-lvh-5y.png` });
  expect(errors).toEqual([]);
});
