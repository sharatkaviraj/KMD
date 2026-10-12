import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A cold vx-screen import compiles the shared icon and primitive modules.
test.setTimeout(60_000);

const card = (page: import("@playwright/test").Page) => page.locator(".card", { hasText: /Scheduled now|अभी निर्धारित/ }).first();
const shownRows = (page: import("@playwright/test").Page) => card(page).locator("li").evaluateAll((rows) => rows.filter((row) => row.getClientRects().length).length);

for (const width of [320, 360, 390]) for (const locale of ["en", "hi", "hi-en"]) {
  test(`Scheduled now fits a phone: one period, folded: ${locale}/${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/?view=today&locale=${locale}`);
    await expect(card(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    // Before: Now and Next stacked in full, 916px at 390. One screen at most now.
    expect((await card(page).boundingBox())!.height).toBeLessThan(640);
    expect(await card(page).locator("section").evaluateAll((all) => all.filter((s) => s.getClientRects().length).length)).toBe(1);
    expect(await shownRows(page)).toBe(5);
    // The two cover changes in the fixture are folded in, not left below the fold.
    await expect(card(page).getByText(/Needs a substitute|स्थानापन्न चाहिए/).first()).toBeVisible();
  });
}

test("the Now/Next switch and Show all work on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=today&locale=en");
  await card(page).getByRole("radio", { name: /Next/ }).click();
  await expect(card(page).locator("section:visible")).toHaveAttribute("aria-label", /^Next · Period 5/);
  const more = card(page).getByRole("button", { name: "Show all 22 classes" });
  await expect(more).toHaveAttribute("aria-expanded", "false");
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await more.click();
  expect(await shownRows(page)).toBe(20);
  await card(page).getByRole("button", { name: "Show fewer" }).click();
  expect(await shownRows(page)).toBe(5);
  await card(page).getByRole("radio", { name: /Now/ }).click();
  await expect(card(page).locator("section:visible")).toHaveAttribute("aria-label", /^Now · Period 4/);
});

test("a desktop still shows Now and Next side by side, in full", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?view=today&locale=en");
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByRole("radiogroup")).toBeHidden();
  await expect(card(page).getByRole("button", { name: /Show all/ })).toBeHidden();
  expect(await card(page).locator("section").evaluateAll((all) => all.filter((s) => s.getClientRects().length).length)).toBe(2);
  expect(await shownRows(page)).toBe(40);
});

for (const theme of ["light", "dark"]) {
  test(`Scheduled now accessibility on a phone: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?view=today&locale=hi-en&theme=${theme}`);
    await expect(card(page)).toBeVisible();
    const scan = await new AxeBuilder({ page }).include(".card:has(.sched-scroll)").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations).toEqual([]);
  });
}
