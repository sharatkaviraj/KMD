import { expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";

const onlyFixtureGet = async (context: BrowserContext) => {
  await context.route("**/*", route => {
    const request = route.request();
    return new URL(request.url()).origin === "http://127.0.0.1:3211" && request.method() === "GET" ? route.continue() : route.abort();
  });
};
const snapshot = (page: Page) => page.evaluate(() => window.moduleContactSnapshot());
const open = async (page: Page) => {
  await page.getByRole("button", { name: "Log family contact", exact: true }).tap();
  const dialog = page.getByRole("dialog", { name: "Log family contact", exact: true });
  await expect(dialog).toBeVisible(); return dialog;
};
const appendLost = async (page: Page, run: string) => {
  await page.goto(`/?lost&run=${run}`, { waitUntil: "domcontentloaded" });
  const dialog = await open(page);
  await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap();
  await dialog.locator("textarea").fill("OPS Synthetic boundary conversation already recorded");
  await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog.getByRole("alert")).toContainText("Could not confirm the result");
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect((await snapshot(page)).records).toHaveLength(1);
  return dialog;
};
const probe = async (page: Page, testInfo: TestInfo, boundary: string) => {
  const before = await snapshot(page);
  expect(before.records).toHaveLength(1); expect(before.calls).toHaveLength(1); expect(before.sends).toBe(0);
  await expect(page.getByText("OPS Synthetic boundary conversation already recorded", { exact: true })).toBeVisible();
  const dialog = await open(page);
  const save = dialog.getByRole("button", { name: "Save", exact: true });
  const warningPresent = await dialog.getByRole("alert").count() > 0;
  // If the boundary retained the existing uncertain instance, Save stays blocked.
  // Otherwise prove the scoped limitation by manually re-entering the same contact.
  if (!warningPresent) {
    await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap();
    await dialog.locator("textarea").fill("OPS Synthetic boundary conversation already recorded");
    await expect(save).toBeEnabled(); await save.tap();
    await expect.poll(async () => (await snapshot(page)).records.length).toBe(2);
    if (new URL(page.url()).searchParams.has("lost")) {
      await expect(dialog.getByRole("alert")).toContainText("Could not confirm the result");
      await expect(save).toBeDisabled();
    } else await expect(dialog).not.toBeVisible();
  } else await expect(save).toBeDisabled();
  const after = await snapshot(page);
  expect(after.sends).toBe(0);
  expect(after.records).toHaveLength(warningPresent ? 1 : 2);
  if (!warningPresent) expect(after.records[0]).toEqual(after.records[1]);
  const finding = { boundary, warningPresent, historyShowsOriginal: true, automaticallyDuplicated: false, manualRepeatedContactDuplicated: !warningPresent, before, after, classification: warningPresent ? "current-instance guard retained" : "limitation reproduced; not product acceptance" };
  await testInfo.attach(`boundary-${boundary}`, { body: JSON.stringify(finding), contentType: "application/json" });
  console.log(`CONTACT_BOUNDARY ${JSON.stringify(finding)}`);
};

test.beforeEach(async ({ page, context }) => { test.setTimeout(35000); await onlyFixtureGet(context); await page.setViewportSize({ width: 390, height: 844 }); });

test("limitation probe: reload after lost contact response", async ({ page }, testInfo) => {
  await appendLost(page, "reload"); await page.reload({ waitUntil: "domcontentloaded" });
  await probe(page, testInfo, "reload");
});
test("limitation probe: browser Back after lost contact response", async ({ page }, testInfo) => {
  const dialog = await appendLost(page, "back");
  await dialog.getByRole("button", { name: "Check contact history", exact: true }).tap();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "OPS other fixture view", exact: true }).tap();
  await page.waitForURL("**/?view=other&run=back", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "OPS Synthetic family-contact test", exact: true })).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" });
  await page.waitForURL("**/?lost&run=back", { waitUntil: "domcontentloaded" });
  await probe(page, testInfo, "back");
});
test("limitation probe: another tab after lost contact response", async ({ page, context }, testInfo) => {
  await appendLost(page, "another-tab");
  const second = await context.newPage(); await second.setViewportSize({ width: 390, height: 844 });
  await second.goto("/?run=another-tab", { waitUntil: "domcontentloaded" }); await probe(second, testInfo, "another-tab");
});
