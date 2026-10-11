import { expect, test } from '@playwright/test';
import { signIn } from './support/harness';
import enMessages from '../../src/messages/en.json';
import hiMessages from '../../src/messages/hi.json';
import hiEnMessages from '../../src/messages/hi-en.json';

// No seeding, server-action submissions, provider sends, or preference writes.
// Auth tokens remain in the isolated browser context and never enter evidence.
const baseURL = process.env.PHONEOPS_BASE_URL ?? 'http://localhost:3100';
const allowedHost = new URL(baseURL).hostname;
if (!['localhost', '127.0.0.1', 'vppsone.vercel.app'].includes(allowedHost)) throw new Error('Unapproved phone route inventory host');
const receiptId = process.env.PHONEOPS_RECEIPT_ID;
if (receiptId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receiptId)) {
  throw new Error('PHONEOPS_RECEIPT_ID must be a canonical UUID; value omitted from evidence.');
}
const receiptBackLabels = [enMessages.Receipts.backToTransactions, hiMessages.Receipts.backToTransactions, hiEnMessages.Receipts.backToTransactions];

const roles = [
  { key: 'teacher', routes: ['/teach', '/teach/class', '/teach/attendance', '/teach/notes', '/timetable'] },
  { key: 'teacher2', routes: ['/teach', '/teach/class', '/teach/attendance', '/teach/notes', '/timetable'] },
  { key: 'feeCollector', routes: ['/payments', '/fees/students', '/accounts'] },
  { key: 'accountant', routes: ['/accounts', '/payments', '/receipts', '/fees/reports'] },
  { key: 'admin', routes: ['/dashboard', '/students', '/admissions', '/calendar', '/timetable', '/reports'] },
  { key: 'academic', routes: ['/academics', '/timetable', '/calendar', '/attendance'] },
] as const;

for (const width of [360, 390, 412]) for (const role of roles) {
  test(`${role.key}: phone read-only route inventory at ${width}px`, async ({ browser }, testInfo) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const externalNavigations: string[] = [];
    const writeAttempts: Array<{ method: string; hostname: string; pathname: string }> = [];
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      // Browser auth confirmation uses page.goto (GET); no browser POST is needed.
      // Include fetch/XHR/beacons, and retain no query, headers, body or auth tokens.
      if (request.method() !== 'GET') {
        writeAttempts.push({ method: request.method(), hostname: url.hostname, pathname: url.pathname });
        return route.abort('blockedbyclient');
      }
      if (request.isNavigationRequest() && ![allowedHost, 'localhost', '127.0.0.1'].includes(url.hostname)) {
        externalNavigations.push(url.hostname);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    try {
      try { await signIn(page, role.key, role.routes[0]); }
      catch { throw new Error('QA GET auth confirmation did not complete; auth URL omitted from evidence.'); }
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
      if (role.key === 'feeCollector' && receiptId) {
        // The supplied retained QA receipt must belong to this collector. Only
        // view its native detail route: never activate Print, Send or reversal.
        const route = `/fees/receipts/${receiptId}`;
        const response = await page.goto(route);
        await expect(page).toHaveURL(new RegExp(`${route}$`));
        expect(response?.status(), 'owned native receipt route response').toBe(200);
        const actions = page.locator('[data-mobile-receipt-actions="true"]');
        await expect(actions).toBeVisible();
        await expect(actions).toHaveCSS('position', 'fixed');
        const a4 = actions.getByRole('link', { name: /A4/ });
        await expect(a4).toBeVisible();
        const a4Touch = await a4.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          return {
            width: rect.width, height: rect.height,
            withinViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
            ownsCenter: document.elementFromPoint(centerX, centerY)?.closest('a') === element,
          };
        });
        expect(a4Touch.width, 'A4 touch width').toBeGreaterThanOrEqual(44);
        expect(a4Touch.height, 'A4 touch height').toBeGreaterThanOrEqual(44);
        expect(a4Touch.withinViewport, 'A4 remains inside the phone viewport').toBe(true);
        expect(a4Touch.ownsCenter, 'A4 owns the center touch target').toBe(true);
        await expect(page.locator('nav.vx-bottom')).toHaveCount(0);
        // Use accessible labels rather than assuming the QA account's locale.
        const localizedBack = page.locator('a[aria-label]').filter({ hasText: new RegExp(receiptBackLabels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')) }).first();
        await expect(localizedBack).toBeVisible();
        expect(receiptBackLabels).toContain(await localizedBack.getAttribute('aria-label'));
        const backBox = await localizedBack.boundingBox();
        expect(backBox?.width, 'localized Back touch width').toBeGreaterThanOrEqual(44);
        expect(backBox?.height, 'localized Back touch height').toBeGreaterThanOrEqual(44);
        const measured = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, mobile: matchMedia('(pointer: coarse)').matches }));
        expect(measured.mobile).toBe(true);
        expect(measured.document, 'native receipt document fits the phone').toBeLessThanOrEqual(width + 1);
        inventory.push({ route, status: response?.status(), expected: 'owned native receipt read-only', ...measured, a4Touch, backTouch: backBox && { width: backBox.width, height: backBox.height } });
      }
      const denies: Record<string, string[]> = { teacher: ['/students', '/payments'], teacher2: ['/students', '/payments'], accountant: ['/students', '/teach'], feeCollector: ['/students', '/teach'], academic: ['/payments'], admin: [] };
      for (const denied of denies[role.key]) {
        await page.goto(denied);
        await expect(page, `${role.key}: ${denied} must be refused after streamed redirect`).toHaveURL(/\/access-denied(?:\?|$)/);
        inventory.push({ route: denied, expected: 'denied', path: new URL(page.url()).pathname });
      }
      expect(externalNavigations, 'no sibling/live navigation').toEqual([]);
      await testInfo.attach('route-inventory', { body: JSON.stringify({ role: role.key, width, layer: 'authenticated mobile emulation, read-only UI', inventory }, null, 2), contentType: 'application/json' });
      await page.reload();
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
      await page.goBack();
      await page.goForward();
    } finally {
      try { await context.close(); }
      finally {
        await testInfo.attach('blocked-write-attempts', { body: JSON.stringify({ role: role.key, width, writeAttempts }, null, 2), contentType: 'application/json' });
        expect(writeAttempts, 'read-only phone inventory must attempt no non-GET browser requests').toEqual([]);
      }
    }
  });
}
