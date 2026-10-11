import { expect, test } from "@playwright/test";

for (const noRoll of [false, true]) {
  test(`same-name children have distinct accessible mark labels${noRoll ? " without roll numbers" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?duplicateNames=1${noRoll ? "&noRoll=1" : ""}`);
    const repeated = page.getByRole("textbox", { name: /^Synthetic repeated name/ });
    await expect(repeated).toHaveCount(2);
    const labels = await repeated.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")!));
    expect(new Set(labels).size).toBe(2);
    await page.getByRole("textbox", { name: labels[0], exact: true }).fill("7");
    const second = page.getByRole("textbox", { name: labels[1], exact: true });
    await expect(second).toBeEnabled(); await second.fill("8");
    await expect.poll(async () => page.evaluate(() => {
      const cells = JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).cells;
      return [cells["00000000-0000-4000-8000-000000000001"]?.value, cells["00000000-0000-4000-8000-000000000002"]?.value];
    })).toEqual([7, 8]);
  });
}

for (const width of [360, 390, 412]) {
  test(`exemption can be entered and cleared by touch at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?mode=pad");
    expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);
    const exempt = page.getByRole("button", { name: "Exempt", exact: true });
    await expect(exempt).toBeVisible();
    await exempt.tap();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).cells["00000000-0000-4000-8000-000000000001"]?.state)).toBe("exempt");
    await page.reload();
    await page.getByRole("button", { name: "Previous child", exact: true }).tap();
    await exempt.tap();
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).cells["00000000-0000-4000-8000-000000000001"]?.state)).toBe("blank");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });
}

test("an uncertain draft reuses its command after reload and does not write twice", async ({ page }) => {
  await page.goto("/?failure=after-commit");
  await page.locator('input[inputmode="decimal"]').first().fill("0");
  await expect(page.getByText("Not saved yet", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!));
  expect(before.revision).toBe(1);
  await page.reload();
  await page.getByRole("button", { name: "Restore and check save", exact: true }).tap();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).calls.length)).toBe(2);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!));
  expect(after.calls[1].commandId).toBe(before.calls[0].commandId);
  expect(after.revision).toBe(1);
  await expect(page.getByText(/^Saved \d/)).toBeVisible();
});

test("an interrupted draft before commit survives reload and reconnect", async ({ page }) => {
  await page.goto("/?failure=offline");
  await page.locator('input[inputmode="decimal"]').first().fill("12.5");
  await expect(page.getByText("Not saved yet", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Restore and check save", exact: true }).tap();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).revision)).toBe(1);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).cells["00000000-0000-4000-8000-000000000001"].value)).toBe(12.5);
});

test("strict and locked schemes do not expose mutation controls", async ({ page }) => {
  await page.goto("/?exempt=no");
  await expect(page.getByRole("button", { name: "Exempt", exact: true })).toHaveCount(0);
  await page.goto("/?locked=yes");
  await expect(page.locator('input[inputmode="decimal"]').first()).toBeDisabled();
});

test("a confirmed save whose recovery cannot clear blocks edits and retries the same command", async ({ page }) => {
  await page.addInitScript(() => {
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (key) {
      if (localStorage.getItem("qa:fail-clear")) throw Error("Synthetic IDB clear blocked");
      return remove.call(this, key);
    };
    const put = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("vppsone.draft.v2:") && JSON.parse(value).deleted && localStorage.getItem("qa:fail-clear")) throw Error("Synthetic fallback clear blocked");
      return put.call(this, key, value);
    };
    localStorage.setItem("qa:fail-clear", "yes");
  });
  await page.goto("/");
  await page.locator('input[inputmode="decimal"]').first().fill("5");
  await expect(page.getByText("This phone could not clear saved recovery. Keep this page open and retry before leaving.", { exact: true })).toBeVisible();
  await expect(page.locator('input[inputmode="decimal"]').first()).toBeDisabled();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!));
  expect(before.revision).toBe(1);
  await page.evaluate(() => localStorage.removeItem("qa:fail-clear"));
  await page.getByRole("button", { name: "Try again", exact: true }).tap();
  await expect(page.locator('input[inputmode="decimal"]').first()).toBeEnabled();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!));
  expect(after.revision).toBe(1); expect(after.calls.at(-1).commandId).toBe(before.calls[0].commandId);
});

test("list preserves zero, absent and exempt and refuses missing marks", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 });
  await page.goto("/");
  await page.locator('input[inputmode="decimal"]').first().fill("0");
  await page.getByRole("button", { name: "Absent", exact: true }).nth(1).tap();
  await page.getByRole("button", { name: "Exempt", exact: true }).nth(2).tap();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).revision)).toBe(1);
  const cells = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).cells);
  expect(cells["00000000-0000-4000-8000-000000000001"]).toEqual({ state: "value", value: 0 });
  expect(cells["00000000-0000-4000-8000-000000000002"].state).toBe("absent");
  expect(cells["00000000-0000-4000-8000-000000000003"].state).toBe("exempt");
  await page.getByRole("button", { name: "Check & send", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Send to exam coordinator", exact: true })).toBeDisabled();
  await expect(page.getByText("2 children have no mark yet", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("uncertain submit recovers on sent screen and repeated retry has one effect", async ({ page }) => {
  await page.goto("/?failure=after-commit&failureKind=submit&delay=50");
  for (const input of await page.locator('input[inputmode="decimal"]').all()) await input.fill("9");
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).revision)).toBe(1);
  await page.getByRole("button", { name: "Check & send", exact: true }).tap();
  await page.getByRole("button", { name: "Send to exam coordinator", exact: true }).tap();
  await expect(page.getByText("The save has not been confirmed. Try again to check the same save; your entries are kept on this phone.", { exact: true })).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!));
  await page.reload();
  const recover = page.getByRole("button", { name: "Restore and check save", exact: true });
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Hand back to teacher", exact: true })).toBeDisabled();
  await recover.tap();
  await expect(recover).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Marks sent", exact: true })).toBeVisible();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!));
  expect(after.revision).toBe(before.revision);
  expect(after.calls.at(-1).commandId).toBe(before.calls.at(-1).commandId);
  expect(Object.values(after.receipts)).toHaveLength(2);
  await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
});

test("restoring an unsent draft retains its original revision and cannot overwrite a concurrent save", async ({ page }) => {
  await page.addInitScript(() => {
    const browserTimers: Pick<Window, "setTimeout"> = window;
    const timeout = browserTimers.setTimeout.bind(window);
    browserTimers.setTimeout = (handler: TimerHandler, delay?: number, ...args: unknown[]) =>
      timeout(handler, delay === 900 ? 60_000 : delay, ...args);
  });
  await page.goto("/");
  await page.locator('input[inputmode="decimal"]').first().fill("8");
  const key = "vppsone.draft.v2:synthetic-teacher:OPS-TEST:vx-marks%2F00000000-0000-4000-8000-000000000099";
  await expect.poll(() => page.evaluate(async (draftKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open("vppsone-drafts", 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const value = await new Promise<{ value?: { revision?: number } }>((resolve, reject) => { const request = db.transaction("drafts").objectStore("drafts").get(draftKey); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    db.close(); return value?.value?.revision;
  }, key)).toBe(0);
  await page.evaluate(() => { const ledger = JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!); ledger.revision = 1; ledger.cells["00000000-0000-4000-8000-000000000002"] = { state: "value", value: 20 }; localStorage.setItem("qa:marks-mobile:ledger", JSON.stringify(ledger)); });
  await page.reload();
  await page.getByRole("button", { name: "Restore draft", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Reload", exact: true })).toBeVisible();
  await expect(page.locator('input[inputmode="decimal"]').first()).toBeDisabled();
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!));
  expect(after.revision).toBe(1); expect(after.cells["00000000-0000-4000-8000-000000000002"].value).toBe(20);
  expect(after.cells["00000000-0000-4000-8000-000000000001"]).toBeUndefined();
  expect(after.calls[0].expectedRevision).toBe(0);
});

test("a draft is isolated by staff and academic session on the same phone", async ({ page }) => {
  await page.goto("/?failure=offline&owner=teacher-a&session=2026-27");
  await page.locator('input[inputmode="decimal"]').first().fill("4");
  await expect(page.getByText("Not saved yet", { exact: true })).toBeVisible();
  await page.goto("/?owner=teacher-b&session=2026-27");
  await expect(page.getByRole("button", { name: "Restore and check save", exact: true })).toHaveCount(0);
  await page.goto("/?owner=teacher-a&session=2027-28");
  await expect(page.getByRole("button", { name: "Restore and check save", exact: true })).toHaveCount(0);
  await page.goto("/?owner=teacher-a&session=2026-27");
  await expect(page.getByRole("button", { name: "Restore and check save", exact: true })).toBeVisible();
});

test("landscape touch entry and pending request block edits until same save is checked", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/?failure=offline");
  await page.locator('input[inputmode="decimal"]').first().fill("8");
  await expect(page.getByText("Not saved yet", { exact: true })).toBeVisible();
  await expect(page.locator('input[inputmode="decimal"]').first()).toBeDisabled();
  await page.getByRole("button", { name: "Try again", exact: true }).tap();
  await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).revision)).toBe(1);
  const calls = await page.evaluate(() => JSON.parse(localStorage.getItem("qa:marks-mobile:ledger")!).calls);
  expect(calls[0]).toEqual(calls[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});
