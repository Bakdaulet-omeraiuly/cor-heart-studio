import { expect, test, type Page, type Route } from "@playwright/test";

// Assistant chat panel (Requirements 12.2, 12.3). `/api/assistant` is intercepted in the browser with canned
// responses shaped like the route's `AssistantResponse`, so these tests need no API key and no network.

const DISCLAIMER = "Not a diagnosis — decision support for clinicians";
const WITHHELD = "Generated answer withheld — showing the engine result.";
const ENGINE_DISCLAIMER = "Synthetic demo data. Not a medical device; not a diagnosis.";
const RED_FLAG_TEXT = "Severe aortic stenosis with reported symptoms: urgent specialist (heart valve team) review.";

const assessment = {
  findings: [
    {
      id: "F1",
      condition: "aortic-stenosis",
      label: "Aortic stenosis, severe",
      grade: "severe",
      basis: "rule-defined",
      organ: "heart",
      target: "aortic_valve",
      evidence: [
        { id: "E1", field: "valves.aortic.peakVelocity", value: 4.3, unit: "m/s", rule: "R-VALVE-STEN-01", source: "ESC/EACTS 2021" },
        { id: "E2", field: "valves.aortic.meanGradient", value: 46, unit: "mmHg", rule: "R-VALVE-STEN-01", source: "ESC/EACTS 2021" },
      ],
    },
  ],
  differential: [],
  missing: [{ id: "M1", field: "valves.aortic.area", why: "Valve area confirms the grade when velocity and gradient disagree." }],
  redFlags: [{ id: "R1", text: RED_FLAG_TEXT }],
  disclaimer: ENGINE_DISCLAIMER,
};

const refs = {
  F1: { id: "F1", kind: "finding", label: "Aortic stenosis, severe", organ: "heart", target: "aortic_valve" },
  E1: { id: "E1", kind: "evidence", label: "Aortic stenosis, severe", field: "valves.aortic.peakVelocity", value: 4.3, unit: "m/s", rule: "R-VALVE-STEN-01", source: "ESC/EACTS 2021", organ: "heart", target: "aortic_valve" },
  E2: { id: "E2", kind: "evidence", label: "Aortic stenosis, severe", field: "valves.aortic.meanGradient", value: 46, unit: "mmHg", rule: "R-VALVE-STEN-01", source: "ESC/EACTS 2021", organ: "heart", target: "aortic_valve" },
  M1: { id: "M1", kind: "missing", label: "Missing data", field: "valves.aortic.area", why: "Valve area confirms the grade when velocity and gradient disagree." },
  R1: { id: "R1", kind: "redFlag", label: "Red flag", text: RED_FLAG_TEXT },
};

const okReply = {
  status: "ok",
  text: "The aortic stenosis is graded severe by rule [F1]: peak velocity is 4.3 m/s [E1] and the mean gradient is 46 mmHg [E2].",
  assessment,
  refs,
  disclaimer: ENGINE_DISCLAIMER,
};

const fallbackReply = {
  status: "fallback",
  text: `F1 Aortic stenosis, severe (rule-defined) — E1 peak velocity 4.3 m/s · E2 mean gradient 46 mmHg.\nMissing: M1 valves.aortic.area.\nR1 ${RED_FLAG_TEXT}`,
  assessment,
  refs,
  disclaimer: ENGINE_DISCLAIMER,
};

const errorReply = { status: "error", code: "model_error", message: "The assistant could not answer. Please retry." };

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });

/** Open the app, select Synthetic 04 (aortic stenosis) and wait until the 3D view renders. */
async function ready(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /^Synthetic 04/ }).click();
  const vp = page.getByTestId("viewport");
  await expect.poll(async () => Number(await vp.locator("[data-frames]").getAttribute("data-frames").catch(() => "0")), { timeout: 30_000 }).toBeGreaterThan(60);
  return page.getByTestId("assistant-panel");
}

async function ask(page: Page, question: string) {
  const panel = page.getByTestId("assistant-panel");
  await panel.getByLabel("Question about the selected record").fill(question);
  await panel.getByRole("button", { name: "Send" }).click();
}

test("disclaimer is always visible and the input is enabled for a selected record", async ({ page }) => {
  const panel = await ready(page);
  await expect(panel.getByTestId("assistant-disclaimer")).toHaveText(DISCLAIMER);
  await expect(panel.getByLabel("Question about the selected record")).toBeEnabled();
  // collapsing the panel hides the conversation but never the disclaimer
  await panel.getByRole("button", { name: "Collapse assistant" }).click();
  await expect(panel.getByLabel("Question about the selected record")).toBeHidden();
  await expect(panel.getByTestId("assistant-disclaimer")).toBeVisible();
  await panel.getByRole("button", { name: "Expand assistant" }).click();
  await expect(panel.getByLabel("Question about the selected record")).toBeVisible();
});

