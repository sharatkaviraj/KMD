import { expect, test } from '@playwright/test';
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

test('offline save and failed check retain original request until reconnect retry', async ({ page, context }) => {
  await page.goto(url); await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
  const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).payload, pendingKey);
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-attempts')!).length)).toBe(2);
  await expect(page.getByRole('button', { name: 'Release', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows') ?? '[]'))).toEqual([]);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).payload, pendingKey)).toEqual(original);
  await context.setOffline(false); await page.reload();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  await page.getByRole('button', { name: 'Retry same save', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  const rows = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows')!));
  expect(rows).toEqual([original]);
  const saves = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-attempts')!).filter((entry: { kind: string }) => entry.kind === 'save'));
  expect(saves.map((entry: { id: string }) => entry.id)).toEqual([original.commandId, original.commandId]);
  expect(saves.map((entry: { online: boolean }) => entry.online)).toEqual([false, true]);
});

test('offline read after lost committed response never adds a second effect', async ({ page, context }) => {
  await page.goto(url);
  await page.evaluate(() => sessionStorage.setItem('qa-academic-followup-lose-response', '1'));
  await page.getByRole('button', { name: 'Release', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toBeVisible();
  const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).payload, pendingKey);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows')!))).toEqual([original]);
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-attempts')!).length)).toBe(2);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).payload, pendingKey)).toEqual(original);
  await context.setOffline(false); await page.reload();
  await page.getByRole('button', { name: 'Check saved result', exact: true }).tap();
  await expect(page.getByRole('button', { name: 'Check saved result', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-server-rows')!))).toEqual([original]);
  const saves = await page.evaluate(() => JSON.parse(localStorage.getItem('qa-academic-followup-attempts')!).filter((entry: { kind: string }) => entry.kind === 'save'));
  expect(saves).toEqual([{ kind: 'save', id: original.commandId, online: true }]);
});
