import { expect, test, type Page } from "@playwright/test";
import { T } from "../../src/vx/screens/admin/text";
test.setTimeout(60_000);

async function decide(page: Page, width: number, locale: string) {
  if (width < 899) await page.getByRole("button", { name: /Synthetic submission/ }).click();
  await page.getByRole("button", { name: locale === "hi" ? T.accept.hi! : T.accept.en, exact: true }).click();
}
const keys = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("vppsone:inbox:")));
for (const width of [390, 1440]) for (const locale of ["en", "hi", "hi-en"]) {
  test(`inbox survives lost response and reload: ${locale}/${width}`, async ({ page }) => {
    const bodies: Record<string, unknown>[] = []; let acknowledge = false;
    await page.route("**/api/inbox", async route => {
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ status: acknowledge ? 200 : 503, contentType: "application/json", body: JSON.stringify({ ok: acknowledge }) });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=inbox&locale=${locale}`); await decide(page, width, locale);
    await expect.poll(() => keys(page)).toHaveLength(1);
    const saved = await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith("vppsone:inbox:"))!)!);
    expect(saved).not.toContain("Synthetic child");
    await expect.poll(() => bodies.length, { timeout: 15_000 }).toBeGreaterThan(0);
    const command = bodies[0].commandId;
    acknowledge = true; await page.reload();
    await expect.poll(() => keys(page)).toHaveLength(0);
    expect(bodies.length).toBeGreaterThan(1);
    expect(bodies.every(b => b.commandId === command)).toBe(true);
    expect(bodies.every(b => JSON.stringify(b.scope) === JSON.stringify({ accountId: "qa-account", sessionLabel: "QA-2026", day: "2026-10-11" }))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
test("Undo in another tab restores the visible item and prevents sending", async ({ page, context }) => {
  let sends = 0;
  await page.clock.install({ time: new Date("2026-10-11T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-11T00:00:01Z"));
  await context.route("**/api/inbox", async route => { sends++; await route.fulfill({ status: 200, body: '{"ok":true}' }); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?view=inbox"); const other = await context.newPage();
  await other.clock.install({ time: new Date("2026-10-11T00:00:00Z") });
  await other.clock.pauseAt(new Date("2026-10-11T00:00:01Z"));
  await other.goto("/?view=inbox");
  await decide(page, 1440, "en"); await expect.poll(() => keys(page)).toHaveLength(1);
  await other.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("vppsone:inbox:")) localStorage.removeItem(k); });
  await expect(page.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
  await page.clock.runFor(6200); await other.clock.runFor(6200); expect(sends).toBe(0);
});
