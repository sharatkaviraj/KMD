import { expect, test, type Page } from "@playwright/test";

/*
 * Collect on a synthetic bridge (collect.html, collect-actions.ts): the
 * no-scroll guarantee (plan §3.6) at the four sizes the owner named, in each
 * language, and the safety the seal rests on — no seal before the ledger
 * answers, and a lost answer checked by the same command id, never resent.
 */

const SIZES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
];

async function nothingScrolls(page: Page, where: string) {
  const overflow = await page.evaluate(() => {
    const bad: string[] = [];
    document.querySelectorAll<HTMLElement>(".cx-card:not(.leaving) .cx-body, .cx-card:not(.leaving) .cx-foot, .cx-card:not(.leaving) .cx-detail, .cx-card:not(.leaving) .cx-ticket, .cx-rail, .cx-ctx").forEach((el) => {
      if (getComputedStyle(el).display === "none") return;
      if (el.scrollHeight > el.clientHeight + 1) bad.push(`${el.className} ${el.scrollHeight}>${el.clientHeight}`);
    });
    const d = document.documentElement;
    if (d.scrollHeight > d.clientHeight + 1) bad.push(`page ${d.scrollHeight}>${d.clientHeight}`);
    if (d.scrollWidth > d.clientWidth + 1) bad.push(`page-x ${d.scrollWidth}>${d.clientWidth}`);
    return bad;
  });
  expect(overflow, where).toEqual([]);
}

const live = (page: Page) => page.locator(".cx-stage > section.cx-card");
async function settle(page: Page) {
  await page.waitForTimeout(450);
}

for (const size of SIZES) {
  for (const locale of ["en", "hi", "both"] as const) {
    test(`every card fits without scrolling at ${size.width}x${size.height} (${locale})`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.route("**/*", (route) => (route.request().url().startsWith("http://127.0.0.1:3201/") ? route.continue() : route.abort()));
      await page.goto(`/collect.html?locale=${locale}`);
      await expect(live(page)).toBeVisible();
      await nothingScrolls(page, "who");
      // A father's phone: the whole household, collected together.
      await page.locator(".cx-search input").fill("9000000063");
      await expect(live(page).locator(".cx-hh")).toBeVisible();
      await nothingScrolls(page, "who · family");
      await live(page).locator(".cx-hh button").click();
      await expect(live(page).locator(".cx-fam.on")).toHaveCount(2);
      await settle(page);
      await nothingScrolls(page, "dues · family");
      await live(page).locator(".cx-foot .cx-btn.pri").click();
      await settle(page);
      await live(page).locator(".cx-qc").first().click();
      await nothingScrolls(page, "amount · family");
      await live(page).locator(".cx-foot .cx-btn.pri").click();
      await settle(page);
      await nothingScrolls(page, "payment · cash");
      await live(page).locator(".cx-mt").nth(4).click();
      await nothingScrolls(page, "payment · cheque");
      await live(page).locator(".cx-mt").nth(2).click();
      await nothingScrolls(page, "payment · cash + upi");
      await live(page).locator(".cx-mday.mcal").click();
      await settle(page);
      await nothingScrolls(page, "payment · calendar");
      await live(page).locator(".cx-cal button:not(:disabled)").first().click();
      await settle(page);
      await nothingScrolls(page, "payment · backdated");
    });
  }
}

test("a plain cash payment saves from the payment card, and the seal follows the ledger's receipt", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/collect.html?locale=en");
  await page.locator(".cx-search input").fill("Aarav");
  await expect(live(page).locator(".cx-res")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(live(page).getByText("Is this the child?")).toBeVisible();
  await live(page).locator(".cx-foot .cx-btn.pri").click();
  await settle(page);
  await live(page).locator(".cx-qc").first().click();
  await live(page).locator(".cx-foot .cx-btn.pri").click();
  await settle(page);
  // No check card for a plain payment: the hold button is on the payment card.
  const hold = live(page).locator(".cx-hold");
  await expect(hold).toBeEnabled();
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect(live(page).locator(".cx-sv")).toHaveCount(0); // released early: nothing sent
  await hold.hover();
  await page.mouse.down();
  await page.waitForTimeout(800);
  await page.mouse.up();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("[data-rno]")).toHaveCount(1);
  await nothingScrolls(page, "sealed");
});

test("a lost answer is checked with the same command id and never posted twice", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/collect.html?locale=en&lost=1");
  await page.locator(".cx-search input").fill("Kabir");
  await expect(live(page).locator(".cx-res")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await live(page).locator(".cx-foot .cx-btn.pri").click();
  await settle(page);
  await live(page).locator(".cx-qc").first().click();
  await page.keyboard.press("Enter");
  await settle(page);
  await page.keyboard.down("Enter");
  await page.waitForTimeout(800);
  await page.keyboard.up("Enter");
  await expect(page.getByText("Checking whether this payment was saved")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
  const stored = await page.evaluate(() => Object.keys(sessionStorage).find((k) => k.startsWith("vppsone:collect-attempt:")));
  expect(stored).toBeTruthy();
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10_000 });
  expect(await page.evaluate(() => Object.keys(sessionStorage).some((k) => k.startsWith("vppsone:collect-attempt:")))).toBe(false);
});

test("a child who paid earlier today needs the 'new payment' tick on the check card", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("/collect.html?locale=en");
  await page.locator(".cx-search input").fill("Vihaan");
  await expect(live(page).locator(".cx-res")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(live(page).getByText(/Already paid/)).toBeVisible();
  await live(page).locator(".cx-foot .cx-btn.pri").click();
  await settle(page);
  await live(page).locator(".cx-qc").first().click();
  await live(page).locator(".cx-foot .cx-btn.pri").click();
  await settle(page);
  await live(page).locator(".cx-foot .cx-btn.pri").click(); // Next: check
  await settle(page);
  await expect(live(page).getByText("Paid earlier today")).toBeVisible();
  await expect(live(page).locator(".cx-hold")).toBeDisabled();
  await live(page).locator(".cx-ack input").check();
  await expect(live(page).locator(".cx-hold")).toBeEnabled();
});

test("a read-only desk shows the dues but cannot save", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/collect.html?locale=en&readonly=true");
  await expect(page.getByText(/Collection in One is closed/)).toBeVisible();
  await page.locator(".cx-search input").fill("Aarav");
  await expect(live(page).locator(".cx-res")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await live(page).locator(".cx-foot .cx-btn.pri").click();
  await settle(page);
  await live(page).locator(".cx-qc").first().click();
  await live(page).locator(".cx-foot .cx-btn.pri").click();
  await settle(page);
  await expect(live(page).locator(".cx-hold")).toBeDisabled();
});
