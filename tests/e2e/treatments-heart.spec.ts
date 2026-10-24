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

test("LVH: the evidence for a button sits behind its info tip", async ({ page }) => {
  await openLvhOutlook(page);
  const tip = page.getByRole("button", { name: "Evidence for Losartan-based regimen" });
  await tip.focus();
  await expect(page.getByRole("tooltip").filter({ hasText: "LIFE echo substudy" })).toBeVisible();
});

test("LVH: a chat proposal becomes a button that moves the model, and an unconfigured server hides the chat", async ({ page }) => {
  await openLvhOutlook(page);
  await page.route("**/api/treatments", (route) =>
    route.fulfill({ json: { ok: true, proposals: [{ id: "lvh-losartan", reason: "Regresses mass more than atenolol." }], note: "Clinician decision support, not a diagnosis." } }));
  const natural = await lvmi(page);
  await page.getByLabel("Ask the assistant which treatments to consider").fill("What should I consider?");
  await page.getByRole("button", { name: "Ask" }).click();
  const proposal = page.getByTestId("proposal-lvh-losartan");
  await expect(proposal).toBeVisible();
  await proposal.click();
  await expect(page.getByTestId("treatment-lvh-losartan")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => lvmi(page)).toBeLessThan(natural - 10);

  await page.unroute("**/api/treatments");
  await page.route("**/api/treatments", (route) => route.fulfill({ status: 503, json: { ok: false, code: "not_configured" } }));
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.getByTestId("treatment-chat-unavailable")).toBeVisible();
  await expect(page.getByTestId("treatment-lvh-atenolol")).toBeVisible();
});
