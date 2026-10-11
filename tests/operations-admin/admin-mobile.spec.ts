import { expect, test } from "@playwright/test";
test.setTimeout(120_000);
const list = "/students?q=QA&class=qa-class&view=fees&seg=pending&page=2";
const id = "00000000-0000-4000-8000-000000000101";
for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 844, height: 390 }]) {
  test(`profile return keeps list filters after reload at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(list);
    await page.getByRole("link", { name: "QA Admin Child", exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`/students/${id}`));
    // The list context is a real link parameter, surviving a fresh profile load.
    await expect(page).toHaveURL(/returnTo=/);
    await page.getByRole("link", { name: "Fees", exact: true }).tap();
    await expect(page).toHaveURL(/returnTo=/);
    await page.reload();
    // No assumption about a list in this browser's trail: exercise the safe fallback.
    await page.evaluate(() => sessionStorage.clear());
    await page.getByRole("link", { name: "Back", exact: true }).tap();
    await expect(page).toHaveURL(new RegExp(`${list.replace(/[?]/g, "\\?")}$`));
  });
  test(`Fees list controls fit touch phone at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(list);
    await expect(page.getByRole("link", { name: "QA Admin Child", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByRole("checkbox", { name: "Select QA Admin Child", exact: true }).tap();
    const selected = page.getByRole("region", { name: /selected/ });
    await expect(selected).toBeVisible();
    const controls = await selected.locator("a,button").evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect(); return { label: element.getAttribute("aria-label") ?? element.textContent,
        left: r.left, right: r.right, width: r.width, height: r.height };
    }));
    expect(controls.filter(control => control.left < 0 || control.right > viewport.width || control.width < 44 || control.height < 44)).toEqual([]);
    const reminderContrast = await selected.locator("a").first().evaluate(element => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => (color.match(/[\d.]+/g) ?? []).slice(0, 3)
        .map(Number).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
      const foreground = luminance(style.color); const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(reminderContrast).toBeGreaterThanOrEqual(3);
    await page.getByRole("button", { name: "Clear selection" }).tap();
    await expect(selected).toHaveCount(0);
  });
  test(`classic Fees list bulk actions fit touch phone at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/fees/students?screen=classic");
    await expect(page.getByRole("heading", { name: "Synthetic classic Fees list actions" })).toBeVisible();
    const controls = await page.getByRole("button").evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => {
      const r = element.getBoundingClientRect(); return { label: element.textContent, left: r.left, right: r.right, width: r.width, height: r.height };
    }));
    expect(controls.filter(control => control.left < 0 || control.right > viewport.width || control.width < 44 || control.height < 44)).toEqual([]);
    await page.getByRole("button", { name: "Clear", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Bulk edit.", exact: true })).toHaveCount(0);
  });
}
test("profile rejects an external return URL", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/students/${id}?returnTo=${encodeURIComponent("https://example.invalid/students?q=QA")}`);
  await expect(page.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", "/students");
});
