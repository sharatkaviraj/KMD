import { expect, test, type Locator, type Page } from "@playwright/test";

const snapshot = (page: Page) => page.evaluate(() => window.feeFollowupSnapshot());
async function settledTap(target: Locator) {
  await target.evaluate(async element => {
    element.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise<void>((resolve, reject) => {
      let frame = 0, last: number[] | null = null, stableSince = performance.now();
      const finish = (error?: Error) => { clearTimeout(timer); cancelAnimationFrame(frame); if (error) reject(error); else resolve(); };
      const timer = window.setTimeout(() => finish(new Error("Touch target did not settle within 3 seconds")), 3000);
      const sample = (now: number) => {
        if (!element.isConnected) { finish(new Error("Touch target detached")); return; }
        const rect = element.getBoundingClientRect(), next = [scrollX, scrollY, rect.x, rect.y, rect.width, rect.height], previous = last;
        if (!previous || next.some((value, index) => Math.abs(value - previous[index]) > 0.5)) stableSince = now;
        last = next;
        if (now - stableSince >= 150) { finish(); return; }
        frame = requestAnimationFrame(sample);
      };
      frame = requestAnimationFrame(sample);
    });
  });
  await target.tap();
}
async function open(page: Page, width: number, query = "") {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`/${query}`, { waitUntil: "domcontentloaded" });
  // A phone's desk opens on the dues; the amount is step 2 and the date step 3 (UI-95).
  await expect(page.getByRole("button", { name: "Enter amount", exact: true })).toBeVisible();
  await expect(page.locator("#pd-amount")).toBeHidden();
  await page.getByRole("button", { name: "Enter amount", exact: true }).tap();
  await expect(page.locator("#pd-amount")).toBeVisible();
  expect((await snapshot(page)).effects).toHaveLength(0);
}
/** From the amount to the date, mode and Review & save. */
async function toSave(page: Page) {
  await page.getByRole("button", { name: "Next: date & mode", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Review & save", exact: true })).toBeEnabled();
}
type Balance = { pendingToday: number; dueToday: number; notDueYet: number; lateFee: number };
/** The design's receipt freezes the balance after it, part by part (RULES B keeps the late fee apart). */
async function expectBalanceAfter(page: Page, balance: Balance) {
  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const card = page.getByRole("article", { name: /^FEE RECEIPT / });
  await expect(card.getByText(/^Balance after this receipt/)).toBeVisible();
  await expect(card).toContainText(`Fees pending today${inr(balance.pendingToday)}`);
  await expect(card).toContainText(`Not due yet${inr(balance.notDueYet)}`);
  await expect(card).toContainText(`Late fee (separate)${inr(balance.lateFee)}`);
}
async function review(page: Page) {
  if (await page.getByRole("button", { name: "Next: date & mode", exact: true }).isVisible()) await toSave(page);
  await page.getByRole("button", { name: "Review & save", exact: true }).tap();
  await expect(page.getByRole("dialog", { name: /^Save ₹/ })).toBeVisible();
  expect((await snapshot(page)).effects).toHaveLength(0);
}
async function save(page: Page) {
  await page.getByRole("button", { name: /^Save payment/ }).tap();
  await expect(page.getByText(/^FOLLOWUP-/).first()).toBeVisible();
  const state = await snapshot(page);
  expect(state.effects).toHaveLength(1);
  expect(state.dispatchAttempts).toBe(0);
  expect(state.effects[0].input.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);
  return state.effects[0];
}
test.beforeEach(async ({ context }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort("blockedbyclient");
    if (url.pathname === "/followup-transport") return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    if (route.request().method() !== "GET") return route.abort("blockedbyclient");
    return route.continue();
  });
});
test.afterEach(async ({ page }, info) => {
  if (!page.isClosed()) {
    const state = await snapshot(page).catch(() => null);
    if (state) { await info.attach("synthetic-effect-ledger", { body: JSON.stringify(state, null, 2), contentType: "application/json" }); expect(state.dispatchAttempts).toBe(0); }
  }
});

