import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 844, height: 390 }]) {
  test(`selected cheque stays above actual phone navigation ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto("/?view=cheques&realnav&path=/accounts/books");
    await page.getByRole("checkbox", { name: "Select cheque 123450", exact: true }).tap();
    const action = page.getByRole("button", { name: /^Make a deposit slip \(/ });
    await action.scrollIntoViewIfNeeded();
    const geometry = await action.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const nav = document.querySelector("nav.vx-bottom")!.getBoundingClientRect();
      return { button: { top: rect.top, bottom: rect.bottom, height: rect.height }, nav: { top: nav.top, height: nav.height }, centerOwned: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)), gap: nav.top - rect.bottom };
    });
    await testInfo.attach("actual-nav-geometry", { body: JSON.stringify(geometry), contentType: "application/json" });
    expect(geometry.nav.height).toBe(99);
    expect(geometry.gap).toBeGreaterThanOrEqual(12);
    expect(geometry.button.height).toBeGreaterThanOrEqual(44);
    expect(geometry.centerOwned).toBe(true);
    await action.evaluate(button => button.addEventListener("click", event => { document.documentElement.dataset.qaDepositTrusted = String(event.isTrusted); }, { once: true }));
    await action.tap();
    await expect(page.getByRole("dialog", { name: /^Deposit slip DS-\d+$/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.qaDepositTrusted)).toBe("true");
    await page.getByRole("dialog", { name: /^Deposit slip DS-\d+$/ }).getByRole("button", { name: "Close", exact: true }).tap();
    await expect(page.getByRole("dialog", { name: /^Deposit slip DS-\d+$/ })).not.toBeVisible();
  });
}
