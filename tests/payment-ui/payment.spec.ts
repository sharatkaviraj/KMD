import { expect, test } from "@playwright/test";

declare global { interface Window { recoveryFault: boolean; primaryFault: boolean } }
for (const width of [320, 390, 1180, 1440]) {
  test(`selection, edit, review, receipt and next collection at ${width}px`, async ({ page }, testInfo) => {
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
    await page.screenshot({ path: `test-results/payment-saved-${testInfo.project.name}-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Collect for another student" }).click(); await page.getByRole("button", { name: /TEST Child B/ }).click(); await expect(amount).toBeVisible();
    // Visibility does not imply opacity animation has completed (WebKit can
    // otherwise capture an empty entry pane during its first frame).
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity);
      await Promise.all(finite.map(animation => animation.finished.catch(() => undefined)));
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `test-results/payment-entry-${testInfo.project.name}-${width}.png`, fullPage: true });
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
  await page.getByRole("button", { name: "Search another student", exact: true }).click();
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

for (const fault of ["unsupported", "denied"] as const) {
  test(`390px ${fault} browser locking explains the block and can recover`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(kind => {
      const original = navigator.locks; window.recoveryFault = true;
      Object.defineProperty(navigator, "locks", { configurable: true, get: () => !window.recoveryFault ? original : kind === "unsupported" ? undefined : { request: () => Promise.reject(new DOMException("Synthetic denial", "SecurityError")) } });
    }, fault);
    await page.goto("/?selected", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Payment saving is paused because this browser/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Review payment" })).toBeDisabled();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot().receiptCount)).toBe(0);
    await page.evaluate(() => { window.recoveryFault = false; });
    await page.getByRole("button", { name: "Retry recovery" }).click();
    await expect(page.getByRole("button", { name: "Review payment" })).toBeEnabled();
    await page.locator("#pd-amount").fill("500");
    await page.getByRole("button", { name: "Review payment" }).click();
    await page.getByRole("button", { name: /Confirm and save payment/ }).click();
    await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot().receiptCount)).toBe(1);
  });
}

for (const fault of ["missing", "denied", "private-quota"] as const) {
  test(`390px ${fault} storage fails safely and Retry recovery preserves the entry`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(kind => {
      window.recoveryFault = true;
      if (kind !== "private-quota") {
        const primary = window.indexedDB; window.primaryFault = true;
        Object.defineProperty(window, "indexedDB", { configurable: true, get: () => window.primaryFault ? undefined : primary });
      }
      const storage = window.localStorage;
      if (kind === "missing") Object.defineProperty(window, "localStorage", { configurable: true, get: () => window.recoveryFault ? undefined : storage });
      else {
        const read = Storage.prototype.getItem; const write = Storage.prototype.setItem;
        Storage.prototype.getItem = function(key) {
          if (window.recoveryFault && kind === "denied" && key.includes("payment-attempt")) throw new DOMException("Synthetic denial", "SecurityError");
          return read.call(this, key);
        };
        Storage.prototype.setItem = function(key, value) {
          if (window.recoveryFault && key.includes("payment-attempt")) throw new DOMException("Synthetic quota", "QuotaExceededError");
          return write.call(this, key, value);
        };
      }
    }, fault);
    await page.goto("/?selected", { waitUntil: "domcontentloaded" });
    if (fault === "private-quota") {
      await page.locator("#pd-amount").fill("500");
      await page.locator("#pd-received-by").fill("TEST Private Cashier");
      await page.getByRole("button", { name: "Review payment" }).click();
      await page.getByRole("button", { name: /Confirm and save payment/ }).click();
      await expect(page.getByRole("button", { name: /Confirm and save payment/ })).toBeDisabled();
    } else await expect(page.getByRole("button", { name: "Review payment" })).toBeDisabled();
    await expect(page.getByText(/Payment saving is paused because recovery storage/)).toBeVisible();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toMatchObject({ posted: null, receiptCount: 0 });
    await page.evaluate(() => { window.recoveryFault = false; });
    await page.getByRole("button", { name: "Retry recovery" }).click();
    if (fault !== "private-quota") {
      // An accessible but empty fallback cannot prove that the hidden primary
      // has no older payment. Restoring only localStorage must keep saving paused.
      await expect(page.getByText(/Payment saving is paused because recovery storage/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Review payment" })).toBeDisabled();
      expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toMatchObject({ posted: null, receiptCount: 0 });
      await page.evaluate(() => { window.primaryFault = false; });
      await page.getByRole("button", { name: "Retry recovery" }).click();
      await expect(page.getByRole("button", { name: "Review payment" })).toBeEnabled();
      await page.locator("#pd-amount").fill("500");
      await page.getByRole("button", { name: "Review payment" }).click();
    } else await expect(page.getByText("TEST Private Cashier", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Confirm and save payment/ }).click();
    await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toMatchObject({ receiptCount: 1, posted: { amount: 500 } });
  });
}

test("390px collector and session changes retain only the original scope's unfinished payment", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?selected&lost&uncertain", { waitUntil: "domcontentloaded" });
  await page.locator("#pd-amount").fill("500");
  await page.getByRole("button", { name: "Review payment" }).click();
  await page.getByRole("button", { name: /Confirm and save payment/ }).click();
  await expect(page.getByRole("button", { name: "Check whether it was saved" })).toBeVisible();
  const original = await page.evaluate(() => window.paymentFixtureSnapshot().posted);
  for (const change of ["owner=synthetic-other", "session=TEST-2025-26", "missing-owner"]) {
    await page.goto(`/?selected&${change}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Check whether it was saved" })).toHaveCount(0);
    await expect(page.locator("#pd-amount")).not.toHaveValue("500");
    if (change === "missing-owner") {
      await expect(page.getByText(/Payment recovery could not identify/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Review payment" })).toBeDisabled();
    } else await expect(page.getByRole("button", { name: "Review payment" })).toBeEnabled();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toEqual({ posted: original, receiptCount: 1 });
  }
  await page.goto("/?selected&uncertain", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Check whether it was saved" })).toBeVisible();
  await page.evaluate(() => sessionStorage.setItem("qa-payment-check", "yes"));
  await page.getByRole("button", { name: "Check whether it was saved" }).click();
  await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toEqual({ posted: original, receiptCount: 1 });
});

for (const mirror of [true, false]) {
  test(`390px interrupted IDB recovery ${mirror ? "uses the confirmed mirror" : "blocks when its mirror is absent"}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?selected&lost&uncertain", { waitUntil: "domcontentloaded" });
    await page.locator("#pd-amount").fill("500");
    await page.getByRole("button", { name: "Review payment" }).click();
    await page.getByRole("button", { name: /Confirm and save payment/ }).click();
    await expect(page.getByRole("button", { name: "Check whether it was saved" })).toBeVisible();
    const original = await page.evaluate(() => window.paymentFixtureSnapshot().posted);
    if (!mirror) await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) if (key.includes("payment-attempt")) localStorage.removeItem(key);
    });
    await page.addInitScript(() => {
      window.recoveryFault = true;
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function(...args) {
        if (window.recoveryFault) throw new DOMException("Synthetic IDB denial", "SecurityError");
        return open.apply(this, args);
      };
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    if (!mirror) {
      await expect(page.getByText(/Payment saving is paused because recovery storage/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Review payment" })).toBeDisabled();
      expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toEqual({ posted: original, receiptCount: 1 });
      await page.evaluate(() => { window.recoveryFault = false; });
      await page.getByRole("button", { name: "Retry recovery" }).click();
    }
    await expect(page.getByRole("button", { name: "Check whether it was saved" })).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem("qa-payment-check", "yes"));
    await page.getByRole("button", { name: "Check whether it was saved" }).click();
    await expect(page.getByText("TEST-1", { exact: true }).first()).toBeVisible();
    expect(await page.evaluate(() => window.paymentFixtureSnapshot())).toEqual({ posted: original, receiptCount: 1 });
  });
}
