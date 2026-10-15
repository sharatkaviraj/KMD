import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

test.beforeEach(async ({ context }) => {
  const artifact = process.env.PHONEOPS_ACADEMIC_FOLLOWUP_DIR;
  if (!artifact) return;
  const root = path.resolve(artifact);
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.hostname !== '127.0.0.1') return route.abort('blockedbyclient');
    const file = request.isNavigationRequest() ? path.join(root, 'index.html') : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return route.abort('blockedbyclient');
    await route.fulfill({ path: file });
  });
});
const url = '/?role=academic&view=subs&day=2027-01-04';
const pendingKey = 'vx-cover:v1:qa-teacher:TEST-2026-27:2027-01-04';
const attempts = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-attempts') ?? '[]') as { kind: string; id: string; online: boolean }[]);

/*
 * School-day run, 14 Oct (admin B2, coordinators B9): an unresolved cover
 * save is checked by the screen itself — straight after the save gives up,
 * and again on every load — so a save that landed clears without anybody
 * finding "Check saved result", and one that did not says "Not saved" and
 * offers Try again with the same command id.
 */

test('offline save and failed check retain original request until reconnect retry', async ({ page, context }) => {
  await page.goto(url); await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  // The failed save is followed by one automatic check, which fails offline too.
  await expect.poll(async () => (await attempts(page)).map(entry => entry.kind)).toEqual(['save', 'check']);
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
  const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).payload, pendingKey);
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows') ?? '[]'))).toEqual([]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).payload, pendingKey)).toEqual(original);
  await context.setOffline(false); await page.reload();
  // On load the screen checks again; the server has no receipt, so it says so plainly.
  await page.getByRole('button', { name: 'Try again', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0);
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows')!));
  expect(rows).toEqual([original]);
  const saves = (await attempts(page)).filter(entry => entry.kind === 'save');
  expect(saves.map(entry => entry.id)).toEqual([original.commandId, original.commandId]);
  expect(saves.map(entry => entry.online)).toEqual([false, true]);
});

test('a lost committed response is resolved by reading its receipt, never a second effect', async ({ page }) => {
  await page.goto(url);
  await page.evaluate(() => sessionStorage.setItem('qa-academic-followup-lose-response', '1'));
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  // The response is lost after the commit; the automatic check finds the receipt and clears the request.
  await expect.poll(async () => (await attempts(page)).map(entry => entry.kind)).toEqual(['save', 'check']);
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), pendingKey)).toBeNull();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows')!));
  expect(rows).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeEnabled();
  const saves = (await attempts(page)).filter(entry => entry.kind === 'save');
  expect(saves).toEqual([{ kind: 'save', id: rows[0].commandId, online: true }]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows')!))).toEqual(rows);
});
