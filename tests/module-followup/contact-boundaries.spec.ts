import { expect, test, type Locator, type Page } from "@playwright/test";
const snapshot = (page: Page) => page.evaluate(() => window.moduleContactSnapshot());
const open = async (page: Page) => { await page.getByRole("button", { name: "Log family contact", exact: true }).tap(); const dialog = page.getByRole("dialog", { name: "Log family contact", exact: true }); await expect(dialog).toBeVisible(); return dialog; };
async function touchTarget(button: Locator) {
  await button.scrollIntoViewIfNeeded();
  const geometry = await button.evaluate(element => { const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { width: rect.width, height: rect.height, owns: hit === element || element.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth }; });
  expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44); expect(geometry.owns).toBe(true); expect(geometry.overflow).toBe(false);
  await button.tap();
}
test.beforeEach(async ({ page, context }) => {
  test.setTimeout(60000); await page.setViewportSize({ width: 390, height: 844 });
  await context.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:3211" && route.request().method() === "GET" ? route.continue() : route.abort());
});
async function appendLost(page: Page, run: string) {
  await page.goto(`/?lost&run=${run}`, { waitUntil: "domcontentloaded" }); const dialog = await open(page);
  await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap();
  await dialog.locator("textarea").fill("OPS Synthetic original conversation");
  await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog.getByRole("alert")).toContainText("Could not confirm the result");
  const ledger = await snapshot(page); expect(ledger.records).toHaveLength(1); expect(ledger.calls).toHaveLength(1);
  return { dialog, command: ledger.records[0] };
}
async function verifyRecovered(page: Page, command: Awaited<ReturnType<typeof snapshot>>["records"][number]) {
  await expect(page.getByText("OPS Synthetic original conversation", { exact: true })).toBeVisible();
  const dialog = await open(page);
  await expect(dialog.getByRole("status")).toContainText("original contact is pending verification");
  await expect(dialog.locator("textarea")).toHaveValue(command.note!); await expect(dialog.locator("textarea")).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  const check = dialog.getByRole("button", { name: "Check original result", exact: true }); await check.scrollIntoViewIfNeeded();
  const geometry = await check.evaluate(button => { const rect = button.getBoundingClientRect(); const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2); return { width: rect.width, height: rect.height, owns: hit === button || button.contains(hit), overflow: document.documentElement.scrollWidth > innerWidth }; });
  expect(geometry.width).toBeGreaterThanOrEqual(44); expect(geometry.height).toBeGreaterThanOrEqual(44); expect(geometry.owns).toBe(true); expect(geometry.overflow).toBe(false);
  await check.tap(); await expect(dialog).not.toBeVisible();
  const ledger = await snapshot(page); expect(ledger.records).toEqual([command]); expect(ledger.calls).toEqual([command]); expect(ledger.checks).toEqual([command]); expect(ledger.sends).toBe(0);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("vx-contact:v1:")))).toEqual([]);
}
test("durable recovery: reload verifies the original contact without a duplicate", async ({ page }) => {
  const { command } = await appendLost(page, "reload"); await page.reload({ waitUntil: "domcontentloaded" }); await verifyRecovered(page, command);
});
test("durable recovery: browser Back verifies the original contact without a duplicate", async ({ page }) => {
  const { dialog, command } = await appendLost(page, "back"); await dialog.getByRole("button", { name: "Check contact history", exact: true }).tap();
  await page.getByRole("link", { name: "OPS other fixture view", exact: true }).tap();
  await page.waitForURL("**/?view=other&run=back", { waitUntil: "domcontentloaded" }); await expect(page.getByRole("heading")).toBeVisible();
  await page.goBack({ waitUntil: "domcontentloaded" }); await page.waitForURL("**/?lost&run=back", { waitUntil: "domcontentloaded" }); await verifyRecovered(page, command);
});
test("durable recovery: second tab verifies the original contact without a duplicate", async ({ page, context }) => {
  const { command } = await appendLost(page, "tab"); const second = await context.newPage(); await second.setViewportSize({ width: 390, height: 844 });
  await second.goto("/?run=tab", { waitUntil: "domcontentloaded" }); await verifyRecovered(second, command);
  await expect(page.getByRole("dialog").getByRole("button", { name: "Check original result", exact: true })).toHaveCount(0);
});
test("durable recovery: offline original retries the same ID after a missing readback", async ({ page, context }) => {
  await page.goto("/?run=offline", { waitUntil: "domcontentloaded" }); const dialog = await open(page);
  await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS offline conversation");
  await context.setOffline(true); await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog.getByRole("alert")).toContainText("Could not confirm"); expect((await snapshot(page)).records).toHaveLength(0);
  const original = (await snapshot(page)).calls[0]; await context.setOffline(false);
  await dialog.getByRole("button", { name: "Check original result", exact: true }).tap(); await expect(dialog.getByRole("button", { name: "Retry same contact", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry same contact", exact: true }).tap(); await expect(dialog).not.toBeVisible();
  const ledger = await snapshot(page); expect(ledger.calls).toEqual([original, original]); expect(ledger.records).toEqual([original]); expect(ledger.checks).toEqual([original]); expect(ledger.sends).toBe(0);
});
test("durable recovery: failed storage reservation sends no contact", async ({ page }) => {
  await page.goto("/?run=storage", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith("vx-contact:")) throw Error("Synthetic quota"); original.call(this, key, value); }; });
  const dialog = await open(page); await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS storage blocked");
  await dialog.getByRole("button", { name: "Save", exact: true }).tap(); await expect(dialog.getByRole("alert")).toContainText("recovery could not be stored");
  expect((await snapshot(page)).calls).toEqual([]); expect((await snapshot(page)).records).toEqual([]);
});
test("durable recovery: two identical separate contacts receive fresh IDs", async ({ page }) => {
  await page.goto("/?run=separate", { waitUntil: "domcontentloaded" });
  for (let index = 0; index < 2; index++) { const dialog = await open(page); await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS same conversation text deliberately separate"); await dialog.getByRole("button", { name: "Save", exact: true }).tap(); await expect(dialog).not.toBeVisible(); }
  const ledger = await snapshot(page); expect(ledger.records).toHaveLength(2); expect(new Set(ledger.records.map(row => row.attemptId)).size).toBe(2); expect(ledger.records[0].note).toBe(ledger.records[1].note); expect(ledger.sends).toBe(0);
});
test("durable recovery: failed clear keeps confirmed original and blocks new contact", async ({ page }) => {
  await page.goto("/?run=clear", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { const original = Storage.prototype.removeItem; (window as unknown as Window & { restoreRemoval: () => void }).restoreRemoval = () => { Storage.prototype.removeItem = original; }; Storage.prototype.removeItem = function(key) { if (key.startsWith("vx-contact:")) throw Error("Synthetic clear denied"); original.call(this, key); }; });
  const dialog = await open(page); await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS clear-failed contact"); await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await expect(dialog.getByRole("alert")).toContainText("Contact confirmed"); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled(); const original = (await snapshot(page)).records[0];
  await page.evaluate(() => (window as unknown as Window & { restoreRemoval: () => void }).restoreRemoval()); await dialog.getByRole("button", { name: "Check original result", exact: true }).tap(); await expect(dialog).not.toBeVisible();
  const ledger = await snapshot(page); expect(ledger.calls).toEqual([original]); expect(ledger.records).toEqual([original]); expect(ledger.checks).toEqual([original]);
});
for (const query of ["legacy", "preview"]) test(`durable recovery: ${query} context cannot submit`, async ({ page }) => {
  await page.goto(`/?${query}&run=${query}`, { waitUntil: "domcontentloaded" }); const dialog = await open(page); await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS nonwritable context"); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled(); expect((await snapshot(page)).calls).toEqual([]);
});
test("durable recovery: queued lock rechecks preview context before sending", async ({ page }) => {
  await page.goto("/?run=lock-switch", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { const scope = "vx-contact:v1:00000000-0000-4000-8000-000000000002:OPS-FOLLOWUP-2026-27:00000000-0000-4000-8000-000000000001"; const qa = window as unknown as Window & { releaseLock: () => void; holdingLock: boolean }; qa.holdingLock = false; void navigator.locks.request(`vx-contact-lock:${scope}`, () => new Promise<void>(resolve => { qa.releaseLock = resolve; qa.holdingLock = true; })); });
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { holdingLock: boolean }).holdingLock)).toBe(true);
  const dialog = await open(page); await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS queued original"); await dialog.getByRole("button", { name: "Save", exact: true }).tap();
  await page.evaluate(() => { history.replaceState(null, "", "/?run=lock-switch&preview"); window.dispatchEvent(new Event("qa:refresh")); }); await expect(dialog.getByRole("button", { name: /^Sav/ })).toBeDisabled();
  await page.evaluate(() => (window as unknown as Window & { releaseLock: () => void }).releaseLock()); await expect(dialog.getByRole("button", { name: "Save", exact: true })).toHaveText("Save"); expect((await snapshot(page)).calls).toEqual([]); expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("vx-contact:")))).toEqual([]);
});
test("durable recovery: two tabs queue different drafts but reserve only one original", async ({ page, context }) => {
  await page.goto("/?run=concurrent&lost", { waitUntil: "domcontentloaded" }); const second = await context.newPage(); await second.setViewportSize({ width: 390, height: 844 }); await second.goto("/?run=concurrent&lost", { waitUntil: "domcontentloaded" });
  const dialogs = [await open(page), await open(second)];
  for (const [index, dialog] of dialogs.entries()) { await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill(`OPS concurrent draft ${index}`); }
  await page.evaluate(() => { const qa = window as unknown as Window & { releaseLock: () => void; holdingLock: boolean }; qa.holdingLock = false; void navigator.locks.request("vx-contact-lock:vx-contact:v1:00000000-0000-4000-8000-000000000002:OPS-FOLLOWUP-2026-27:00000000-0000-4000-8000-000000000001", () => new Promise<void>(resolve => { qa.releaseLock = resolve; qa.holdingLock = true; })); });
  await expect.poll(() => page.evaluate(() => (window as unknown as Window & { holdingLock: boolean }).holdingLock)).toBe(true);
  await Promise.all(dialogs.map(dialog => dialog.getByRole("button", { name: "Save", exact: true }).tap()));
  await page.evaluate(() => (window as unknown as Window & { releaseLock: () => void }).releaseLock());
  await expect.poll(async () => (await snapshot(page)).calls.length).toBe(1); await expect.poll(async () => (await snapshot(page)).records.length).toBe(1);
  for (const dialog of dialogs) { await expect(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled(); await expect(dialog.getByRole("button", { name: "Check original result", exact: true })).toBeVisible(); }
  expect((await snapshot(page)).calls[0]).toEqual((await snapshot(second)).records[0]);
  const perDocument = await Promise.all([page, second].map(tab => tab.evaluate(() => window.moduleContactDocumentCalls())));
  expect(perDocument.map(calls => calls.length).sort()).toEqual([0, 1]);
  const sent = perDocument.flat()[0];
  for (const tab of [page, second]) {
    const copies = await tab.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("vx-contact:v1:")).map(key => JSON.parse(localStorage.getItem(key)!).payload));
    expect(copies).toEqual([sent]);
  }
});
for (const [width, height] of [[360, 800], [390, 844], [412, 915], [844, 390]]) test(`durable recovery: original readback remains touch-reachable at ${width}x${height}`, async ({ page, context }) => {
  await page.setViewportSize({ width, height }); const { command } = await appendLost(page, `layout-${width}`); await page.reload({ waitUntil: "domcontentloaded" }); await verifyRecovered(page, command);
  await page.goto(`/?run=retry-layout-${width}`, { waitUntil: "domcontentloaded" });
  await touchTarget(page.getByRole("button", { name: "Log family contact", exact: true })); const dialog = page.getByRole("dialog", { name: "Log family contact", exact: true });
  await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS responsive missing contact");
  await context.setOffline(true); await touchTarget(dialog.getByRole("button", { name: "Save", exact: true })); await expect(dialog.getByRole("alert")).toContainText("Could not confirm");
  const retryCommand = (await snapshot(page)).calls[0]; await context.setOffline(false);
  await touchTarget(dialog.getByRole("button", { name: "Check original result", exact: true }));
  await touchTarget(dialog.getByRole("button", { name: "Retry same contact", exact: true })); await expect(dialog).not.toBeVisible();
  const ledger = await snapshot(page); expect(ledger.calls).toEqual([retryCommand, retryCommand]); expect(ledger.records).toEqual([retryCommand]); expect(ledger.sends).toBe(0);
});
for (const kind of ["save", "check"] as const) test(`durable recovery: late ${kind} response cannot clear an original after preview switch`, async ({ page }) => {
  await page.goto(`/?run=late-${kind}`, { waitUntil: "domcontentloaded" });
  const dialog = await open(page); await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS held response");
  await page.evaluate(() => window.holdContactResult("save")); await dialog.getByRole("button", { name: "Save", exact: true }).tap(); await expect.poll(() => page.evaluate(() => window.contactResultEntered("save"))).toBe(true);
  if (kind === "check") {
    // An actual lost response leaves the immutable command available to Check.
    await page.evaluate(() => { history.replaceState(null, "", "/?run=late-check&lost"); window.releaseContactResult("save"); });
    await expect(dialog.getByRole("alert")).toContainText("Could not confirm"); await page.evaluate(() => window.holdContactResult("check"));
    await dialog.getByRole("button", { name: "Check original result", exact: true }).tap(); await expect.poll(() => page.evaluate(() => window.contactResultEntered("check"))).toBe(true);
  }
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set("preview", ""); history.replaceState(null, "", url); window.dispatchEvent(new Event("qa:refresh")); });
  await expect(dialog.getByRole("button", { name: "Check original result", exact: true })).toBeDisabled();
  await page.evaluate(value => window.releaseContactResult(value), kind);
  await expect(dialog.getByRole("button", { name: "Save", exact: true })).toHaveText("Save");
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("vx-contact:v1:")))).toHaveLength(1); expect((await snapshot(page)).records).toHaveLength(1); expect((await snapshot(page)).calls).toHaveLength(1);
  await expect(page.getByText("Family contact recorded", { exact: true })).toHaveCount(0);
});
for (const [field, value] of [["owner", "00000000-0000-4000-8000-000000000099"], ["session", "OPS-OTHER"], ["student", "00000000-0000-4000-8000-000000000099"]]) test(`durable recovery: late save retains original across ${field} switch`, async ({ page }) => {
  await page.goto(`/?run=scope-${field}`, { waitUntil: "domcontentloaded" }); const dialog = await open(page);
  await dialog.getByRole("button", { name: "Spoke with family", exact: true }).tap(); await dialog.locator("textarea").fill("OPS Synthetic original conversation");
  await page.evaluate(() => window.holdContactResult("save")); await dialog.getByRole("button", { name: "Save", exact: true }).tap(); await expect.poll(() => page.evaluate(() => window.contactResultEntered("save"))).toBe(true);
  const original = (await snapshot(page)).records[0];
  await page.evaluate(([key, next]) => { const url = new URL(location.href); url.searchParams.set(key, next); history.replaceState(null, "", url); window.dispatchEvent(new Event("qa:refresh")); }, [field, value]);
  await expect(dialog).not.toBeVisible(); await page.evaluate(() => window.releaseContactResult("save"));
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("vx-contact:v1:")))).toHaveLength(1); await expect(page.getByText("Family contact recorded", { exact: true })).toHaveCount(0);
  await page.evaluate(key => { const url = new URL(location.href); url.searchParams.delete(key); history.replaceState(null, "", url); window.dispatchEvent(new Event("qa:refresh")); }, field);
  await verifyRecovered(page, original);
});
