import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { db, signIn, currentSessionLabel } from './support/harness';

// This lane does not seed, post actions, mutate preferences, or dispatch notices.
// Existing QA identities only; token links, cookies and staff names are excluded
// from reports/traces/screenshots. The reserved date must remain entirely empty.
const day = '2026-11-13';
const classId = '745643d0-aaca-470f-9372-d87397770a77';
const teacherId = '29d76340-1929-4848-ad4f-8a3ae5653a43';

async function safeSignIn(page: Page, role: string, next: string) {
  try { await signIn(page, role, next); }
  catch { throw new Error(`Existing QA ${role} login unavailable; auth URL excluded from evidence`); }
}
const phoneTitle = (page: Page, title: string) => page.locator('header.only-m:visible').getByText(title, { exact: true });

async function snapshot(session: string) {
  const entries = await Promise.all(['cover_days', 'cover_duties', 'teacher_absences', 'cover_commands', 'staff_notices'].map(async table => {
    const { count, error } = await db().from(table).select('*', { count: 'exact', head: true }).eq('session_label', session).eq('day', day);
    if (error) throw new Error(`Cannot read reserved-date invariant: ${table}`);
    return [table, count] as const;
  }));
  return Object.fromEntries(entries);
}

async function isolated(browser: Browser, width: number, height: number) {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100', viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const blocked: string[] = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    // Auth confirm is GET; all subsequent server mutations are forbidden here.
    if (request.method() !== 'GET' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
      if (request.method() !== 'GET') blocked.push(request.method());
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  return { context, blocked };
}

for (const [width, height] of [[360, 800], [390, 844], [412, 915], [844, 390]]) {
  test(`academic and teacher DEV timetable ${width}x${height} touch`, async ({ browser }, testInfo) => {
    test.setTimeout(360000);
    const session = await currentSessionLabel();
    const before = await snapshot(session);
    expect(Object.values(before)).toEqual([0, 0, 0, 0, 0]);
    const contexts: BrowserContext[] = [];
    try {
      const coordinator = await isolated(browser, width, height);
      contexts.push(coordinator.context);
      const page = await coordinator.context.newPage();
      await safeSignIn(page, 'academic', `/timetable?view=subs&day=${day}`);
      await expect(phoneTitle(page, 'Substitutions')).toBeVisible();
      await expect(page.getByText('No one is marked away yet.', { exact: true })).toBeVisible();
      await expect(page.getByText('Now', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Save & arrange', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save & arrange', exact: true })).toBeDisabled();
      const phone = await page.evaluate(() => ({ coarse: matchMedia('(pointer: coarse)').matches, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
      expect(phone.coarse).toBe(true);
      expect(phone.scrollWidth).toBeLessThanOrEqual(width + 1);
      await page.getByRole('radio', { name: /^Teacher(?:\s|$)/ }).tap();
      await expect(page).toHaveURL(new RegExp(`day=${day}`));
      await expect(phoneTitle(page, 'Teacher timetable')).toBeVisible();
      await page.goBack();
      await expect(phoneTitle(page, 'Substitutions')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`day=${day}`));
      await page.goForward();
      await expect(phoneTitle(page, 'Teacher timetable')).toBeVisible();
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`day=${day}`));
      await expect(phoneTitle(page, 'Teacher timetable')).toBeVisible();

      const teacher = await isolated(browser, width, height);
      contexts.push(teacher.context);
      const teacherPage = await teacher.context.newPage();
      await safeSignIn(teacherPage, 'teacher', `/timetable?view=teacher&teacher=${teacherId}&day=${day}`);
      await expect(phoneTitle(teacherPage, 'Teacher timetable')).toBeVisible();
      await expect(teacherPage.getByRole('button', { name: /Save change|Publish changes/ })).toHaveCount(0);
      await expect(teacherPage.getByText(/changes? (is|are) not published yet/)).toHaveCount(0);
      await teacherPage.goto(`/timetable?class=${classId}&day=${day}`);
      await expect(phoneTitle(teacherPage, 'Timetable')).toBeVisible();
      await teacherPage.goto(`/timetable?view=subs&day=${day}`);
      await expect(phoneTitle(teacherPage, 'Substitutions')).toBeVisible();
      await expect(teacherPage.getByText('No one is marked away yet.', { exact: true })).toBeVisible();
      await expect(teacherPage.getByText('Now', { exact: true })).toHaveCount(0);
      await expect(teacherPage.getByRole('button', { name: /Mark away|Save absence|Save & arrange/i })).toHaveCount(0);
      await teacherPage.goto('/timetable/import');
      await expect(teacherPage).toHaveURL(/\/access-denied(?:\?|$)/);
      await page.goto('/payments');
      await expect(page).toHaveURL(/\/access-denied(?:\?|$)/);
      expect(coordinator.blocked).toEqual([]);
      expect(teacher.blocked).toEqual([]);
      const after = await snapshot(session);
      expect(after).toEqual(before);
      await testInfo.attach('academic-safe-ledger', { contentType: 'application/json', body: JSON.stringify({ tag: 'phoneops-20261011-academic', layer: 'authenticated DEV Chromium mobile emulation; read-only school timetable', width, height, session, reservedDay: day, before, after, phone, roleBoundaries: ['teacher cannot import/edit/publish/arrange', 'academic cannot access payments'], fixtureWrites: 0, serverActionPosts: 0, noticeDispatches: 0 }) });
    } finally {
      await Promise.all(contexts.map(context => context.close()));
    }
  });
}
