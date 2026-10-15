import { expect, test } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

// Serve the production-built fixture without a server or external requests.
test.beforeEach(async ({ context }) => {
  const artifact = process.env.PHONEOPS_ACADEMIC_STATIC_DIR;
  if (!artifact) return;
  const root = path.resolve(artifact);
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1") return route.abort("blockedbyclient");
    const file = request.isNavigationRequest()
      ? path.join(root, "index.html")
      : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return route.abort("blockedbyclient");
    await route.fulfill({ path: file });
  });
});
test("teacher sees published periods; coordinator previews pending edits", async ({ page }) => {
  await page.goto("/?role=teacher");
  await expect(page.locator(".only-m:visible, .only-d:visible").getByText("Published Maths", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending Science", { exact: true })).toHaveCount(0);
  await page.goto("/?role=academic");
  await expect(page.locator(".only-m:visible, .only-d:visible").getByText("Pending Science", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("selected cover day survives assignment dialog, tabs and reload", async ({ page }) => {
  await page.goto("/?role=academic&view=subs&day=2026-11-03");
  await page.getByRole("button", { name: "Change", exact: true }).tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.getByRole("radio", { name: "Teacher", exact: true }).tap();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.goBack();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.goForward();
  await expect(page).toHaveURL(/day=2026-11-03/);
  await page.goBack();
  await page.reload();
  await page.getByRole("button", { name: "Release", exact: true }).tap();
  await expect(page.locator("#qa-command")).toContainText('"day":"2026-11-03"');
});
test("Now belongs only to the current school day", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-12T03:45:00Z") });
  await page.goto("/?role=academic&view=subs&day=2026-11-03");
  await expect(page.getByText("Now", { exact: true })).toHaveCount(0);
  await page.goto("/?role=academic&view=subs&day=2026-10-12");
  await expect(page.getByText("Now", { exact: true })).toBeVisible();
});

/*
 * An unresolved cover save is checked by the screen itself, straight after
 * the save gives up and whenever its day is opened (school-day run, admin B2 /
 * coordinators B9): one that landed clears without anybody finding "Check
 * saved result"; one that did not says "Not saved" and offers Try again with
 * the same command id. The checks below count those automatic reads.
 */
const coverLedger = (page: import("@playwright/test").Page) => page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger') ?? '{"calls":[],"committed":[],"checks":[],"effects":0}'));

test('lost cover response resolves original receipt by itself without another write', async ({ page }) => {
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=landed');
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.locator('#qa-ledger')).toContainText('"effects":1');
  await expect.poll(async () => (await coverLedger(page)).checks.length).toBe(1);
  const original = (await coverLedger(page)).calls[0];
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).toBeNull();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeEnabled();
  const ledger = await coverLedger(page);
  expect(ledger.calls).toHaveLength(1); expect(ledger.effects).toBe(1);
  expect(ledger.checks).toEqual([original.commandId]);
});

test('uncommitted cover response says not saved and retries original scoped payload', async ({ page }) => {
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded');
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.locator('#qa-ledger')).toContainText('"effects":0');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  const original = (await coverLedger(page)).calls[0];
  for (const suffix of ['day=2026-11-04', 'day=2026-11-03&session=OTHER-TEST', 'day=2026-11-03&owner=qa-other']) {
    await page.goto(`/?role=academic&view=subs&${suffix}`);
    await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  }
  await page.goto('/?role=academic&view=subs&day=2026-11-03');
  await page.getByRole('button', { name: 'Try again', exact: true }).tap();
  await expect(page.locator('#qa-ledger')).toContainText('"effects":1');
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  const ledger = await coverLedger(page);
  expect(ledger.calls).toEqual([original, original]); expect(ledger.effects).toBe(1);
  // After the lost save, on reopening the day, and once more before the retry.
  expect(ledger.checks).toEqual([original.commandId, original.commandId, original.commandId]);
});

test('cover storage failure refuses submission before any synthetic effect', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key.startsWith('vx-cover:')) throw new Error('Synthetic quota'); return original.call(this, key, value); };
  });
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=landed');
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.getByText(/Nothing was submitted/)).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('qa-cover-ledger'))).toBeNull();
});

