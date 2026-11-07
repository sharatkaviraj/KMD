import { expect, test } from "@playwright/test";

const phones = [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 844, height: 390 }];
for (const viewport of phones) {
  for (const view of ["cheques", "upi", "refunds", "requests"]) {
    test(`accountant ${view} phone ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(`/?view=${view}`);
      await expect(page.getByRole("tablist", { name: "Sections" })).toBeVisible();
      if (view === "upi") await page.getByRole("radio", { name: /^Matched · / }).tap();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
      // Chromium can report 43.999969 for a 44px target during translated row animation.
      const small = await page.locator('button:not([disabled]),a[href],input:not([type=hidden]),select,textarea').evaluateAll(elements => elements.filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden").map(element => { const r = element.getBoundingClientRect(); return { label: element.getAttribute("aria-label") ?? element.textContent?.trim(), width: Math.round(r.width * 100) / 100, height: Math.round(r.height * 100) / 100 }; }).filter(r => r.width < 44 || r.height < 44));
      expect(small).toEqual([]);
      await page.screenshot({ path: `.playwright/phone-evidence/accountant-${view}-${viewport.width}x${viewport.height}.png`, fullPage: true });
    });
  }
  test(`statement error retains input on phone ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?view=upi");
    await page.getByRole("button", { name: "New statement", exact: true }).tap();
    const dialog = page.getByRole("dialog", { name: "New bank statement" });
    await expect(dialog).toBeVisible();
    await dialog.locator("textarea").fill("2026-02-31,100,OPS Synthetic payer,OPS123456");
    const save = dialog.getByRole("button", { name: "Add 1 payments" });
    await save.tap();
    await expect(page.getByRole("status")).toContainText("Date not understood");
    await expect(dialog.locator("textarea")).toHaveValue("2026-02-31,100,OPS Synthetic payer,OPS123456");
    const r = await save.boundingBox();
    expect(r!.y + r!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  });
  test(`closed day guidance matches receipt behavior on phone ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?screen=home&evening=true");
    await expect(page.getByText(/Day closed/)).toBeVisible();
    await expect(page.locator("body")).not.toContainText("receipts locked");
    await expect(page.locator("body")).not.toContainText("Anything taken now counts for");
    await expect(page.locator("body")).toContainText("Review receipts posted afterward");
  });
}
test("role preview cannot offer statement or refund saves", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=upi&readonly");
  await expect(page.getByRole("button", { name: "New statement", exact: true })).toHaveCount(0);
  await page.goto("/?view=refunds&readonly");
  await expect(page.getByRole("button", { name: "Request refund", exact: true })).toHaveCount(0);
});

for (const viewport of phones) test(`UPI unseen receipt prevents an all-agree day-close claim ${viewport.width}x${viewport.height}`, async ({ page }) => {
  await page.setViewportSize(viewport);
  await page.goto("/?view=upi");
  await expect(page.locator("body")).toContainText("1 UPI receipts not yet seen in the bank");
  await expect(page.locator("body")).not.toContainText("Every UPI payment is sorted");
  await expect(page.locator("body")).not.toContainText("The bank and the app agree");
  await expect(page.locator("body")).toContainText("Review it before confirming UPI at day close");
  await expect(page.locator(".lucide-triangle-alert")).toHaveCount(1);
});

test("UPI guidance retains statement coverage check with zero unseen receipts and plural warning", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?view=upi&unmatched=0");
  await expect(page.locator("body")).toContainText("Review the statement coverage before confirming UPI at day close");
  await expect(page.locator("body")).not.toContainText("The bank and the app agree");
  await page.goto("/?view=upi&unmatched=2");
  await expect(page.locator("body")).toContainText("2 UPI receipts still need a bank match. Review them");
});

// Staff are Hindi-first (7 Nov 2026): a Hindi reader's Books screen says every
// label, button and hint in Hindi, and the longer lines still fit a 360px phone.
const ENGLISH_LEFT: Record<string, string[]> = {
  cheques: ["To deposit", "Deposited", "Cleared", "Bounced", "Status", "Amount", "Tick the cheques", "Add details"],
  upi: ["matched", "Bank statement for", "New statement", "In the bank statement", "Needs you", "Matched", "UPI ref"],
  refunds: ["Advances held", "can be refunded", "Request refund", "Refund requests", "No refund requests", "See all in My requests"],
  requests: ["Waiting", "Decided", "Sent", "Reminded", "Withdraw", "Remind admin", "with the admin"],
};
for (const view of ["cheques", "upi", "refunds", "requests"]) {
  test(`accountant ${view} reads in Hindi on a 360px phone`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(`/?view=${view}&language=hi`);
    await expect(page.getByRole("tablist", { name: "हिस्से" })).toBeVisible();
    const body = page.locator("body");
    for (const english of ENGLISH_LEFT[view]) await expect(body).not.toContainText(english);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
    await page.screenshot({ path: `.playwright/phone-evidence/accountant-${view}-hi-360.png`, fullPage: true });
  });
}
