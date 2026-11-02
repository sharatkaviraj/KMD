import { expect, test, type Locator } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { pickerStudents } from "./picker-fixtures";

async function textFits(element: Locator) {
  return element.evaluate(node => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = node.getBoundingClientRect();
    const row = node.closest(".pd-row")!.getBoundingClientRect();
    const rects = [...range.getClientRects()];
    return { width: box.width, fits: rects.length > 0 && rects.every(r => r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1 && r.left >= row.left && r.right <= row.right) };
  });
}

for (const lang of ["en", "hi"]) for (const width of [320, 360, 390, 412, 1440]) {
  test(`picker text remains visible and selects the bound pupil: ${lang} ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 647 });
    await page.goto(`/?picker&lang=${lang}`);
    await page.locator('.pd-sr input').fill("Te");
    const rows = page.locator(".pd-row");
    await expect(rows).toHaveCount(4);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined)));
    });
    const geometry = await rows.evaluateAll(nodes => nodes.map(node => {
      const identity = node.querySelector(".pd-c")!;
      const money = node.querySelector(".pd-end")!;
      return { text: identity.textContent, rowWidth: node.getBoundingClientRect().width, identityWidth: identity.getBoundingClientRect().width, moneyWidth: money.getBoundingClientRect().width, moneyFlexShrink: getComputedStyle(money).flexShrink };
    }));
    await page.screenshot({ path: info.outputPath("picker.png"), fullPage: true });
    await writeFile(info.outputPath("geometry.json"), JSON.stringify(geometry, null, 2));
    await info.attach("picker-geometry", { contentType: "application/json", path: info.outputPath("geometry.json") });
    await page.screenshot({ path: `test-results/picker-${lang}-${width}-${info.project.name}.png`, fullPage: true });
    for (const s of pickerStudents) {
      const row = rows.filter({ hasText: s.sr });
      const name = row.locator(".pd-c > span").first();
      const metadata = row.locator(".pd-c > span").nth(1);
      await expect(name).toHaveText(s.name);
      await expect(metadata).toContainText("Class 7");
      expect(await textFits(name), s.name).toMatchObject({ fits: true });
      expect((await textFits(name)).width).toBeGreaterThan(100);
      expect(await textFits(metadata), s.sr).toMatchObject({ fits: true });
      for (const financialText of await row.locator(".pd-end > span").all()) expect(await textFits(financialText)).toMatchObject({ fits: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/picker-${lang}-${width}-${info.project.name}.png`, fullPage: true });
    for (const s of pickerStudents) {
      await rows.filter({ hasText: s.sr }).click();
      await expect.poll(() => page.evaluate(() => window.paymentFixtureSelectedStudent())).toBe(s.id);
      await expect(page.getByText(s.name, { exact: true }).filter({ visible: true }).first()).toBeVisible();
      if (width < 900) await page.locator(".pd-phb").click();
      await page.locator('.pd-sr input').fill("Te");
    }
    expect(await page.evaluate(() => window.paymentFixtureSnapshot().receiptCount)).toBe(0);
  });
}
