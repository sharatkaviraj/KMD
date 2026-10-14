import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A cold native-component import includes the existing Next/icon modules.
test.setTimeout(60_000);

// The admin's attention list: registers, absences, review, jobs. Corrections
// left it when they stopped needing an approval (D-248, #71).
const ADMIN_ITEMS = 4;

for (const width of [320, 390, 768, 1440]) for (const locale of ["en", "hi", "hi-en"]) {
  test(`native admin overview preserves content and gutters: ${locale}/${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=admin&locale=${locale}&long`);
    await expect(page.locator("[data-admin-overview] h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    expect(await page.locator("[data-attention-key]").count()).toBe(ADMIN_ITEMS);
    const tooSmall = await page.locator("main a, main summary").evaluateAll(links => links.filter(e => e.getClientRects().length).map(link => link.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44));
    expect(tooSmall).toEqual([]);
    const support = await page.locator("[data-admin-support]").boundingBox();
    const workspace = await page.locator('[aria-labelledby="admin-workspaces"]').boundingBox();
    if (width < 1024) expect(support!.y + support!.height).toBeLessThan(workspace!.y);
    else expect(Math.abs(support!.y - (await page.locator('[aria-labelledby="admin-attention"]').boundingBox())!.y)).toBeLessThan(2);
    const boxes = await page.locator('[aria-labelledby="admin-attention"], [data-admin-support], [aria-labelledby="admin-workspaces"]').evaluateAll(elements => elements.map(e => e.getBoundingClientRect().x));
    if (width < 1024) expect(new Set(boxes).size).toBe(1);
    await page.locator('[aria-labelledby="admin-workspaces"] a').first().focus();
    await expect(page.locator('[aria-labelledby="admin-workspaces"] a').first()).toBeFocused();
  });
}
for (const locale of ["en", "hi", "hi-en"]) for (const theme of ["light", "dark"]) {
  test(`native admin accessibility: ${locale}/${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?view=admin&locale=${locale}&theme=${theme}`);
    await expect(page.locator("h1")).toBeVisible();
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations).toEqual([]);
  });
}
test("native admin retains content at enlarged text with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?view=admin&locale=hi-en&long");
  await expect(page.locator("h1")).toBeVisible();
  await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>("[data-admin-overview] *")];
    const sizes = elements.map(element => parseFloat(getComputedStyle(element).fontSize));
    elements.forEach((element, index) => element.style.fontSize = `${sizes[index] * 2}px`);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  // The shared reduced-motion override uses a near-zero duration with !important.
  expect(await page.locator("[data-attention-key]").first().evaluate(e => parseFloat(getComputedStyle(e).transitionDuration))).toBeLessThanOrEqual(0.001);
  await page.locator("[data-all-screens] summary").click();
  await page.locator('[aria-labelledby="admin-destinations"] a').last().scrollIntoViewIfNeeded();
  await expect(page.locator('[aria-labelledby="admin-destinations"] a').last()).toBeVisible();
});

for (const state of ["empty", "error", "positive"]) for (const theme of ["light", "dark"]) {
  test(`native admin honest ${state} state and All screens keyboard: ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?view=admin&locale=hi-en&state=${state}&theme=${theme}`);
    const summary = page.locator("[data-all-screens] summary");
    const details = page.locator("[data-all-screens]");
    await expect(details).not.toHaveAttribute("open", "");
    await summary.focus();
    for (let index = 0; index < 3; index++) {
      await page.keyboard.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await page.keyboard.press("Tab");
      await expect(details.locator("a").first()).toBeFocused();
      await summary.focus();
      await page.keyboard.press("Space");
      await expect(details).not.toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
    }
    if (state === "empty") {
      await expect(page.locator('[data-attention-state="pending"]')).toHaveCount(0);
      await expect(page.locator('[data-attention-state="clear"]')).toHaveCount(ADMIN_ITEMS);
      await expect(page.locator('[data-overview-row="cover"]')).toContainText("No plan has been published");
    } else if (state === "error") {
      await expect(page.locator('[data-attention-key="jobs"]')).toContainText("could not");
      await expect(page.locator('[data-overview-row="cover"]')).not.toContainText("No plan has been published");
      await expect(page.locator('[data-overview-row="cover"]')).toContainText("could not");
    } else await expect(page.locator('[data-attention-state="pending"]')).toHaveCount(ADMIN_ITEMS);
    const scan = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
