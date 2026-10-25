import { expect, test, type Page } from "@playwright/test";

async function openLvhOutlook(page: Page) {
  await page.goto("/");
  await page.getByText("Open CT · s0270").first().click();
  await page.getByTestId("outlook-toggle").click();
  await expect(page.getByTestId("heart-outlook")).toBeVisible();
  await page.getByRole("radio", { name: "LVH on treatment" }).click();
  await page.getByRole("slider", { name: "Years from today" }).fill("5");
}

const lvmi = async (page: Page) => {
  const text = await page.getByTestId("outlook-state").nth(1).innerText();
  const m = /LVMI (\d+) g\/m²/.exec(text);
  if (!m) throw new Error(`no LVMI in: ${text}`);
  return Number(m[1]);
};

test("LVH: the losartan button lowers the projected LV mass on the right card, and off returns the natural course", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLvhOutlook(page);

  const natural = await lvmi(page);
  const losartan = page.getByTestId("treatment-lvh-losartan");
  await losartan.click();
  await expect(losartan).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => lvmi(page)).toBeLessThan(natural - 10);

  // switching to the other blood-pressure regimen replaces it (not summed)
  await page.getByTestId("treatment-lvh-atenolol").click();
  await expect(losartan).toHaveAttribute("aria-pressed", "false");

  await page.getByTestId("treatment-lvh-atenolol").click();
  await expect.poll(() => lvmi(page)).toBe(natural);
  expect(errors).toEqual([]);
});

test("LVH: the drug-class and weight-loss buttons each lower the projected LV mass, and two on show the larger one, not the sum", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openLvhOutlook(page);
  const natural = await lvmi(page);

  for (const id of ["lvh-ace", "lvh-ccb", "lvh-diuretic", "lvh-weightloss"]) {
    const button = page.getByTestId(`treatment-${id}`);
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => lvmi(page)).toBeLessThan(natural);
    await button.click();
    await expect.poll(() => lvmi(page)).toBe(natural);
  }

  // a drug (Klingbeil, -10%) and weight loss (-2.9 g) are not added: the larger regression is shown
  await page.getByTestId("treatment-lvh-ace").click();
  await expect.poll(() => lvmi(page)).toBeLessThan(natural - 8);
  const drugOnly = await lvmi(page);
  await page.getByTestId("treatment-lvh-weightloss").click();
  await expect(page.getByTestId("lvh-combination-note")).toBeVisible();
  expect(await lvmi(page)).toBe(drugOnly);
  expect(errors).toEqual([]);
});

test("AS: the valve-replacement buttons replace the stenosis in the projected heart, and off returns the progression", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByText("Open CT · s0270").first().click();
  await page.getByTestId("outlook-toggle").click();
  await expect(page.getByTestId("heart-outlook")).toBeVisible();
  await page.getByRole("slider", { name: "Years from today" }).fill("5");
  const later = () => page.getByTestId("outlook-state").nth(1);
  await expect(later()).not.toContainText("Valve replaced");
  const native = await later().innerText();

  await page.getByTestId("treatment-as-tavr").click();
  await expect(later()).toContainText("Valve replaced");
  await expect(later()).toContainText("AVA 1.72 cm²");
  await expect(page.getByTestId("as-replacement-note")).toBeVisible();

  // surgery is the alternative: it replaces TAVR rather than adding to it
  await page.getByTestId("treatment-as-savr").click();
  await expect(page.getByTestId("treatment-as-tavr")).toHaveAttribute("aria-pressed", "false");
  await expect(later()).toContainText("AVA 1.76 cm²");

  await page.getByTestId("treatment-as-savr").click();
  await expect(later()).not.toContainText("Valve replaced");
  expect(await later().innerText()).toBe(native);
  expect(errors).toEqual([]);
});

