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
  // The phone list is the design's cards (F05): no ticks; each card swipes left for Call · WhatsApp · Collect.
  test(`Fees list controls fit touch phone at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(list);
    const child = page.getByRole("link", { name: "QA Admin Child", exact: true }).filter({ visible: true });
    await expect(child).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await expect(page.getByRole("checkbox", { name: "Select QA Admin Child", exact: true }).filter({ visible: true })).toHaveCount(0);
    // The cards, the search box and the list's buttons (export, pages); chips and the view switch are the kit's own sizes.
    const inView = await page.locator("main").locator(".stu-mcard, input[type=search], .btn").evaluateAll(elements => elements.filter(element => {
      const r = element.getBoundingClientRect();
      return element.getClientRects().length > 0 && r.right > 0 && r.left < innerWidth && !element.closest(".stu-acts");
    }).map(element => {
      const r = element.getBoundingClientRect(); return { label: element.getAttribute("aria-label") ?? element.textContent, left: r.left, right: r.right, width: r.width, height: r.height };
    }));
    expect(inView.filter(control => control.left < -1 || control.right > viewport.width + 1 || control.width < 44 || control.height < 44)).toEqual([]);
    // Swiped open, the first card's actions are on screen and thumb-sized.
    const swipe = page.locator(".stu-swipe").first();
    await swipe.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    const collect = swipe.getByRole("link", { name: "Collect fee from QA Admin Child" });
    const box = (await collect.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
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
  // The phone's Filter sheet (UI-94): class, fee filters, order and layout, applied together.
  test(`phone Filter sheet combines filters and changes the layout at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(list);
    await page.getByRole("button", { name: "Filter and sort · 2 on", exact: true }).tap();
    const sheet = page.getByRole("dialog", { name: "Filter and view" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("radio", { name: "QA Class", exact: true })).toHaveAttribute("aria-checked", "true");
    // Nothing changes until Show: the list stays as it was under the sheet.
    await sheet.getByRole("button", { name: /^Late fee pending/ }).tap();
    await sheet.getByRole("radio", { name: "Compact", exact: true }).tap();
    await expect(page).toHaveURL(/seg=pending&/);
    await sheet.getByRole("button", { name: "Show students", exact: true }).tap();
    // URLSearchParams may encode the CSV comma; assert the exact filter value.
    await expect(page).toHaveURL(url => url.searchParams.get("seg") === "pending,late");
    await expect(page).toHaveURL(/look=compact/);
    // Two filters on: neither quick chip is lit, and each has its own remove chip.
    await expect(page.getByRole("link", { name: "Late fee pending · remove", exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Pending today · remove", exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.locator(".stu-crow").first()).toBeVisible();
    await expect(page.locator(".stu-mcard").filter({ visible: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    // Removing one filter keeps the other and the layout.
    await page.getByRole("link", { name: "Late fee pending · remove", exact: true }).filter({ visible: true }).tap();
    await expect(page).toHaveURL(/seg=pending&look=compact/);
    // By class groups under a heading per class.
    await page.getByRole("button", { name: "Filter and sort · 2 on", exact: true }).tap();
    await sheet.getByRole("radio", { name: "By class", exact: true }).tap();
    await sheet.getByRole("button", { name: "Show students", exact: true }).tap();
    await expect(page).toHaveURL(/look=class/);
    await expect(page.getByRole("region", { name: "QA Class" }).filter({ visible: true })).toBeVisible();
  });
}
// On a desk the rows are ticked and the design's floating bulk bar acts on them (D01).
test("desk bulk bar: ticked rows, readable reminder, clear", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(list);
  await page.getByRole("checkbox", { name: "Select QA Admin Child", exact: true }).tap();
  const selected = page.getByRole("toolbar", { name: /selected/ });
  await expect(selected).toBeVisible();
  // The design's desk bar: 36px buttons, all on screen. Layout pixels, so a touch emulator's zoom does not count.
  const controls = await selected.locator("a,button").evaluateAll(elements => elements.map(element => {
    const r = element.getBoundingClientRect(); const e = element as HTMLElement;
    return { left: r.left, right: r.right, width: e.offsetWidth, height: e.offsetHeight, inView: r.left >= 0 && r.right <= document.documentElement.clientWidth };
  }));
  expect(controls.filter(control => !control.inView || control.width < 36 || control.height < 36)).toEqual([]);
  // The reminder's tint is translucent: composite it over the bar before measuring.
  const reminderContrast = await selected.locator("a").first().evaluate(element => {
    const rgba = (color: string) => { const v = (color.match(/[\d.]+/g) ?? []).map(Number); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
    const bar = rgba(getComputedStyle(element.parentElement!).backgroundColor);
    const tint = rgba(getComputedStyle(element).backgroundColor);
    const bg = { r: tint.r * tint.a + bar.r * (1 - tint.a), g: tint.g * tint.a + bar.g * (1 - tint.a), b: tint.b * tint.a + bar.b * (1 - tint.a) };
    const lum = (c: { r: number; g: number; b: number }) => [c.r, c.g, c.b].map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    const foreground = lum(rgba(getComputedStyle(element).color)); const background = lum(bg);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(reminderContrast).toBeGreaterThanOrEqual(3);
  await page.getByRole("button", { name: "Clear selection" }).tap();
  await expect(selected).toHaveCount(0);
});

test("profile rejects an external return URL", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/students/${id}?returnTo=${encodeURIComponent("https://example.invalid/students?q=QA")}`);
  await expect(page.getByRole("link", { name: "Back", exact: true })).toHaveAttribute("href", "/students");
});
