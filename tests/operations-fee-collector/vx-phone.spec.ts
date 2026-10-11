import { expect, test, type Page } from "@playwright/test";
const ledger = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ops-fee-vx-20261011-ledger") ?? "[]"));
async function setup(page: Page, uncertain = false) {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname !== "127.0.0.1" || route.request().method() !== "GET" ? route.abort() : route.fallback();
  });
  await page.goto(`/vx.html${uncertain ? "?uncertain=yes" : ""}`, { waitUntil: "commit" });
  await expect(page.locator(".pd-amt input")).toBeVisible({ timeout: 45_000 });
}
async function review(page: Page, amount = "111") {
  await page.locator(".pd-amt input").fill(amount);
  await page.getByRole("button", { name: "Review payment", exact: true }).tap();
  await expect(page.getByText("Nothing is saved yet. Check it once, then confirm. After saving it is locked.", { exact: true })).toBeVisible();
}
for (const viewport of [{ width: 360, height: 844 }, { width: 390, height: 844 }, { width: 412, height: 844 }, { width: 844, height: 390 }]) {
  const { width } = viewport;
  test.describe(`active /payments phone ${width}${width > 412 ? " landscape" : ""}`, () => {
    test.use({ viewport });
    test("partial review edit and repeated touch save records one receipt without messaging", async ({ page }) => {
      await setup(page); await review(page); expect(await ledger(page)).toHaveLength(0);
      await page.getByRole("button", { name: /^Confirm and save payment/ }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `../evidence/fee-review-${width}-${process.env.OPS_FEE_RUN_LABEL ?? "baseline"}.png` });
      await page.getByRole("button", { name: /^Back.*change something$/ }).tap();
      await expect(page.locator(".pd-amt input")).toHaveValue("111"); await review(page);
      const save = page.getByRole("button", { name: /^Confirm and save payment/ }); const box = await save.boundingBox();
      await save.tap(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect.poll(() => ledger(page)).toHaveLength(1);
      await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
      expect((await ledger(page))[0]).toMatchObject({ amount: 111, mode: "cash", studentId: "a" });
      expect(await page.evaluate(() => Number(localStorage.getItem("ops-fee-vx-messaging-attempts") ?? "0"))).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
    test("uncertain outcome remains recoverable after reload with the original key", async ({ page }) => {
      await setup(page, true); await review(page);
      await page.getByRole("button", { name: /^Confirm and save payment/ }).tap();
      await expect.poll(() => ledger(page)).toHaveLength(1);
      const originalId = (await ledger(page))[0].clientRequestId;
      await expect(page.getByText("We could not confirm whether this payment was saved", { exact: true }).first()).toBeVisible();
      await page.reload();
      await expect(page.getByText("We could not confirm whether this payment was saved", { exact: true }).first()).toBeVisible();
      await page.evaluate(() => sessionStorage.setItem("ops-fee-vx-check-available", "yes"));
      await page.getByRole("button", { name: "Check whether it was saved", exact: true }).tap();
      await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
      const checks = await page.evaluate(() => JSON.parse(localStorage.getItem("ops-fee-vx-checks") ?? "[]"));
      expect(checks.at(-1)).toMatchObject({ studentId: "a", clientRequestId: originalId });
      expect(await ledger(page)).toHaveLength(1);
    });
  });
}
