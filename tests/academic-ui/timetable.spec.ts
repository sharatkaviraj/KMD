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

test('lost cover response resolves original receipt after reload without another write', async ({ page }) => {
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=landed');
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.locator('#qa-ledger')).toContainText('"effects":1');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!).calls[0]);
  await page.reload();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!));
  expect(ledger.calls).toHaveLength(1); expect(ledger.effects).toBe(1);
  expect(ledger.checks).toEqual([original.commandId]);
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
});

test('uncommitted cover response retries original scoped payload after reload', async ({ page }) => {
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded');
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.locator('#qa-ledger')).toContainText('"effects":0');
  const original = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!).calls[0]);
  for (const suffix of ['day=2026-11-04', 'day=2026-11-03&session=OTHER-TEST', 'day=2026-11-03&owner=qa-other']) {
    await page.goto(`/?role=academic&view=subs&${suffix}`);
    await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  }
  await page.goto('/?role=academic&view=subs&day=2026-11-03');
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  await page.getByRole('button', { name: 'Retry same save', exact: true }).tap();
  await expect(page.locator('#qa-ledger')).toContainText('"effects":1');
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!));
  expect(ledger.calls).toEqual([original, original]); expect(ledger.effects).toBe(1);
  expect(ledger.checks).toEqual([original.commandId, original.commandId]);
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
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  await expect(page.getByText(/recovery record could not be cleared/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!));
  expect(ledger.calls).toHaveLength(1); expect(ledger.effects).toBe(1); expect(ledger.checks).toHaveLength(2);
});

test('two phone tabs reserve one cover identity under the same scoped lock', async ({ page, context }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=landed';
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
  const ledger = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!));
  expect(ledger.effects).toBe(1);
  const submitted = (await Promise.all([page, other].map(tab => tab.locator('#qa-command').textContent()))).filter(Boolean);
  expect(submitted).toHaveLength(1);
  const original = JSON.parse(submitted[0]!);
  for (const tab of [page, other]) {
    const stored = await tab.evaluate(() => JSON.parse(localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03')!).payload);
    expect(stored.commandId).toBe(original.commandId);
  }
  for (const tab of [page, other]) await expect(tab.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
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
  await page.goto(`${url}&preview=1`);
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).toBe(stored);
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
});

test('Hindi cover recovery displays translated controls', async ({ page }) => {
  await page.goto('/?role=academic&view=subs&day=2026-11-03&uncertain=landed&lang=hi');
  // Release is a pair now (rule 9): in Hindi it reads छोड़ें.
  await page.getByRole('button', { name: 'छोड़ें', exact: true }).tap();
  await expect(page.getByRole('button', { name: '\u0938\u0941\u0930\u0915\u094d\u0937\u093f\u0924 \u092a\u0930\u093f\u0923\u093e\u092e \u091c\u093e\u0901\u091a\u0947\u0902', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
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
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
});

test('delayed receipt check cannot retry after selected session changes', async ({ page }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=unlanded';
  await page.goto(url); await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  await page.evaluate(() => sessionStorage.setItem('qa-cover-delay-check', '1'));
  await page.getByRole('button', { name: 'Retry same save', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as unknown as { qaCheckWaiting?: boolean }).qaCheckWaiting)).toBe(true);
  await page.evaluate(next => { history.pushState({}, '', next); dispatchEvent(new PopStateEvent('popstate')); }, `${url}&session=OTHER-TEST`);
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { qaReleaseCheck: () => void }).qaReleaseCheck());
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!).checks.length)).toBe(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-cover-ledger')!).calls.length)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('vx-cover:v1:qa-teacher:TEST-2026-27:2026-11-03'))).not.toBeNull();
});

test('original saved receipt can be checked after timetable is no longer arrangable', async ({ page }) => {
  const url = '/?role=academic&view=subs&day=2026-11-03&uncertain=landed';
  await page.goto(url); await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await page.goto(`${url}&noTimetable=1`);
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
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
