import { expect, test, type Page } from "@playwright/test";

const viewports = [{ width: 360, height: 844 }, { width: 390, height: 844 }, { width: 412, height: 844 }, { width: 844, height: 390 }];
const warning = "We could not confirm whether this payment was saved";
const effects = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("ops-fee-vx-20261011-effect:")).map(key => JSON.parse(localStorage.getItem(key)!)));
async function open(page: Page, query = "") {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname !== "127.0.0.1" || route.request().method() !== "GET" ? route.abort() : route.fallback();
  });
  await page.goto(`/vx.html${query ? "?" + query : ""}`, { waitUntil: "commit" });
  await expect(page.locator("#pd-amount")).toBeVisible();
}
async function review(page: Page, amount = "111") {
  await page.locator("#pd-amount").fill(amount);
  await page.getByRole("button", { name: "Review payment", exact: true }).tap();
  await expect(page.getByRole("button", { name: /^Confirm and save payment/ })).toBeVisible();
}
async function interrupt(page: Page) {
  await review(page);
  expect(await effects(page)).toHaveLength(0);
  await page.getByRole("button", { name: /^Confirm and save payment/ }).tap();
  await expect.poll(() => effects(page)).toHaveLength(1);
  await expect(page.getByText(warning, { exact: true }).first()).toBeVisible();
  return (await effects(page))[0].clientRequestId as string;
}
async function recover(page: Page, requestId: string) {
  await page.evaluate(() => sessionStorage.setItem("ops-fee-vx-check-available", "yes"));
  await page.getByRole("button", { name: "Check whether it was saved", exact: true }).tap();
  await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
  const checks = await page.evaluate(() => JSON.parse(localStorage.getItem("ops-fee-vx-checks") ?? "[]"));
  expect(checks.at(-1)).toMatchObject({ studentId: "a", clientRequestId: requestId, sessionLabel: "QA-2026" });
  expect(await effects(page)).toHaveLength(1);
  expect(await page.evaluate(() => Number(localStorage.getItem("ops-fee-vx-messaging-attempts") ?? "0"))).toBe(0);
}

