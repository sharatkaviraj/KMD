import { expect, test } from '@playwright/test';
import { signIn } from './support/harness';

// No seeding, server-action submissions, provider sends, or preference writes.
// Auth tokens remain in the isolated browser context and never enter evidence.
const baseURL = process.env.PHONEOPS_BASE_URL ?? 'http://localhost:3100';
const allowedHost = new URL(baseURL).hostname;
if (!['localhost', '127.0.0.1', 'vppsone.vercel.app'].includes(allowedHost)) throw new Error('Unapproved phone route inventory host');

const roles = [
  { key: 'teacher', routes: ['/teach', '/teach/class', '/teach/attendance', '/teach/notes', '/timetable'] },
  { key: 'teacher2', routes: ['/teach', '/teach/class', '/teach/attendance', '/teach/notes', '/timetable'] },
  { key: 'feeCollector', routes: ['/payments', '/fees/students', '/accounts'] },
  { key: 'accountant', routes: ['/accounts', '/payments', '/receipts', '/fees/reports'] },
  { key: 'admin', routes: ['/dashboard', '/students', '/admissions', '/calendar', '/timetable', '/reports'] },
  { key: 'academic', routes: ['/academics', '/timetable', '/calendar', '/attendance'] },
] as const;

for (const width of [360, 390, 412]) for (const role of roles) {
  test(`${role.key}: DEV phone route inventory at ${width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    const externalNavigations: string[] = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.isNavigationRequest() && ![allowedHost, 'localhost', '127.0.0.1'].includes(url.hostname)) {
        externalNavigations.push(url.hostname);
        return route.abort();
      }
      // This suite is deliberately read-only after auth confirmation.
      if (request.method() !== 'GET' && request.isNavigationRequest()) return route.abort();
      return route.continue();
    });
    const page = await context.newPage();
    try {
      await signIn(page, role.key, role.routes[0]);
      const inventory: Array<Record<string, unknown>> = [];
      for (const route of role.routes) {
        const errors: string[] = [];
        const onError = (error: Error) => errors.push(error.message);
        page.on('pageerror', onError);
        const response = await page.goto(route);
        await expect(page.locator('body')).toBeVisible();
        await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
        const measured = await page.evaluate(() => ({
          viewport: innerWidth, document: document.documentElement.scrollWidth,
          heading: document.querySelector('h1')?.textContent?.trim() ?? null,
          mobile: matchMedia('(pointer: coarse)').matches,
          body: document.body.innerText.slice(0, 100),
        }));
        inventory.push({ route, status: response?.status(), path: new URL(page.url()).pathname, ...measured, errors });
        expect(measured.mobile, 'touch context must actually be coarse').toBe(true);
        expect(measured.document, `${route}: document must fit the phone`).toBeLessThanOrEqual(width + 1);
        expect(errors, `${route}: browser runtime errors`).toEqual([]);
        expect(response?.status(), `${route}: route response`).toBe(200);
        expect(new URL(page.url()).pathname, `${route}: expected screen or scoped child screen`).toMatch(new RegExp(`^${route}(?:/|$)`));
        expect(measured.heading, `${route}: actual screen heading`).toBeTruthy();
        if (allowedHost === 'localhost' || allowedHost === '127.0.0.1') await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-${width}.png`), fullPage: true });
        page.off('pageerror', onError);
      }
      const denies: Record<string, string[]> = { teacher: ['/students', '/payments'], teacher2: ['/students', '/payments'], accountant: ['/students', '/teach'], feeCollector: ['/students', '/teach'], academic: ['/payments'], admin: [] };
      for (const denied of denies[role.key]) {
        await page.goto(denied);
        await expect(page, `${role.key}: ${denied} must be refused after streamed redirect`).toHaveURL(/\/access-denied(?:\?|$)/);
        inventory.push({ route: denied, expected: 'denied', path: new URL(page.url()).pathname });
      }
      expect(externalNavigations, 'no sibling/live navigation').toEqual([]);
      await testInfo.attach('route-inventory', { body: JSON.stringify({ role: role.key, width, layer: 'DEV authenticated mobile emulation, read-only UI', inventory }, null, 2), contentType: 'application/json' });
      await page.reload();
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await page.goBack();
      await page.goForward();
    } finally { await context.close(); }
  });
}
