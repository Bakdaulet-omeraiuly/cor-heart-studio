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