test("a reply with cited ids; activating an id selects the structure in the inspector", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/assistant", async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await json(route, 200, okReply);
  });
  const panel = await ready(page);

  await ask(page, "Why is the aortic stenosis graded severe?");
  const log = panel.getByRole("log", { name: "Assistant conversation" });
  await expect(log).toContainText("graded severe by rule");
  await expect(log).toContainText(ENGINE_DISCLAIMER);
  expect(bodies).toHaveLength(1);
  expect(bodies[0].question).toBe("Why is the aortic stenosis graded severe?");
  expect(bodies[0].record).toBeTruthy();

  // the evidence is shown on focus, without activating the id
  const e1 = log.getByRole("button", { name: "Evidence E1" });
  await e1.focus();
  await expect(log.getByRole("tooltip").filter({ hasText: "valves.aortic.peakVelocity = 4.3 m/s" })).toBeVisible();

  // keyboard activation of the finding id moves the 3D view to the aortic valve
  const f1 = log.getByRole("button", { name: "Finding F1" });
  await f1.focus();
  await page.keyboard.press("Enter");
  await expect(f1).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Selected structure Aortic valve" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a fallback response shows the engine list and the withheld note", async ({ page }) => {
  await page.route("**/api/assistant", (route) => json(route, 200, fallbackReply));
  const panel = await ready(page);

  await ask(page, "Summarise the findings.");
  const log = panel.getByRole("log", { name: "Assistant conversation" });
  await expect(log.getByText(WITHHELD)).toBeVisible();
  // finding row: id button, label and basis (tooltips repeat the label, so check the row, not the text alone)
  const finding = log.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Finding F1" }) });
  await expect(finding).toContainText("Aortic stenosis, severe");
  await expect(finding.getByText("(rule-defined)", { exact: true })).toBeVisible();
  // each id button is separated from its label by a space (rendered text, tooltips are hidden)
  await expect(finding).toContainText("F1 Aortic stenosis, severe (rule-defined)", { useInnerText: true });
  await expect(log.getByRole("button", { name: "Evidence E1" })).toBeVisible();
  await expect(log.getByText("= 4.3 m/s", { exact: true })).toBeVisible();
  // missing item: M# button with field · why on focus; activating it only highlights it (no 3D selection)
  const missing = log.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Missing data M1" }) });
  // the tooltip repeats the field, so check the row's visible text, not the text alone
  await expect(missing).toBeVisible();
  await expect(missing).toContainText("valves.aortic.area");
  await expect(missing).toContainText("M1 valves.aortic.area", { useInnerText: true });
  // red flag: R# button with the flag text on focus, a space before the label
  const redFlag = log.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Red flag R1" }) });
  await expect(redFlag).toContainText(`R1 ${RED_FLAG_TEXT}`, { useInnerText: true });
  await log.getByRole("button", { name: "Red flag R1" }).focus();
  await expect(log.getByRole("tooltip").filter({ hasText: RED_FLAG_TEXT })).toBeVisible();
  const m1 = log.getByRole("button", { name: "Missing data M1" });
  await m1.focus();
  await expect(log.getByRole("tooltip").filter({ hasText: "Valve area confirms the grade" })).toBeVisible();
  const selected = page.getByRole("region", { name: /^Selected structure/ });
  const selectedBefore = await selected.count();
  await page.keyboard.press("Enter");
  await expect(m1).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("region", { name: "Selected structure Aortic valve" })).toHaveCount(0);
  expect(await selected.count()).toBe(selectedBefore);
});

test("an error shows one line with Retry, and retry gets the answer", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/assistant", (route) => (++calls === 1 ? json(route, 502, errorReply) : json(route, 200, okReply)));
  const panel = await ready(page);

  await ask(page, "Why is the aortic stenosis graded severe?");
  const log = panel.getByRole("log", { name: "Assistant conversation" });
  await expect(log.getByText(errorReply.message)).toBeVisible();
  const retry = log.getByRole("button", { name: "Retry" });
  await expect(retry).toBeEnabled();
  await retry.click();

  await expect(log).toContainText("graded severe by rule");
  await expect(log.getByText(errorReply.message)).toHaveCount(0);
  await expect(log.getByRole("button", { name: "Retry" })).toHaveCount(0);
  // the failed turn is replaced, not duplicated
  await expect(log.getByText("Why is the aortic stenosis graded severe?")).toHaveCount(1);
  expect(calls).toBe(2);
});
