import { expect, test, type Page } from "@playwright/test";
import { draftSummary } from "../payment-draft.fixture";
import { m } from "../../src/messages";

test.setTimeout(60_000);
const today = new Date().toISOString().slice(0, 10);
const key = (student = "a", date = today, owner = "qa-owner", session = "QA-2026") => `vppsone.draft.v2:${[owner, session, `payment/${student}/${date}`].map(encodeURIComponent).join(":")}`;
async function seed(page: Page, storage: "fallback" | "indexedDB") {
  await page.addInitScript(({ storage, keys }) => {
    // Seed only once so reload proves durable recovery rather than re-seeding.
    if (sessionStorage.getItem("draft-fixture-seeded")) return;
    sessionStorage.setItem("draft-fixture-seeded", "yes");
    const values = keys.map(([key, amount]) => [key, { version: 1, baseline: "QA-2026", updatedAt: Date.now(), value: { amountInput: amount, paymentMode: "upi", referenceNumber: "" } }] as const);
    if (storage === "fallback") {
      for (const [key, value] of values) localStorage.setItem(key, JSON.stringify(value));
    } else {
      const open = indexedDB.open("vppsone-drafts", 1);
      open.onupgradeneeded = () => open.result.createObjectStore("drafts");
      open.onsuccess = () => {
        const tx = open.result.transaction("drafts", "readwrite");
        for (const [key, value] of values) tx.objectStore("drafts").put(value, key);
        tx.oncomplete = () => open.result.close();
      };
    }
  }, { storage, keys: [[key("b"), "222"], [key("a", "2026-09-29"), "333"]] });
  if (storage === "fallback") await page.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined }));
}
async function stored(page: Page, storage: "fallback" | "indexedDB", draftKey: string) {
  return page.evaluate(async ({ storage, draftKey }) => {
    if (storage === "fallback") {
      const raw = JSON.parse(localStorage.getItem(draftKey) ?? "null");
      return raw?.deleted ? null : raw?.value ?? null;
    }
    return new Promise(resolve => {
      const open = indexedDB.open("vppsone-drafts", 1);
      open.onsuccess = () => {
        const tx = open.result.transaction("drafts", "readonly");
        const get = tx.objectStore("drafts").get(draftKey);
        tx.oncomplete = () => { resolve(get.result?.value ?? null); open.result.close(); };
      };
    });
  }, { storage, draftKey });
}
for (const width of [1440, 390]) for (const storage of ["fallback", "indexedDB"] as const) {
  test(`desk student/date/reload recovery preserves ${storage} drafts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.route("**/fees/payments/student-summary?*", route => {
      const p = new URL(route.request().url()).searchParams;
      return route.fulfill({ json: draftSummary(p.get("studentId") ?? "a", p.get("paymentDate") ?? today) });
    });
    // The fixture must not contact any external backend or send a payment.
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1" || route.request().method() !== "GET") return route.abort();
      return route.fallback();
    });
    await seed(page, storage); await page.goto("/payment-draft.html");
    const amount = page.getByRole("textbox", { name: "Amount received", exact: true }).filter({ visible: true });
    await amount.fill("111");
    await expect.poll(() => stored(page, storage, key("a"))).toMatchObject({ amountInput: "111" });
    if (width < 768) await page.getByRole("button", { name: "Change student", exact: true }).click();
    await page.getByRole("option").filter({ hasText: "Synthetic student b", visible: true }).click();
    await expect(page.getByRole("button", { name: m.draftRestore.en, exact: true })).toBeVisible();
    expect(await stored(page, storage, key("b"))).toMatchObject({ amountInput: "222" });
    await page.reload();
    await expect(page.getByRole("button", { name: m.draftRestore.en, exact: true })).toBeVisible();
    await page.getByRole("button", { name: m.draftRestore.en, exact: true }).click(); await expect(amount).toHaveValue("222");
    if (width < 768) await page.getByRole("button", { name: "Change student", exact: true }).click();
    await page.getByRole("option").filter({ hasText: "Synthetic student a", visible: true }).click();
    await page.getByRole("button", { name: m.draftRestore.en, exact: true }).click(); await expect(amount).toHaveValue("111");
    await page.locator('input[type="date"]').filter({ visible: true }).fill("2026-09-29");
    await expect(page.getByRole("button", { name: m.draftRestore.en, exact: true })).toBeVisible();
    expect(await stored(page, storage, key("a", "2026-09-29"))).toMatchObject({ amountInput: "333" });
    await expect(page.getByRole("status").filter({ hasText: m.draftFound.en })).toBeVisible();
    await expect(page.getByText(/school record changed/i)).toHaveCount(0);
    await page.getByRole("button", { name: m.draftDiscard.en, exact: true }).click(); await expect(amount).toHaveValue("");
    await expect.poll(() => stored(page, storage, key("a", "2026-09-29"))).toBeNull();
    await page.reload(); await expect(page.getByRole("button", { name: m.draftRestore.en, exact: true })).toBeVisible();
    await page.locator('input[type="date"]').filter({ visible: true }).fill("2026-09-29");
    await expect(page.getByRole("button", { name: m.draftRestore.en, exact: true })).toHaveCount(0);
    expect(await stored(page, storage, key("a", "2026-09-29"))).toBeNull(); expect(errors).toEqual([]);
  });
}