for (const width of [360, 390, 412]) {
  for (const mode of ["Cash", "UPI", "Bank transfer", "Cheque"] as const) {
    test(`${width}px ${mode} reference and receipt`, async ({ page }) => {
      await open(page, width);
      await expect(page.getByRole("radio", { name: "Waive", exact: true })).toHaveCount(0);
      await page.locator("#pd-amount").fill("500");
      await toSave(page);
      await page.getByRole("radio", { name: mode, exact: true }).tap();
      const reference = mode === "UPI" ? "202610119901" : mode === "Bank transfer" ? "UTR OPS 20261011" : mode === "Cheque" ? "123456" : "";
      if (mode === "UPI") await page.getByLabel("UPI ref no. (optional)", { exact: true }).fill(reference);
      if (mode === "Bank transfer") await page.getByLabel("UTR no. (optional)", { exact: true }).fill("  UTR   OPS 20261011  ");
      if (mode === "Cheque") { await page.getByLabel("Cheque no.", { exact: true }).fill(reference); await page.getByLabel("Bank", { exact: true }).fill("Synthetic bank"); await page.getByLabel("Cheque date", { exact: true }).fill("2026-10-10"); }
      await page.getByLabel("Notes (optional)", { exact: true }).fill(`FEE-FOLLOWUP-${width}-${mode}`);
      await review(page);
      const effect = await save(page);
      expect(effect.input).toMatchObject({ amount: 500, reference, mode: ({ Cash: "cash", UPI: "upi", "Bank transfer": "bank_transfer", Cheque: "cheque" })[mode] });
      expect(effect.receipt.total).toBe(500);
      expect(effect.receipt.outstandingAfter).toBe(4500);
      await expect(page.getByText(new RegExp(mode, "i")).filter({ visible: true }).first()).toBeVisible();
      if (reference) await expect(page.getByText(reference, { exact: false }).filter({ visible: true }).first()).toBeVisible();
      if (mode === "Cheque") {
        expect(effect.input.remarks).toContain("Synthetic bank, dated 2026-10-10; subject to clearing.");
        // The design's receipt is drawn in full; nothing is folded away.
        await expect(page.getByText(/Subject to clearing/).filter({ visible: true }).first()).toBeVisible();
      }
      await expect(page.getByRole("button", { name: /Remove this entry/ })).toHaveCount(0);
      await expect(page.locator("#pd-amount")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
  test(`${width}px custom advance with required waiver reason and no counter concession`, async ({ page }, info) => {
    await open(page, width, "?role=admin");
    await page.locator("#pd-amount").fill("3500");
    // The counter concession is off (school-day run, accountant B1).
    await expect(page.locator("#pd-concession")).toHaveCount(0);
    await page.getByRole("radio", { name: "Waive", exact: true }).tap();
    // A waiver without a reason keeps the amount step: the date step never opens on a problem only step 2 can fix.
    await page.getByRole("button", { name: "Next: date & mode", exact: true }).tap();
    await expect(page.getByText("Pick a reason for the waiver", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#pd-amount")).toBeVisible();
    await expect(page.getByRole("dialog", { name: /^Save ₹/ })).toHaveCount(0);
    expect((await snapshot(page)).effects).toHaveLength(0);
    await page.getByRole("button", { name: "Family hardship", exact: true }).tap();
    await page.getByPlaceholder("Note (optional)", { exact: true }).fill("Synthetic follow-up waiver");
    await review(page);
    if (width === 390) await info.attach("synthetic-phone-review-390", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
    const effect = await save(page);
    expect(effect.input).toMatchObject({ amount: 3500, quickDiscountAmount: 0, lateFeeWaiver: 1000 });
    expect(effect.input.remarks).toContain("Family hardship (Synthetic follow-up waiver)");
    expect(effect.receipt.lines).toEqual([{ label: "Installment 1", amount: 2000 }, { label: "Installment 2", amount: 1500 }]);
    expect(effect.receipt.outstandingAfter).toBe(500);
    await expectBalanceAfter(page, effect.balance);
  });
  test(`${width}px EMI suggestions preserve custom collection and restricted adjustments`, async ({ page }) => {
    await open(page, width, "?role=admin&emi");
    // The amount box starts empty (RULES B, UI-79): the plan's chips fill it,
    // grouped as the design draws it (₹1,400).
    await expect(page.locator("#pd-amount")).toHaveValue("");
    await page.getByRole("button", { name: /^Catch up/ }).tap(); await expect(page.locator("#pd-amount")).toHaveValue("1,400");
    await page.getByRole("button", { name: /^Monthly EMI/ }).tap(); await expect(page.locator("#pd-amount")).toHaveValue("700");
    await page.getByRole("button", { name: /^Full plan balance/ }).tap(); await expect(page.locator("#pd-amount")).toHaveValue("4,000");
    await page.getByRole("button", { name: /^Catch up/ }).tap(); await expect(page.locator("#pd-amount")).toHaveValue("1,400");
    await expect(page.locator("#pd-concession")).toHaveCount(0);
    await expect(page.getByRole("radio", { name: "Waive", exact: true })).toHaveCount(0);
    await page.locator("#pd-amount").fill("850");
    await review(page); const effect = await save(page);
    expect(effect.input).toMatchObject({ amount: 850, quickDiscountAmount: 0, lateFeeWaiver: 0 });
    expect(effect.receipt.outstandingAfter).toBe(3150);
  });
  test(`${width}px backdate guards and authoritative no-late advance`, async ({ page }) => {
    await open(page, width);
    await page.locator("#pd-amount").fill("3500");
    await toSave(page);
    await page.getByRole("radio", { name: "Other date", exact: true }).tap();
    const date = page.getByLabel("Date the parent paid", { exact: true });
    for (const invalid of ["2026-03-31", "2026-10-12"]) {
      await date.fill(invalid);
      await expect(page.getByRole("button", { name: "Review & save", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Review & save", exact: true }).tap();
      await expect(page.getByRole("dialog", { name: /^Save ₹/ })).toHaveCount(0); expect((await snapshot(page)).effects).toHaveLength(0);
    }
    await date.fill("2026-04-19");
    await expect.poll(async () => (await snapshot(page)).previews.at(-1)?.paymentDate).toBe("2026-04-19");
    await review(page); const effect = await save(page);
    expect(effect.input).toMatchObject({ amount: 3500, paymentDate: "2026-04-19", lateFeeWaiver: 0 });
    expect(effect.receipt.lateFeePaid).toBe(0); expect(effect.receipt.outstandingAfter).toBe(500);
    await expectBalanceAfter(page, effect.balance);
  });
  test(`${width}px admin reversal retains the single receipt effect`, async ({ page }) => {
    await open(page, width, "?role=admin"); await page.locator("#pd-amount").fill("500"); await review(page); const effect = await save(page);
    await settledTap(page.getByRole("button", { name: /Remove this entry/ }));
    // The design's sheet opens on "Entered twice"; the admin picks the real reason.
    await expect(page.getByRole("radio", { name: /^Entered twice/ })).toHaveAttribute("aria-checked", "true");
    await page.getByRole("radio", { name: /^Wrong amount typed/ }).tap();
    await page.getByRole("button", { name: "Remove entry", exact: true }).tap();
    await expect(page.getByText("Entry removed", { exact: true }).first()).toBeVisible();
    const state = await snapshot(page); expect(state.effects).toHaveLength(1); expect(state.reversals).toEqual([{ receiptId: effect.receipt.id, studentId: effect.input.studentId, sessionLabel: effect.input.sessionLabel, reason: "Wrong amount typed" }]);
    await expect(page.getByRole("button", { name: /Remove this entry/ })).toHaveCount(0);
  });
  test(`${width}px offline before post then reconnect and lost-answer reload recovery`, async ({ page, context }) => {
    await open(page, width, "?lost"); await page.locator("#pd-amount").fill("625"); await review(page);
    await context.setOffline(true); await page.getByRole("button", { name: /^Save payment/ }).tap();
    await expect(page.getByRole("button", { name: "Check whether it was saved", exact: true })).toBeVisible();
    const before = await snapshot(page); expect(before.effects).toHaveLength(0); expect(before.attempts).toHaveLength(1); const original = before.attempts[0].clientRequestId;
    await context.setOffline(false); await page.getByRole("button", { name: "Check whether it was saved", exact: true }).tap();
    await expect(page.getByRole("button", { name: /^Save payment/ })).toBeVisible();
    expect((await snapshot(page)).effects).toHaveLength(0);
    await page.getByRole("button", { name: /^Save payment/ }).tap();
    await expect(page.getByRole("button", { name: "Check whether it was saved", exact: true })).toBeVisible();
    expect((await snapshot(page)).effects).toHaveLength(1);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Check whether it was saved", exact: true })).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem("fee-followup-check-ready", "yes"));
    await page.getByRole("button", { name: "Check whether it was saved", exact: true }).tap();
    await expect(page.getByText(/^FOLLOWUP-/).first()).toBeVisible();
    const after = await snapshot(page); expect(after.effects).toHaveLength(1); expect(after.effects[0].input).toMatchObject({ clientRequestId: original, amount: 625 }); expect(after.attempts.map(row => row.clientRequestId)).toEqual([original, original]); expect(after.checks.every(row => row.clientRequestId === original)).toBe(true);
    await expect(page.locator("#pd-amount")).toHaveCount(0);
  });
}
