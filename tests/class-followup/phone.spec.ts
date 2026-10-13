import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

test.beforeEach(async ({ context }) => {
  const artifact = process.env.PHONEOPS_CLASS_STATIC_DIR;
  const root = artifact ? path.resolve(artifact) : null;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3211' || route.request().method() !== 'GET') return route.abort('blockedbyclient');
    if (!root) return route.continue();
    const file = route.request().isNavigationRequest() ? path.join(root, 'class-followup.html') : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return route.abort('blockedbyclient');
    return route.fulfill({ path: file });
  });
});
test.afterEach(async ({ page }, info) => {
  const ledger = await page.evaluate(() => window.classFollowup?.snapshot() ?? null).catch(() => null);
  await info.attach('synthetic-ledger-after-attempt', { body: JSON.stringify({ status: info.status, viewport: page.viewportSize(), ledger, realDatabase: false, realNotices: false }), contentType: 'application/json' });
});

test('attendance queued offline survives reload and records exactly once after reconnect', async ({ page, context }, info) => {
  await page.goto('/class-followup.html?mode=attendance&path=/teach/attendance');
  const child = page.locator('button.tc-akid').first(); await expect(child).toBeVisible();
  await context.setOffline(true); await child.tap();
  await page.locator('.tc-abar button').tap();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const alerts = dialog.getByRole('switch'); if (await alerts.getAttribute('aria-checked') === 'true') await alerts.tap();
  await expect(alerts).toHaveAttribute('aria-checked', 'false');
  await dialog.locator('button.pri').tap();
  await expect(page.getByText(/this register is saved on this phone and will be sent when you are online/)).toBeVisible();
  expect(await page.evaluate(() => window.classFollowup.snapshot().attendance)).toEqual([]);
  expect(await page.evaluate(() => window.classFollowup.snapshot().attendanceAttempts)).toBe(0);
  await expect(page.getByText('The office can see it now.', { exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByText(/this register is saved on this phone and will be sent when you are online/)).toBeVisible();
  await expect(page.locator('button.tc-akid').first()).toHaveClass(/\ba\b/);
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => window.classFollowup.snapshot().attendance.length)).toBe(1);
  await expect(page.locator('.tc-abar')).toHaveCount(0);
  for (let turn = 0; turn < 3; turn += 1) { await context.setOffline(true); await context.setOffline(false); }
  const ledger = await page.evaluate(() => window.classFollowup.snapshot());
  expect(ledger.attendance).toHaveLength(1); expect(ledger.attendanceAttempts).toBe(1);
  expect(ledger.attendance[0]).toMatchObject({ revision: 1, alerts: false });
  expect(ledger.attendance[0].marks[0].status).toBe('absent');
  await info.attach('synthetic-persistence-ledger', { body: JSON.stringify(ledger), contentType: 'application/json' });
});

test('attendance last child and full save target stay above native phone navigation', async ({ page }, info) => {
  await page.goto('/class-followup.html?mode=attendance&path=/teach/attendance');
  const search = page.getByPlaceholder('Find a child'); await search.tap(); await expect(search).toBeFocused();
  await search.fill('24'); const last = page.locator('button.tc-akid').last(); await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible(); await last.tap();
  await search.fill(''); await page.locator('button.tc-akid').last().scrollIntoViewIfNeeded();
  const button = page.locator('.tc-abar button'); await button.scrollIntoViewIfNeeded();
  const measure = await button.evaluate(element => {
    const rect = element.getBoundingClientRect(); const nav = document.querySelector('nav.vx-bottom')!.getBoundingClientRect();
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom, navTop: nav.top, navHeight: nav.height, ownsCenter: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.closest('button') === element, coarse: matchMedia('(pointer: coarse)').matches };
  });
  await info.attach('phone-navigation-clearance', { body: JSON.stringify(measure), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('attendance-last-child-phone.png'), fullPage: false });
  expect(measure.coarse).toBe(true); expect(measure.document).toBeLessThanOrEqual(measure.viewport);
  expect(measure.height).toBeGreaterThanOrEqual(44); expect(measure.ownsCenter).toBe(true);
  expect(measure.bottom, 'entire Save target must clear native navigation').toBeLessThanOrEqual(measure.navTop + 1);
});