test("Uncertainty: a 95 % interval appears for the average effect, and for the spread between patients only when the study reported it", async ({ page }) => {
  await openLvhOutlook(page);
  await expect(page.getByTestId("uncertainty-lvh")).toHaveCount(0); // no button on: nothing to draw
  await page.getByTestId("treatment-lvh-ace").click();
  await expect(page.getByTestId("uncertainty-lvh-average")).toBeVisible();
  await expect(page.getByTestId("uncertainty-lvh-patients")).toHaveCount(0); // Klingbeil reported no SD between patients
  await page.getByTestId("treatment-lvh-losartan").click();
  await expect(page.getByTestId("uncertainty-lvh-patients")).toBeVisible(); // LIFE: SD 21.8 g/m², n = 457
});

test("Uncertainty: the valve-replacement area is shown as the spread between patients", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Open CT · s0270").first().click();
  await page.getByTestId("outlook-toggle").click();
  await page.getByRole("slider", { name: "Years from today" }).fill("5");
  await expect(page.getByTestId("uncertainty-as")).toHaveCount(0);
  await page.getByTestId("treatment-as-tavr").click();
  await expect(page.getByTestId("uncertainty-as-patients")).toBeVisible();
});

test("LVH: the evidence tooltip of any button fits inside the side panel instead of running off its edge", async ({ page }) => {
  await openLvhOutlook(page);
  const panel = (await page.locator("aside[aria-label='Outlook settings and evidence']").boundingBox())!;
  for (const name of ["ACE inhibitor", "Diuretic", "Lower blood pressure"]) {
    await page.getByRole("button", { name: `Evidence for ${name}` }).focus();
    const box = (await page.getByRole("tooltip").filter({ visible: true }).first().boundingBox())!;
    expect(box.x, name).toBeGreaterThanOrEqual(panel.x - 1);
    expect(box.x + box.width, name).toBeLessThanOrEqual(panel.x + panel.width + 1);
  }
});

test("LVH: the evidence for a button sits behind its info tip", async ({ page }) => {
  await openLvhOutlook(page);
  const tip = page.getByRole("button", { name: "Evidence for Losartan-based regimen" });
  await tip.focus();
  await expect(page.getByRole("tooltip").filter({ hasText: "LIFE echo substudy" })).toBeVisible();
});

test("LVH: the assistant's proposal becomes a button that moves the model, and an unconfigured server keeps the buttons", async ({ page }) => {
  await openLvhOutlook(page);
  await page.route("**/api/treatments/explain", (route) =>
    route.fulfill({ json: { ok: true, answer: "Losartan regressed LV mass more than atenolol [1].", sources: [{ id: "life", cite: "Devereux 2004", title: "LIFE echo substudy", journal: "Circulation", doi: "10.1161/01.CIR.0000145613.16787.0A", studyType: "RCT" }], note: "Explains the cited studies only." } }));
  await page.route("**/api/treatments", (route) =>
    route.fulfill({ json: { ok: true, proposals: [{ id: "lvh-losartan", reason: "Regresses mass more than atenolol." }], note: "Clinician decision support, not a diagnosis." } }));
  const natural = await lvmi(page);
  const input = page.getByLabel("Question about the selected record");
  await input.fill("What should I consider?");
  await input.press("Enter");
  await expect(page.getByTestId("treatment-explanation")).toContainText("Losartan");
  const proposal = page.getByTestId("proposal-lvh-losartan");
  await expect(proposal).toBeVisible();
  // the label stays on one line in the narrow side panel (it used to wrap and overlap its neighbours)
  expect((await proposal.boundingBox())!.height).toBeLessThan(40);
  await proposal.click();
  await expect(page.getByTestId("treatment-lvh-losartan")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => lvmi(page)).toBeLessThan(natural - 10);

  for (const url of ["**/api/treatments/explain", "**/api/treatments"]) {
    await page.unroute(url);
    await page.route(url, (route) => route.fulfill({ status: 503, json: { ok: false, code: "not_configured" } }));
  }
  await input.fill("And now?");
  await input.press("Enter");
  await expect(page.getByRole("log")).toContainText("not available on this server");
  await expect(page.getByTestId("treatment-lvh-atenolol")).toBeVisible();
});
