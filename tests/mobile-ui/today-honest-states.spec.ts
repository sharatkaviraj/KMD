import { expect, test } from "@playwright/test";

/*
 * Review T02/T03: a read that failed is never shown as nought or "All clear".
 * Synthetic fixture states only; no school data.
 */
test.setTimeout(60_000);

for (const width of [390, 1280]) {
  test(`an empty queue that was read in full is All clear (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=today&locale=en");
    await expect(page.getByText(/All clear/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/Could not read this just now/)).toHaveCount(0);
  });

  test(`a queue with an unread source never says All clear, and offers Try again (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/?view=today&locale=en&missing=refunds");
    await expect(page.getByText(/Could not read this just now\. It may not be empty\./).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(/All clear/)).toHaveCount(0);
    const retry = page.getByRole("button", { name: "Try again" }).filter({ visible: true }).first();
    const refreshed = page.evaluate(() => new Promise<boolean>((resolve) => window.addEventListener("qa:refresh", () => resolve(true), { once: true })));
    await retry.click();
    expect(await refreshed).toBe(true);
  });
}

test("an unread register says so instead of 'No changes to today's teaching'", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?view=today&locale=en&unread=board");
  await expect(page.getByText("No changes to today's teaching")).toHaveCount(0);
  await expect(page.getByText(/Could not read this just now/).filter({ visible: true }).first()).toBeVisible();
});

test("an unread approvals source shows a dash and the reason, not 0", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?view=today&locale=en&missing=submissions");
  const tile = page.locator("a, div", { hasText: /^Approvals/ }).filter({ hasText: "—" }).first();
  await expect(tile).toBeVisible();
  await expect(page.getByText("No student-data changes waiting")).toHaveCount(0);
});