async function openNote(page: import('@playwright/test').Page) {
  await page.goto('/class-followup.html?mode=notes&path=/teach/notes');
  await page.locator('button.n-fab').tap();
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.locator('textarea').fill('phoneops-followup synthetic private observation');
  await dialog.locator('button.pri').tap();
  await dialog.getByRole('radio', { name: 'Only me', exact: true }).tap();
  return dialog;
}
test('note offline before Save retains review and reconnect creates one private record', async ({ page, context }, info) => {
  const dialog = await openNote(page); await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Save note', exact: true }).tap();
  await expect(dialog.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('phoneops-followup synthetic private observation');
  await expect(dialog.getByRole('alert')).toContainText(/not (?:been )?saved|internet|connection/i);
  expect(await page.evaluate(() => window.classFollowup.snapshot().notes)).toEqual([]);
  expect(await page.evaluate(() => window.classFollowup.snapshot().noteAttempts)).toBe(0);
  await expect(page.getByText('Note saved', { exact: true })).toHaveCount(0);
  await context.setOffline(false); await dialog.getByRole('button', { name: 'Save note', exact: true }).tap();
  await expect(dialog.getByText('Note saved', { exact: true })).toBeVisible();
  const ledger = await page.evaluate(() => window.classFollowup.snapshot()); expect(ledger.notes).toHaveLength(1);
  expect(ledger.notes[0]).toMatchObject({ visibility: 'private', tellParents: false, needsFollowUp: false });
  expect(ledger.noteAttempts).toBe(1);
  await info.attach('synthetic-note-persistence-ledger', { body: JSON.stringify(ledger), contentType: 'application/json' });
  const uncertain = await openNote(page);
  await uncertain.getByRole('textbox', { name: 'Note', exact: true }).fill('phoneops-followup second synthetic private observation');
  await page.evaluate(() => window.classFollowup.loseNextNoteAnswer());
  await uncertain.getByRole('button', { name: 'Save note', exact: true }).tap();
  await expect(uncertain.getByRole('alert')).toContainText('The save could not be confirmed');
  await expect(uncertain.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('phoneops-followup second synthetic private observation');
  await expect(uncertain.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled();
  await expect(page.getByText('Note saved', { exact: true })).toHaveCount(0);
  await context.setOffline(true); await context.setOffline(false);
  const afterLostAnswer = await page.evaluate(() => window.classFollowup.snapshot());
  expect(afterLostAnswer.notes).toHaveLength(2); expect(afterLostAnswer.noteAttempts).toBe(2);
  await info.attach('synthetic-committed-note-lost-answer', { body: JSON.stringify({ ...afterLostAnswer, scope: 'Mounted composer only; reload/new-tab uncertainty is not durable' }), contentType: 'application/json' });
});

test('note focus and footer remain reachable after a simulated keyboard viewport shrink', async ({ page }, info) => {
  const dialog = await openNote(page); const before = page.viewportSize()!;
  const text = dialog.getByRole('textbox', { name: 'Note', exact: true }); await text.tap(); await expect(text).toBeFocused();
  await page.setViewportSize({ width: before.width, height: Math.max(240, Math.min(before.height - 180, 460)) });
  await text.scrollIntoViewIfNeeded(); await expect(text).toBeFocused();
  const save = dialog.getByRole('button', { name: 'Save note', exact: true });
  const measure = await save.evaluate(element => {
    const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, viewportHeight: innerHeight, viewportWidth: innerWidth, document: document.documentElement.scrollWidth, ownsCenter: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === element };
  });
  await info.attach('simulated-keyboard-viewport', { body: JSON.stringify({ physicalKeyboard: false, ...measure }), contentType: 'application/json' });
  expect(measure.height).toBeGreaterThanOrEqual(44); expect(measure.bottom).toBeLessThanOrEqual(measure.viewportHeight);
  expect(measure.ownsCenter).toBe(true); expect(measure.document).toBeLessThanOrEqual(measure.viewportWidth);
  await page.setViewportSize(before); await dialog.getByRole('button', { name: 'Back', exact: true }).tap();
  await expect(dialog.locator('textarea')).toHaveValue('phoneops-followup synthetic private observation');
});
