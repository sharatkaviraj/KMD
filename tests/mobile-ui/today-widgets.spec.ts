import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/*
 * Today's widget family (7 Nov 2026): Birthdays today, Coming up, the closed
 * day, and the real session's money drawn with the rehearsal session's cards.
 * Synthetic fixture states only; no school data.
 */
test.setTimeout(60_000);

const visible = (page: import("@playwright/test").Page, text: string | RegExp) => page.getByText(text).filter({ visible: true }).first();

for (const width of [320, 390]) {
  test(`birthdays and coming up fit a phone (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/?view=today&locale=en");
    await expect(visible(page, "Birthdays today")).toBeVisible();
    await expect(page.getByRole("link", { name: /Test Child One/ }).filter({ visible: true })).toHaveAttribute("href", "/students/00000000-0000-4000-8000-000000000b01");
    await expect(visible(page, "Coming up")).toBeVisible();
    await expect(visible(page, "Test unit exams")).toBeVisible();
    await expect(visible(page, "Exams · 26–31 Oct")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}

test("a closed day says why and when school opens, and drops the empty day cards on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=today&locale=en&closed=1");
  await expect(visible(page, "Test break")).toBeVisible();
  await expect(visible(page, /School opens Thu 15 Oct · in 3 days/)).toBeVisible();
  // Nothing on the timeline and no register to mark: the hero has said it already.
  await expect(page.getByRole("heading", { name: "Today at school" }).filter({ visible: true })).toHaveCount(0);
  await expect(page.getByText("Teachers away").filter({ visible: true })).toHaveCount(0);
});

test("a closed day on a desk carries the same line under the greeting", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?view=today&locale=hi&closed=1");
  await expect(page.getByRole("status").filter({ hasText: "टेस्ट अवकाश" })).toBeVisible();
});

test("the real session's money draws the year's pace and the calls, as the rehearsal session does", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=today&locale=en&ledger=1");
  await expect(visible(page, "₹12,800")).toBeVisible();
  await expect(visible(page, /7 receipts · UPI 5 · Cash 2 · as of/)).toBeVisible();
  await expect(visible(page, "6 families to call today")).toBeVisible();
  await expect(visible(page, "Fees this session")).toBeVisible();
});

for (const theme of ["light", "dark"]) {
  test(`the widgets pass an accessibility scan: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?view=today&locale=hi-en&theme=${theme}`);
    await expect(visible(page, /Birthdays today|आज जन्मदिन/)).toBeVisible();
    const scan = await new AxeBuilder({ page }).include(".td-widget").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations).toEqual([]);
  });
}
