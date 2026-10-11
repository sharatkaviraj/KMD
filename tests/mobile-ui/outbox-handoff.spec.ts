import { expect, test } from "@playwright/test";
test.setTimeout(60_000);
for (const width of [390, 1440]) for (const locale of ["en", "hi", "hi-en"]) {
  test(`manual outbox needs explicit confirmation: ${locale}/${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/?view=outbox&locale=${locale}`);
    const open = locale === "hi" ? "WhatsApp खोलें" : "Open WhatsApp";
    const confirm = locale === "hi" ? "मैंने भेज दिया" : "I sent it";
    const keep = locale === "hi" ? "भेजने की सूची में रखें" : "Keep in To send";
    const counters = page.getByLabel("Synthetic send counters");
    await page.getByRole("button", { name: open, exact: true }).click();
    await expect(counters).toHaveAttribute("data-status", "queued"); await expect(counters).toHaveAttribute("data-confirmed", "0");
    await expect(page.getByRole("link", { name: open, exact: true })).toHaveAttribute("href", "https://qa.invalid/handoff");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    await page.getByRole("button", { name: keep, exact: true }).click(); await expect(counters).toHaveAttribute("data-status", "queued");
    await page.getByRole("button", { name: open, exact: true }).click();
    await page.getByRole("button", { name: confirm, exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(counters).toHaveAttribute("data-status", "sent"); await expect(counters).toHaveAttribute("data-confirmed", "1");
    await expect(page.getByRole("button", { name: confirm, exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
