import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const request = route.request();
    const url = new URL(request.url());
    // Local fixture assets are GET-only; even a localhost POST must be rejected.
    return url.origin === "http://127.0.0.1:3211" && request.method() === "GET" ? route.continue() : route.abort();
  });
});
const snapshot = (page: Page) => page.evaluate(() => window.moduleContactSnapshot());
const open = async (page: Page) => {
  await page.getByRole("button", { name: "Log family contact", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Log family contact", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
};

test("360px read-only family contact has no write affordance or action", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/?readonly");
  await expect(page.getByText("None recorded this year")).toBeVisible();
  await expect(page.getByRole("button", { name: "Log family contact", exact: true })).toHaveCount(0);
  expect(await snapshot(page)).toEqual({ calls: [], records: [], sends: 0, refreshes: 0 });
});

test("390px missing follow-up date keeps note and has no append or send", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "Follow-up agreed", exact: true }).tap();
  await dialog.locator("textarea").fill("OPS Synthetic agreed discussion; date not chosen");
  await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog.getByRole("alert")).toContainText("Choose the date that was agreed.");
  await expect(dialog.locator("textarea")).toHaveValue("OPS Synthetic agreed discussion; date not chosen");
  expect(await snapshot(page)).toMatchObject({ records: [], sends: 0, refreshes: 0 });
});

test("412px recorded conversation appends once and sends nothing", async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto("/");
  const dialog = await open(page);
  await expect(dialog.getByText("Record what happened. This does not send any message.")).toBeVisible();
  await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap();
  await dialog.locator("textarea").fill("  OPS Synthetic conversation already happened  ");
  await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog).not.toBeVisible();
  expect(await snapshot(page)).toMatchObject({ records: [{ outcome: "spoke", note: "OPS Synthetic conversation already happened", agreedOn: null }], sends: 0, refreshes: 1 });
  expect((await snapshot(page)).records).toHaveLength(1);
});

const interruptedViewport = process.env.PHONEOPS_CONTACT_PORTRAIT === "1" ? { width: 390, height: 844 } : { width: 844, height: 390 };
test(`${interruptedViewport.width}x${interruptedViewport.height} interrupted contact response keeps entry and reports uncertainty without retry`, async ({ page }, testInfo) => {
  await page.setViewportSize(interruptedViewport);
  await page.goto("/?lost");
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap();
  await dialog.locator("textarea").fill("OPS Synthetic interrupted contact response");
  await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect.poll(async () => (await snapshot(page)).records.length).toBe(1);
  await expect(dialog.getByRole("alert")).toContainText(/could not confirm|may have been saved/i);
  const ledger = await snapshot(page);
  await testInfo.attach("contact-ledger-after-lost-response", { body: JSON.stringify(ledger), contentType: "application/json" });
  expect(ledger).toMatchObject({ sends: 0, refreshes: 0 });
  expect(ledger.calls).toHaveLength(1);
  expect(ledger.records).toHaveLength(1);
  // A lost response is uncertain; no blind retry is allowed for an append-only contact.
  await expect(page.getByTestId("contact-boundary")).toHaveCount(0);
  await expect(dialog).toBeVisible({ timeout: 2000 });
  await expect(dialog.locator("textarea")).toHaveValue("OPS Synthetic interrupted contact response");
  await expect(dialog.getByRole("alert")).toContainText(/could not confirm|may have been saved/i);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close", exact: true }).tap();
  const reopened = await open(page);
  await expect(reopened.locator("textarea")).toHaveValue("OPS Synthetic interrupted contact response");
  await expect(reopened.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await reopened.getByRole("button", { name: "Check contact history", exact: true }).tap();
  await expect(reopened).not.toBeVisible();
  expect(await snapshot(page)).toMatchObject({ calls: ledger.calls, records: ledger.records, sends: 0, refreshes: 1 });
  const checked = await open(page);
  await expect(checked.locator("textarea")).toHaveValue("OPS Synthetic interrupted contact response");
  await expect(checked.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect((await snapshot(page)).records).toHaveLength(1);
});