for (const viewport of viewports) test.describe(`PR77 active payment acceptance ${viewport.width}x${viewport.height}`, () => {
  test.use({ viewport });
  test("collector capabilities hide waiver, bulk and saved-entry correction controls", async ({ page }) => {
    await open(page);
    expect(await page.evaluate(() => typeof navigator.locks?.request)).toBe("function");
    await expect(page.getByRole("radio", { name: "Waive", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Enter many payments", exact: true })).toHaveCount(0);
    await review(page); expect(await effects(page)).toHaveLength(0);
    await page.getByRole("button", { name: /^Confirm and save payment/ }).tap();
    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Remove this entry|Remove entry|Reverse/ })).toHaveCount(0);
    expect(await effects(page)).toHaveLength(1);
  });
  test("owner and session changes do not consume or reveal another scope's unfinished attempt", async ({ page }) => {
    await open(page, "uncertain=yes");
    const original = await interrupt(page);
    await page.goto("/vx.html?role=accountant");
    await expect(page.locator("#pd-amount")).toBeVisible();
    await expect(page.getByText(warning, { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check whether it was saved", exact: true })).toHaveCount(0);
    await expect(page.locator("#pd-amount")).not.toHaveValue("111");
    await page.goto("/vx.html?session=QA-OTHER");
    await expect(page.locator("#pd-amount")).toBeVisible();
    await expect(page.getByText(warning, { exact: true })).toHaveCount(0);
    await expect(page.locator("#pd-amount")).not.toHaveValue("111");
    expect(await effects(page)).toHaveLength(1);
    await page.goto("/vx.html?uncertain=yes");
    await expect(page.getByText(warning, { exact: true }).first()).toBeVisible();
    await recover(page, original);
  });
  test("backdated authoritative preview removes the synthetic not-yet-due late charge before review", async ({ page }) => {
    await open(page);
    await page.getByRole("radio", { name: "Other date", exact: true }).tap();
    await page.locator('input[type="date"]').fill("2026-07-19");
    await expect.poll(async () => page.evaluate(() => JSON.parse(localStorage.getItem("ops-fee-vx-previews") ?? "[]").some((row: { paymentDate: string }) => row.paymentDate === "2026-07-19"))).toBe(true);
    await review(page, "600");
    expect(await effects(page)).toHaveLength(0);
    await page.getByRole("button", { name: /^Confirm and save payment/ }).tap();
    await expect(page.getByText("Saved", { exact: true }).first()).toBeVisible();
    const rows = await effects(page); expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ studentId: "a", sessionLabel: "QA-2026", paymentDate: "2026-07-19", amount: 600, lateFeeWaiver: 0 });
    expect(rows[0].receipt.outstandingAfter).toBe(300);
    expect(await page.evaluate(() => Number(localStorage.getItem("ops-fee-vx-messaging-attempts") ?? "0"))).toBe(0);
  });
  test("switching students and reloading retains the unfinished original payment and offers visible resume", async ({ page }) => {
    await open(page, "uncertain=yes");
    const original = await interrupt(page);
    const search = page.getByRole("button", { name: "Search another student", exact: true });
    if (await search.isVisible()) await search.tap();
    const other = page.getByRole("button", { name: /Synthetic fee student b/ });
    await expect(other).toBeVisible(); await other.tap();
    await expect(page.getByRole("button", { name: "Resume payment", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review payment", exact: true })).toBeDisabled();
    expect(await effects(page)).toHaveLength(1);
    await page.reload();
    await expect(page.getByRole("button", { name: "Resume payment", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Resume payment", exact: true }).tap();
    await expect(page.getByText(warning, { exact: true }).first()).toBeVisible();
    await recover(page, original);
  });
});

test.describe("PR77 recovery infrastructure and shared phone contexts", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("missing collector identity blocks collection before any local effect", async ({ page }) => {
    await open(page, "role=missing-owner");
    await expect(page.getByText("Payment recovery could not identify the signed-in collector. Reload after signing in again before collecting.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review payment", exact: true })).toBeDisabled();
    expect(await effects(page)).toHaveLength(0);
  });
  test("unavailable Web Locks blocks collection before any local effect", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "locks", { value: undefined, configurable: true }));
    await open(page);
    await expect(page.getByText(/^Payment saving is paused because this browser cannot safely coordinate recovery across tabs/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Review payment", exact: true })).toBeDisabled();
    expect(await effects(page)).toHaveLength(0);
  });
  test("blocked durable storage blocks collection before any local effect", async ({ page }) => {
    await page.addInitScript(() => { indexedDB.open = () => { throw new Error("Synthetic storage denial"); }; });
    await open(page);
    await expect(page.getByText(/^Payment saving is paused because recovery storage is unavailable, blocked or full/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Review payment", exact: true })).toBeDisabled();
    expect(await effects(page)).toHaveLength(0);
  });
  test("failed authoritative date preview cannot be reviewed or posted", async ({ page }) => {
    await open(page, "previewfail=yes");
    await page.getByRole("radio", { name: "Other date", exact: true }).tap();
    await page.locator('input[type="date"]').fill("2026-07-19");
    await expect(page.getByText("Date dues could not be loaded. Choose the date again before reviewing.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Review payment", exact: true })).toBeDisabled();
    expect(await effects(page)).toHaveLength(0);
  });
  test("two collector phone tabs racing different saves share one durable attempt and recover one effect", async ({ page, context }) => {
    const second = await context.newPage();
    await open(page, "uncertain=yes"); await open(second, "uncertain=yes");
    await review(page, "111"); await review(second, "222");
    expect(await effects(page)).toHaveLength(0);
    await Promise.all([page.getByRole("button", { name: /^Confirm and save payment/ }).tap(), second.getByRole("button", { name: /^Confirm and save payment/ }).tap()]);
    await expect.poll(() => effects(page)).toHaveLength(1);
    const original = (await effects(page))[0].clientRequestId;
    await expect(page.getByText(warning, { exact: true }).first()).toBeVisible();
    await expect(second.getByText(warning, { exact: true }).first()).toBeVisible();
    await recover(page, original); await recover(second, original);
    expect(await effects(page)).toHaveLength(1);
    await second.close();
  });
});