test('saved cover receipt remains recoverable if local clear fails', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function(key) { if (key.startsWith('vx-cover:')) throw new Error('Synthetic clear failure'); return original.call(this, key); };
  });
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=landed');
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  // The automatic check finds the receipt but cannot clear the record: the screen stays blocked and says why.
  await expect(page.getByText(/recovery record could not be cleared/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
  await page.reload();
  await expect.poll(async () => (await coverLedger(page)).checks.length).toBe(2);
  const ledger = await coverLedger(page);
  expect(ledger.calls).toHaveLength(1); expect(ledger.effects).toBe(1);
});

test('two phone tabs reserve one cover identity under the same scoped lock', async ({ page, context }) => {
  // Unlanded, so the one identity stays to be compared: the sending tab's own check says "Not saved",
  // the other tab never checks a request it did not send and shows it as waiting.
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded';
  await page.goto(url);
  const other = await context.newPage();
  await other.goto(url);
  for (const tab of [page, other]) await tab.getByRole('button', { name: 'Release', exact: true }).scrollIntoViewIfNeeded();
  const targets = await Promise.all([page, other].map(tab => tab.getByRole('button', { name: 'Release', exact: true }).boundingBox()));
  const held = page.evaluate(async () => {
    const gate = window as unknown as { qaLockHeld: boolean; qaReleaseLock: () => void };
    await navigator.locks.request('vx-cover-lock:vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03', async () => {
      gate.qaLockHeld = true;
      await new Promise<void>(resolve => { gate.qaReleaseLock = resolve; });
    });
  }).catch(() => {});
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaLockHeld?: boolean }).qaLockHeld)).toBe(true);
  try {
    await Promise.all([page, other].map((tab, index) => { const box = targets[index]!; return tab.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); }));
    expect(await page.evaluate(() => localStorage.getItem('qa-cover-ledger'))).toBeNull();
  } finally {
    await page.evaluate(() => (window as unknown as { qaReleaseLock: () => void }).qaReleaseLock());
    await held;
  }
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger') ?? '{}').calls?.length)).toBe(1);
  const submitted = (await Promise.all([page, other].map(tab => tab.locator('#qa-command').textContent()))).filter(Boolean);
  expect(submitted).toHaveLength(1);
  const original = JSON.parse(submitted[0]!);
  for (const tab of [page, other]) await expect(tab.getByRole('button', { name: /^(Check saved result|Try again)$/ })).toBeVisible();
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!));
  expect(ledger.calls).toHaveLength(1); expect(ledger.effects).toBe(0);
  expect(ledger.checks).toEqual([original.commandId]);
  for (const tab of [page, other]) {
    const stored = await tab.evaluate(() => JSON.parse(localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03')!).payload);
    expect(stored.commandId).toBe(original.commandId);
  }
});

test('unsupported browser shows persistent cover safety explanation', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }));
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=landed');
  await expect(page.getByText(/cannot safely preserve cover saves across tabs/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('qa-cover-ledger'))).toBeNull();
});

test('read-only role preview cannot reserve or retry a cover command', async ({ page }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded';
  await page.goto(`${url}&preview=1`);
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('qa-cover-ledger'))).toBeNull();
  await page.goto(url);
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.locator('#qa-ledger')).toContainText('"effects":0');
  const stored = await page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'));
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  const checks = (await coverLedger(page)).checks.length;
  await page.goto(`${url}&preview=1`);
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  // A preview never checks or retries the request either.
  expect((await coverLedger(page)).checks.length).toBe(checks);
  expect(await page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).toBe(stored);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
});

