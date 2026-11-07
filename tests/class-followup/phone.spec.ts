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
  await expect(page.getByText(/this register is kept on this phone and will be sent when you are online/)).toBeVisible();
  expect(await page.evaluate(() => window.classFollowup.snapshot().attendance)).toEqual([]);
  expect(await page.evaluate(() => window.classFollowup.snapshot().attendanceAttempts)).toBe(0);
  await expect(page.getByText('The office can see it now.', { exact: true })).toHaveCount(0);
  await page.reload(); await expect(page.getByText(/this register is kept on this phone and will be sent when you are online/)).toBeVisible();
  // An offline save reads as kept on the phone, not as an open register with a live Save (BUG-08).
  await expect(page.getByText('Kept on this phone', { exact: true })).toBeVisible(); await expect(page.locator('.tc-abar')).toHaveCount(0);
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
  const search = page.getByPlaceholder('Name or number'); await search.tap(); await expect(search).toBeFocused();
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

const WORDS = 'phoneops-followup synthetic private observation';

/** "New note" opens the note card by card (D-486). The fixture is opened for one child, so the first card is the words. */
async function startNote(page: import('@playwright/test').Page) {
  await page.goto('/class-followup.html?mode=notes&path=/teach/notes');
  await page.locator('button.nt-fab').tap();
  const composer = page.locator('.nc');
  await expect(composer.getByRole('textbox', { name: 'Note', exact: true })).toBeVisible();
  return composer;
}

/** Write the note, go on to the check card, and make it a private note with no follow-up. */
async function openNote(page: import('@playwright/test').Page, words = WORDS) {
  const composer = await startNote(page);
  await composer.getByRole('textbox', { name: 'Note', exact: true }).fill(words);
  await composer.getByRole('button', { name: 'Next', exact: true }).tap();
  // The check card: what the words were sorted into, each one line that opens its own choices.
  await composer.getByRole('button', { name: /^Follow-up:/ }).tap();
  await composer.getByRole('button', { name: /^Just noting/ }).tap();
  await composer.getByRole('button', { name: 'Done', exact: true }).tap();
  await composer.getByRole('button', { name: /^Who can read it:/ }).tap();
  await composer.getByRole('radio', { name: /^Only me/ }).tap();
  await composer.getByRole('button', { name: 'Done', exact: true }).tap();
  await expect(composer.getByRole('button', { name: 'Who can read it: Only me', exact: true })).toBeVisible();
  return composer;
}
/** The words as the check card shows them (never the copy of a card sliding away). */
const wordsOnCheck = (composer: import('@playwright/test').Locator) => composer.locator('.nc-card:not(.leaving) .nc-wt');

test('note offline before Save retains review and reconnect creates one private record', async ({ page, context }, info) => {
  const dialog = await openNote(page); await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Save note', exact: true }).tap();
  await expect(wordsOnCheck(dialog)).toHaveText(WORDS);
  await expect(dialog.getByRole('alert')).toContainText(/not (?:been )?saved|internet|connection/i);
  expect(await page.evaluate(() => window.classFollowup.snapshot().notes)).toEqual([]);
  expect(await page.evaluate(() => window.classFollowup.snapshot().noteAttempts)).toBe(0);
  await expect(page.getByText('Note saved', { exact: true })).toHaveCount(0);
  await context.setOffline(false); await dialog.getByRole('button', { name: 'Save note', exact: true }).tap();
  await expect(page.getByText('Note saved', { exact: true }).filter({ visible: true })).toBeVisible();
  const ledger = await page.evaluate(() => window.classFollowup.snapshot()); expect(ledger.notes).toHaveLength(1);
  expect(ledger.notes[0]).toMatchObject({ visibility: 'private', tellParents: false, needsFollowUp: false });
  expect(ledger.noteAttempts).toBe(1);
  await info.attach('synthetic-note-persistence-ledger', { body: JSON.stringify(ledger), contentType: 'application/json' });
  const second = 'phoneops-followup second synthetic private observation';
  const uncertain = await openNote(page, second);
  await page.evaluate(() => window.classFollowup.loseNextNoteAnswer());
  await uncertain.getByRole('button', { name: 'Save note', exact: true }).tap();
  await expect(uncertain.getByRole('alert')).toContainText('We could not tell whether the note was saved');
  await expect(wordsOnCheck(uncertain)).toHaveText(second);
  await expect(uncertain.getByRole('button', { name: 'Save note', exact: true })).toBeDisabled();
  await expect(page.getByText('Note saved', { exact: true })).toHaveCount(0);
  await context.setOffline(true); await context.setOffline(false);
  const afterLostAnswer = await page.evaluate(() => window.classFollowup.snapshot());
  expect(afterLostAnswer.notes).toHaveLength(2); expect(afterLostAnswer.noteAttempts).toBe(2);
  await info.attach('synthetic-committed-note-lost-answer', { body: JSON.stringify({ ...afterLostAnswer, scope: 'Mounted composer only; reload/new-tab uncertainty is not durable' }), contentType: 'application/json' });
});

test('note focus and footer remain reachable after a simulated keyboard viewport shrink', async ({ page }, info) => {
  const dialog = await startNote(page); const before = page.viewportSize()!;
  const text = dialog.getByRole('textbox', { name: 'Note', exact: true }); await text.tap(); await expect(text).toBeFocused();
  await text.fill(WORDS);
  await page.setViewportSize({ width: before.width, height: Math.max(240, Math.min(before.height - 180, 460)) });
  await text.scrollIntoViewIfNeeded(); await expect(text).toBeFocused();
  // The write card's way on. A card too tall for what is left (a phone on its side) lets the page scroll instead of cutting it off.
  const next = dialog.getByRole('button', { name: 'Next', exact: true });
  await next.scrollIntoViewIfNeeded();
  const measure = await next.evaluate(element => {
    const r = element.getBoundingClientRect(); return { width: r.width, height: r.height, top: r.top, bottom: r.bottom, viewportHeight: innerHeight, viewportWidth: innerWidth, document: document.documentElement.scrollWidth, ownsCenter: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('button') === element };
  });
  await info.attach('simulated-keyboard-viewport', { body: JSON.stringify({ physicalKeyboard: false, ...measure }), contentType: 'application/json' });
  expect(measure.height).toBeGreaterThanOrEqual(44); expect(measure.bottom).toBeLessThanOrEqual(measure.viewportHeight);
  expect(measure.ownsCenter).toBe(true); expect(measure.document).toBeLessThanOrEqual(measure.viewportWidth);
  // Leaving the page keeps the words: the draft comes back when the note is opened again (RULES G).
  await expect(dialog.getByText(/Kept on this device/)).toBeVisible();
  await page.setViewportSize(before); await page.getByRole('button', { name: 'Back', exact: true }).tap();
  await page.locator('button.nt-fab').tap();
  await expect(dialog.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue(WORDS);
});
