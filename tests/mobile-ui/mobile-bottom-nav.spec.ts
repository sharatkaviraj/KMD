import { expect, test } from "@playwright/test";

for (const locale of ["en", "hi", "hi-en"]) {
  for (const viewport of [{ width: 320, height: 800 }, { width: 390, height: 844 }, { width: 740, height: 360 }]) {
    for (const textScale of [100, 200]) {
      test(`bottom tabs are symmetric and readable: ${locale}, ${viewport.width}px, ${textScale}% text`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto(`/?role=admin&locale=${locale}&path=/dashboard`);
        if (textScale === 200) await page.addStyleTag({ content: "html { font-size: 200%; }" });
        const nav = page.getByRole("navigation");
        await expect(nav).toBeVisible();
        await expect.poll(async () => nav.evaluate(element => {
          const offset = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--mobile-bottom-nav-offset"));
          return Math.abs(offset - element.getBoundingClientRect().height);
        })).toBeLessThanOrEqual(1);
        const geometry = await nav.locator(":scope > div > a, :scope > div > button").evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect();
          const icon = element.querySelector<HTMLElement>(":scope > span:first-child")!;
          const label = element.querySelector<HTMLElement>(":scope > span:last-child")!;
          const iconRect = icon.getBoundingClientRect();
          const labelRect = label.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(label);
          const textRects = Array.from(range.getClientRects());
          const labelStyle = getComputedStyle(label);
          return {
            x: rect.x, width: rect.width, height: rect.height,
            iconWidth: iconRect.width,
            iconCenter: iconRect.x + iconRect.width / 2,
            tabCenter: rect.x + rect.width / 2,
            labelCenter: labelRect.x + labelRect.width / 2,
            textFits: textRects.every(text => text.left >= labelRect.left - 1 && text.right <= labelRect.right + 1 && text.top >= labelRect.top - 1 && text.bottom <= labelRect.bottom + 1),
            labelFits: labelRect.right <= rect.right + 1 && labelRect.bottom <= rect.bottom + 1,
            textAlign: labelStyle.textAlign,
            overflow: labelStyle.overflow,
            textOverflow: labelStyle.textOverflow,
          };
        }));
        expect(geometry).toHaveLength(5);
        expect(Math.max(...geometry.map(tab => tab.width)) - Math.min(...geometry.map(tab => tab.width))).toBeLessThan(1);
        expect(Math.max(...geometry.map(tab => tab.iconWidth)) - Math.min(...geometry.map(tab => tab.iconWidth))).toBeLessThan(1);
        expect(Math.max(...geometry.map(tab => tab.height)) - Math.min(...geometry.map(tab => tab.height))).toBeLessThan(1);
        for (const tab of geometry) {
          expect(tab.width).toBeGreaterThanOrEqual(44);
          expect(tab.height).toBeGreaterThanOrEqual(44);
          expect(tab.textFits).toBe(true);
          expect(tab.labelFits).toBe(true);
          expect(tab.textAlign).toBe("center");
          expect(tab.overflow).not.toBe("hidden");
          expect(tab.textOverflow).not.toBe("ellipsis");
          if (viewport.height > viewport.width) {
            expect(Math.abs(tab.iconCenter - tab.tabCenter)).toBeLessThan(1);
            expect(Math.abs(tab.labelCenter - tab.tabCenter)).toBeLessThan(1);
          }
        }
        const gaps = geometry.slice(1).map((tab, index) => tab.x - geometry[index].x - geometry[index].width);
        expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
        await page.locator("main").evaluate(element => { element.scrollTop = element.scrollHeight; });
        const last = await page.locator("#last-row").boundingBox();
        const bar = await nav.boundingBox();
        expect(last!.y + last!.height).toBeLessThanOrEqual(bar!.y + 1);
      });
    }
  }
}

test("press feedback preserves tab geometry and respects reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?role=admin&path=/dashboard");
  const more = page.getByRole("navigation").getByRole("button");
  const before = await more.boundingBox();
  await more.hover();
  await page.mouse.down();
  await page.waitForTimeout(250);
  expect(await more.boundingBox()).toEqual(before);
  const icon = more.locator(":scope > span:first-child");
  expect(await icon.evaluate(element => getComputedStyle(element).transform)).not.toBe("none");
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await more.hover();
  await page.mouse.down();
  expect(await icon.evaluate(element => getComputedStyle(element).transform)).toBe("none");
  expect(await icon.evaluate(element => Math.max(...getComputedStyle(element).transitionDuration.split(",").map(value => Number.parseFloat(value))))).toBeLessThanOrEqual(0.00001);
  await page.mouse.move(0, 0);
  await page.mouse.up();
});

test("measured clearance resets on tablet and restores on phone", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/?role=admin&locale=hi-en");
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset"))).not.toBe("");
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset"))).toBe("");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--mobile-bottom-nav-offset"))).not.toBe("");
});