test('Hindi cover recovery displays translated controls', async ({ page }) => {
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded&lang=hi');
  // Release is a pair now (rule 9): in Hindi it reads छोड़ें.
  await page.getByRole('button', { name: 'छोड़ें', exact: true }).tap();
  // Not saved: Try again and Check again, in Hindi.
  await expect(page.getByRole('button', { name: '\u092b\u093f\u0930 \u0906\u091c\u093c\u092e\u093e\u090f\u0901', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '\u092b\u093f\u0930 \u091c\u093e\u0901\u091a\u0947\u0902', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
});

test('queued cover reservation keeps identity but cannot dispatch after preview changes', async ({ page }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded';
  await page.goto(url);
  const held = page.evaluate(async () => {
    const gate = window as unknown as { qaLockHeld: boolean; qaReleaseLock: () => void };
    await navigator.locks.request('vx-cover-lock:vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03', async () => {
      gate.qaLockHeld = true; await new Promise<void>(resolve => { gate.qaReleaseLock = resolve; });
    });
  }).catch(() => {});
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaLockHeld?: boolean }).qaLockHeld)).toBe(true);
  try {
    await page.getByRole('button', { name: 'Release', exact: true }).tap();
    await page.evaluate(next => { history.pushState({}, '', next); dispatchEvent(new PopStateEvent('popstate')); }, `${url}&preview=1`);
    await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  } finally {
    await page.evaluate(() => (window as unknown as { qaReleaseLock: () => void }).qaReleaseLock()); await held;
  }
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).not.toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('qa-cover-ledger'))).toBeNull();
  await page.goto(url);
  // Opened again in its own context, the waiting request is checked by itself and was never sent.
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  expect((await coverLedger(page)).calls).toHaveLength(0);
});

test('delayed receipt check cannot retry after selected session changes', async ({ page }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded';
  await page.goto(url); await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem('qa-cover-delay-check', '1'));
  await page.getByRole('button', { name: 'Try again', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaCheckWaiting?: boolean }).qaCheckWaiting)).toBe(true);
  await page.evaluate(next => { history.pushState({}, '', next); dispatchEvent(new PopStateEvent('popstate')); }, `${url}&session=OTHER-TEST`);
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { qaReleaseCheck: () => void }).qaReleaseCheck());
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!).checks.length)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!).calls.length)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).not.toBeNull();
});

test('original saved receipt can be checked after timetable is no longer arrangable', async ({ page }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=landed';
  // Hold the automatic check so the request is still waiting when the timetable goes away.
  // Armed before the first load, once per tab: the screen checks on load now, and setting
  // the flag after `goto` lost the race on a slow runner (360px flake on main, 15 Oct).
  await page.addInitScript(() => {
    if (sessionStorage.getItem('qa-cover-delay-armed')) return;
    sessionStorage.setItem('qa-cover-delay-armed', '1');
    sessionStorage.setItem('qa-cover-delay-check', '1');
  });
  await page.goto(url);
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaCheckWaiting?: boolean }).qaCheckWaiting)).toBe(true);
  await page.evaluate(() => sessionStorage.removeItem('qa-cover-delay-check'));
  await page.goto(`${url}&noTimetable=1`);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).toBeNull();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!));
  expect(ledger.calls).toHaveLength(1); expect(ledger.effects).toBe(1); expect(ledger.checks).toHaveLength(1);
});

test('late saved response retains original identity after preview changes', async ({ page }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03';
  await page.goto(url); await page.evaluate(() => sessionStorage.setItem('qa-cover-delay-post', '1'));
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaPostWaiting?: boolean }).qaPostWaiting)).toBe(true);
  const stored = await page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'));
  await page.evaluate(next => { history.pushState({}, '', next); dispatchEvent(new PopStateEvent('popstate')); }, `${url}&preview=1`);
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { qaReleasePost: () => void }).qaReleasePost());
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaPostSettled?: boolean }).qaPostSettled)).toBe(true);
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).toBe(stored);
});
