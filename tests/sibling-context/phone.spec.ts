import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';

const primary = '00000000-0000-4000-8000-000000000201';
const sibling = '00000000-0000-4000-8000-000000000202';
const directory = '/students?q=QA+Sibling+Context&class=qa-sibling-context&view=fees&seg=pending&page=2';
test('Family sibling localized Back preserves the original filtered directory', async ({ page, context }, info) => {
  const artifact = process.env.PHONEOPS_SIBLING_STATIC_DIR;
  const root = artifact ? path.resolve(artifact) : null;
  const blocked: { method: string; origin: string; pathname: string }[] = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:3221' || route.request().method() !== 'GET') {
      blocked.push({ method: route.request().method(), origin: url.origin, pathname: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (!root) return route.continue();
    const file = route.request().isNavigationRequest() ? path.join(root, 'index.html') : path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (!file.startsWith(`${root}${path.sep}`) || !existsSync(file)) return route.abort('blockedbyclient');
    return route.fulfill({ path: file });
  });
  await page.goto(directory);
  const primaryLink = page.getByRole('link', { name: 'QA Sibling Context Primary', exact: true });
  await expect(primaryLink).toBeVisible(); await primaryLink.tap();
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(directory);
  await page.getByRole('link', { name: 'More', exact: true }).tap();
  const family = page.getByRole('link', { name: 'Family', exact: true });
  await family.tap(); await expect(family).toHaveAttribute('aria-current', 'location');
  const siblingLink = page.locator(`a.row[href^="/students/${sibling}"]`);
  await expect(siblingLink).toBeVisible(); const siblingHref = await siblingLink.getAttribute('href');
  await siblingLink.tap(); await expect(page).toHaveURL(new RegExp(`/students/${sibling}(?:\\?|$)`));
  await page.goBack(); await expect(page).toHaveURL(new RegExp(`/students/${primary}\\?`));
  await expect(page.getByRole('link', { name: 'Family', exact: true })).toHaveAttribute('aria-current', 'location');
  await page.goForward(); await expect(page).toHaveURL(new RegExp(`/students/${sibling}(?:\\?|$)`));
  const back = page.getByRole('link', { name: 'Back', exact: true });
  const before = { viewport: page.viewportSize(), touch: await page.evaluate(() => matchMedia('(pointer: coarse)').matches),
    directory, siblingHref, siblingUrl: page.url(), backHref: await back.getAttribute('href'), target: await back.boundingBox(),
    actionAttempts: await page.evaluate(() => (window as unknown as { siblingActionAttempts: { count: number } }).siblingActionAttempts.count), blocked };
  await info.attach('sibling-return-before-touch', { body: JSON.stringify(before), contentType: 'application/json' });
  await page.screenshot({ path: info.outputPath('sibling-back-phone.png'), fullPage: false });
  await back.tap();
  await info.attach('sibling-return-after-touch', { body: JSON.stringify({ url: page.url(), expected: directory, blocked }), contentType: 'application/json' });
  expect(before.touch).toBe(true); expect(before.actionAttempts).toBe(0); expect(blocked).toEqual([]);
  expect(`${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBe(directory);
  await expect(page.getByRole('link', { name: 'QA Sibling Context Primary', exact: true })).toBeVisible();
});
