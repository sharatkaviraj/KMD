import { expect, test } from "@playwright/test";
for (const width of [320, 390, 1180, 1440]) {
  test(`selection, edit, review, receipt and next collection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /TEST Child A/ }).click();
    const amount = page.locator("#pd-amount"); await expect(amount).toBeVisible(); await amount.fill("500");
    await page.locator("#pd-concession").fill("200"); await page.locator("#pd-received-by").fill("TEST Other Cashier");
    await page.getByRole("button", { name: "Review payment" }).click();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot().receiptCount)).toBe(0);
    await expect(page.locator("#pd-review-title")).toBeVisible(); await expect(page.getByText("TEST Other Cashier", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Back —/ }).click(); await expect(amount).toHaveValue("500");
    await page.getByRole("button", { name: "Review payment" }).click(); await page.getByRole("button", { name: /Confirm and save payment/ }).click();
    await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toMatchObject({ receiptCount: 1, posted: { amount: 500, quickDiscountAmount: 200, receivedBy: "TEST Other Cashier" } });
    await page.locator(".anim-print-out").evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/payment-saved-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Collect for another student" }).click(); await page.getByRole("button", { name: /TEST Child B/ }).click(); await expect(amount).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/payment-entry-${width}.png`, fullPage: true });
  });
}

test("lost save survives switching student and reload without a second receipt at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?lost&uncertain", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /TEST Child A/ }).click();
  await page.locator("#pd-amount").fill("500");
  await page.locator("#pd-received-by").fill("TEST Recovery Cashier");
  await page.getByRole("button", { name: "Review payment" }).click();
  await page.getByRole("button", { name: /Confirm and save payment/ }).click();
  await expect(page.getByRole("button", { name: "Check whether it was saved" })).toBeVisible();
  const original = await page.evaluate(() => window.paymentFixtureSnapshot().posted);
  await page.getByPlaceholder("Search another student").fill("TEST Child B");
  await page.getByRole("button", { name: /TEST Child B/ }).click();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /TEST Child A/ }).click();
  await expect(page.getByRole("button", { name: "Check whether it was saved" })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("qa-payment-check", "yes"));
  await page.getByRole("button", { name: "Check whether it was saved" }).click();
  await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toEqual({ posted: original, receiptCount: 1 });
});

test("mobile bulk entry is visible only with bulk permission", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?role=fee_collector", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "Enter many payments" })).toHaveCount(0);
  await page.goto("/?role=admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("link", { name: "Enter many payments", exact: true }).last()).toBeVisible();
});

test("a second tab cannot replace an unresolved request", async ({ page, context }) => {
  const second = await context.newPage();
  await page.goto("/?lost&uncertain", { waitUntil: "domcontentloaded" });
  await second.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /TEST Child A/ }).click();
  await second.getByRole("button", { name: /TEST Child B/ }).click();
  await page.locator("#pd-amount").fill("500"); await second.locator("#pd-amount").fill("900");
  await page.getByRole("button", { name: "Review payment" }).click();
  await second.getByRole("button", { name: "Review payment" }).click();
  await page.getByRole("button", { name: /Confirm and save payment/ }).click();
  await expect(page.getByRole("button", { name: "Check whether it was saved" })).toBeVisible();
  const original = await page.evaluate(() => window.paymentFixtureSnapshot().posted);
  await second.getByRole("button", { name: /Confirm and save payment/ }).click();
  await expect(second.getByText("Another tab has an unfinished payment. Resolve that payment before collecting again.")).toBeVisible();
  expect(await second.evaluate(() => window.paymentFixtureSnapshot().receiptCount)).toBe(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /TEST Child A/ }).click();
  await page.evaluate(() => sessionStorage.setItem("qa-payment-check", "yes"));
  await page.getByRole("button", { name: "Check whether it was saved" }).click();
  await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toEqual({ posted: original, receiptCount: 1 });
});
