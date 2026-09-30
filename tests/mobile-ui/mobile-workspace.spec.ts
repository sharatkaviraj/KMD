import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [320, 360, 390, 430, 768, 1440]) {
  test(`layout wraps and preserves form targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Mobile workspace fixture" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    if (width < 768) {
      const controls = await page.locator('main button, main input, main select, main textarea, nav a, nav button').evaluateAll(elements => elements.filter(element => element.getClientRects().length > 0).map(element => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") ?? element.textContent, width: rect.width, height: rect.height };
      }));
      expect(controls.filter(control => control.width < 44 || control.height < 44)).toEqual([]);
    }
    await page.locator("#last-row").scrollIntoViewIfNeeded();
    const last = await page.locator("#last-row").boundingBox();
    const nav = await page.locator("nav").boundingBox();
    expect(last!.y + last!.height).toBeLessThanOrEqual(nav?.y ?? 800);
  });
}

for (const locale of ["en", "hi", "hi-en"]) {
  for (const theme of ["light", "dark"]) {
    test(`shared mobile UI has no axe violations in ${locale}/${theme}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/?locale=${locale}&theme=${theme}`);
      await expect(page.getByRole("heading", { name: "Mobile workspace fixture" })).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations).toEqual([]);
      await page.getByRole("button", { name: "Open task sheet" }).click();
      await expect(page.getByRole("dialog", { name: "Task sheet" })).toBeVisible();
      expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    });
  }
}

test("sheet contains focus, locks the real scroller and restores it on dismissal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open task sheet" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Task sheet" });
  await expect(dialog).toBeVisible();
  expect(await page.locator("main").evaluate(element => getComputedStyle(element).overflowY)).toBe("hidden");
  expect(await page.locator("#root").evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await page.getByRole("button", { name: "Finish task" }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Finish task" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(await page.locator("#root").evaluate(element => (element as HTMLElement).inert)).toBe(false);
  expect(await page.locator("main").evaluate(element => getComputedStyle(element).overflowY)).toBe("auto");
});

test("nested sheets dismiss only the top dialog and restore parent focus", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open task sheet" }).click();
  await page.getByRole("button", { name: "Open nested sheet" }).click();
  await expect(page.getByRole("dialog", { name: "Nested task" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Nested task" })).not.toBeVisible();
  await expect(page.getByRole("dialog", { name: "Task sheet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open nested sheet" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

for (const role of ["teacher", "office", "accountant", "admin", "academic_coordinator", "exam_coordinator", "view_only", "fee_collector"]) {
  test(`More retains ${role}'s authorized workspace and accessible dismissal`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/?role=${role}&path=${role === "teacher" ? "/teach" : "/dashboard"}`);
    const more = page.getByRole("button", { name: "More", exact: false });
    await more.click();
    const dialog = page.getByRole("dialog", { name: "More", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('a[href="/preferences"]')).toBeVisible();
    if (["teacher", "academic_coordinator", "exam_coordinator", "view_only"].includes(role)) {
      expect(await dialog.locator('a[href^="/fees/"]').count()).toBe(0);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(more).toBeFocused();
  });
}

test("reduced motion and 200 percent text remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  await page.getByRole("button", { name: "Open task sheet" }).click();
  const dialog = page.getByRole("dialog", { name: "Task sheet" });
  expect(await dialog.locator(".anim-sheet-enter").evaluate(element => getComputedStyle(element).animationName)).toBe("none");
  await page.getByRole("button", { name: "Finish task" }).click();
  await expect(dialog).not.toBeVisible();
});
