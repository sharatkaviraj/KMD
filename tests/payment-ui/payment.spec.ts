import { expect, test } from "@playwright/test";
for (const width of [320, 390, 1180, 1440]) {
  test(`selection, edit, review, receipt and next collection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /TEST Child A/ }).click();
    const amount = page.locator("#pd-amount"); await expect(amount).toBeVisible(); await amount.fill("500");
    await page.locator("#pd-concession").fill("200"); await page.locator("#pd-received-by").fill("TEST Other Cashier");
    await page.getByRole("button", { name: "Review payment" }).click();
    await expect(page.locator("#pd-review-title")).toBeVisible(); await expect(page.getByText("TEST Other Cashier", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Back —/ }).click(); await expect(amount).toHaveValue("500");
    await page.getByRole("button", { name: "Review payment" }).click(); await page.getByRole("button", { name: /Confirm and save payment/ }).click();
    await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `test-results/payment-saved-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: /Collect another/ }).click(); await page.getByRole("button", { name: /TEST Child B/ }).click(); await expect(amount).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/payment-entry-${width}.png`, fullPage: true });
  });
}
