import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

async function geometry(page: Page) {
  return page.locator('nav[aria-label="Primary navigation"]').evaluate(nav => {
    const box = nav.getBoundingClientRect();
    const css = getComputedStyle(nav);
    const visibleBottom = Math.min(innerHeight, (visualViewport?.height ?? innerHeight) + (visualViewport?.offsetTop ?? 0));
    const safeBottom = Math.min(box.bottom - parseFloat(css.paddingBottom), visibleBottom - 16);
    const labels = [...nav.querySelectorAll("a > span.clip")].map(label => {
      const range = document.createRange(); range.selectNodeContents(label);
      const rect = range.getBoundingClientRect();
      return { text: label.textContent, top: rect.top, bottom: rect.bottom, within: rect.top >= box.top && rect.bottom <= safeBottom + 1 };
    });
    return { nav: { top: box.top, bottom: box.bottom, height: box.height, paddingBottom: css.paddingBottom }, viewport: { height: innerHeight, visualHeight: visualViewport?.height, scrollY, width: innerWidth, documentWidth: document.documentElement.scrollWidth }, labels };
  });
}

test("receipt navigation stays in the visible viewport when browser chrome covers the layout bottom", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 647 });
  await page.goto("/receipts");
  await page.getByRole("link").filter({ hasText: "SYNTHETIC-R1" }).filter({ visible: true }).first().click();
  // A manufactured visual/layout mismatch, not a claim of Android device reproduction.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, get: () => 607 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--keyboard-offset"))).toBe("40px");
  await page.screenshot({ path: info.outputPath("viewport-gap.png") });
  const sample = await geometry(page);
  await writeFile(info.outputPath("geometry.json"), JSON.stringify(sample, null, 2));
  expect(sample.nav.bottom).toBeLessThanOrEqual(607);
  expect(sample.labels.every(label => label.within)).toBe(true);
  await page.goBack();
  expect((await geometry(page)).labels.every(label => label.within)).toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, "height", { configurable: true, get: () => 647 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await expect.poll(async () => (await geometry(page)).nav.bottom).toBe(647);
});

for (const lang of ["en", "hi"]) for (const viewport of [{ width: 360, height: 647 }, { width: 647, height: 360 }, { width: 412, height: 797 }]) {
  test(`receipt list, detail and repeated back keep navigation visible: ${lang} ${viewport.width}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await page.goto(`/receipts?lang=${lang}`);
    await page.evaluate(() => document.fonts.ready);
    const samples = [];
    for (let i = 0; i < 3; i++) {
      await page.getByRole("link").filter({ hasText: "SYNTHETIC-R1" }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(/\/receipts\/SYNTHETIC-R1/);
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      samples.push(await geometry(page));
      expect(samples.at(-1)?.labels.every(label => label.within)).toBe(true);
      expect(samples.at(-1)?.nav.bottom).toBeLessThanOrEqual(viewport.height);
      await page.goBack();
      samples.push(await geometry(page));
      expect(samples.at(-1)?.labels.every(label => label.within)).toBe(true);
    }
    await page.screenshot({ path: info.outputPath("navigation.png"), fullPage: true });
    await writeFile(info.outputPath("geometry.json"), JSON.stringify(samples, null, 2));
  });
}
