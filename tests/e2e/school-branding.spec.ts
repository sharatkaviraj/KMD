import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { openAs } from "./support/harness";

test("admin navigation stays native across fees, collection and timetable", async ({ page, browser }) => {
  await openAs(page, browser, "admin", "/dashboard");
  await expect(page.locator("[data-school-welcome]")).toContainText("Veer Patta Public School");
  const workspaces = page.locator('[aria-labelledby="admin-workspaces"]');
  for (const href of ["/fees", "/collection", "/timetable", "/students"]) {
    await expect(workspaces.locator(`a[href="${href}"]`)).toHaveCount(1);
  }
  const links = await workspaces.locator("a").evaluateAll(elements => elements.map(element => element.getAttribute("href")));
  expect(links.every(href => href?.startsWith("/") && !href.startsWith("//"))).toBe(true);
  await workspaces.locator('a[href="/fees"]').click();
  await expect(page).toHaveURL(/\/fees\/dashboard(?:\?|$)/);
  await page.goto("/collection");
  await expect(page).toHaveURL(/\/collection(?:\?|$)/);
  await page.goto("/timetable");
  await expect(page).toHaveURL(/\/timetable(?:\?|$)/);
  await page.goto("/preferences");
  const starts = await page.locator('input[name="start"]').evaluateAll(elements => elements.map(element => element.getAttribute("value")));
  expect(starts.length).toBeGreaterThan(1);
  expect(starts.every(value => value === "" || (value?.startsWith("/") && !value.startsWith("//")))).toBe(true);
});

test("an old Apps bookmark opens the role home", async ({ page, browser }) => {
  await openAs(page, browser, "admin", "/apps");
  await expect(page).toHaveURL(/\/dashboard$/);
});

for (const width of [390, 1440]) {
  test(`school sign-in identity at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/login");
    await expect(page.locator('input[name="email"]')).toBeVisible();
    await expect(page.locator('img[alt="Veer Patta Public School logo"]').first()).toBeVisible();
    await expect(page.locator('[data-school-welcome] img[alt*="campus"]')).toHaveCount(0);
    await expect(page.locator("main")).toContainText(/Install on your phone or computer|अपने फ़ोन या कंप्यूटर पर लगाएँ/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    const scan = await new AxeBuilder({ page }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations).toEqual([]);
    await page.screenshot({ path: `test-results/school-branding-login-${width}.png`, fullPage: true, scale: "css" });
  });

  test(`school welcome keeps its logo and theme without photos at ${width}px`, async ({ page, browser }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openAs(page, browser, "admin", "/dashboard");
    const banner = page.locator("[data-school-welcome]");
    await expect(banner).toBeVisible();
    await expect(banner.locator('img[alt*="campus"]')).toHaveCount(0);
    await expect(banner.locator('img[alt="Veer Patta Public School logo"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.screenshot({ path: `test-results/school-branding-admin-${width}.png`, fullPage: true, scale: "css" });
    const workspaces = page.locator('[aria-labelledby="admin-workspaces"]');
    await workspaces.scrollIntoViewIfNeeded();
    await expect(workspaces.locator('a[href="/fees"]')).toBeVisible();
    await page.screenshot({ path: `test-results/school-branding-workspaces-${width}.png`, fullPage: true, scale: "css" });
  });
}
