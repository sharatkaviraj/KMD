import { expect, test, type Page } from "@playwright/test";
import { collectorSummary } from "./legacy-data";
import { m } from "../../src/messages";

async function setup(page: Page, uncertain = false) {
  await page.route("**/fees/payments/student-summary?*", route => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: collectorSummary(query.get("studentId") ?? "a", query.get("paymentDate") ?? undefined) });
  });
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || route.request().method() !== "GET") return route.abort();
    return route.fallback();
  });
  await page.goto(`/fixture.html${uncertain ? "?uncertain=yes" : ""}`, { waitUntil: "commit" });
  await expect(amount(page)).toBeVisible({ timeout: 45_000 });
}
const amount = (page: Page) => page.getByRole("textbox", { name: "Amount received", exact: true }).filter({ visible: true });
const ledger = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("ops-fee-20261011-ledger") ?? "[]"));
const requestId = (page: Page) => page.locator('input[name="clientRequestId"]').inputValue();
async function review(page: Page) {
  await page.getByRole("button", { name: /Review Receipt|Collect/ }).filter({ visible: true }).last().tap();
  await expect(page.getByRole("dialog", { name: "Confirm and save payment" })).toBeVisible();
}
async function switchStudent(page: Page, id: string) {
  await page.getByRole("button", { name: "Change student", exact: true }).tap();
  await page.getByRole("option").filter({ hasText: `Synthetic student ${id}`, visible: true }).tap();
}
for (const width of [360, 390, 412]) {
  test.describe(`fee collector phone ${width}`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("review precedes save and rapid taps create one synthetic receipt", async ({ page }) => {
      await setup(page); await amount(page).fill("111");
      await review(page); expect(await ledger(page)).toHaveLength(0);
      await expect(page.getByText("DRAFT - NOT POSTED")).toBeVisible();
      const save = page.getByRole("button", { name: "Save Payment", exact: true });
      const box = await save.boundingBox();
      await save.tap(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await expect.poll(() => ledger(page)).toHaveLength(1);
      await expect(page.getByText("Synthetic receipt saved", { exact: true }).or(page.getByText("Payment Successful", { exact: true }))).toBeVisible();
      expect(await ledger(page)).toHaveLength(1);
    });
    test("phone owner/session drafts stay isolated and offline changes recover", async ({ page, context }) => {
      await setup(page); await amount(page).fill("211");
      await page.getByRole("button", { name: "Switch test owner", exact: true }).tap();
      await expect(amount(page)).toHaveValue("");
      await page.getByRole("button", { name: "Switch test owner", exact: true }).tap();
      await page.getByRole("button", { name: m.draftRestore.en, exact: true }).tap();
      await expect(amount(page)).toHaveValue("211");
      await page.getByRole("button", { name: "Switch test session", exact: true }).tap();
      await expect(amount(page)).toHaveValue("");
      await page.getByRole("button", { name: "Switch test session", exact: true }).tap();
      await page.getByRole("button", { name: m.draftRestore.en, exact: true }).tap();
      await context.setOffline(true); await amount(page).fill("311");
      await expect(page.getByText(/offline/i).filter({ visible: true }).first()).toBeVisible();
      await context.setOffline(false); await page.reload();
      await page.getByRole("button", { name: m.draftRestore.en, exact: true }).tap();
      await expect(amount(page)).toHaveValue("311"); expect(await ledger(page)).toHaveLength(0);
    });
    test("uncertain post reload retry preserves exactly one synthetic ledger effect", async ({ page }) => {
      await setup(page, true); await amount(page).fill("111"); const originalId = await requestId(page);
      await review(page); await page.getByRole("button", { name: "Save Payment", exact: true }).tap();
      await expect.poll(() => ledger(page)).toHaveLength(1);
      await expect(page.getByText("Synthetic response interrupted after ledger commit", { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await page.reload();
      await page.getByRole("button", { name: m.draftRestore.en, exact: true }).tap();
      await expect(amount(page)).toHaveValue("111");
      expect(await requestId(page), "Unresolved posting key must survive reload").toBe(originalId);
      await review(page); await page.getByRole("button", { name: "Save Payment", exact: true }).tap();
      await expect.poll(() => ledger(page)).toHaveLength(1);
    });
    test("uncertain post switch away and back retains the posting key", async ({ page }) => {
      await setup(page, true); await amount(page).fill("111"); const originalId = await requestId(page);
      await review(page); await page.getByRole("button", { name: "Save Payment", exact: true }).tap();
      await expect.poll(() => ledger(page)).toHaveLength(1);
      await expect(page.getByText("Synthetic response interrupted after ledger commit", { exact: true }).filter({ visible: true }).first()).toBeVisible();
      await switchStudent(page, "b"); await switchStudent(page, "a");
      await page.getByRole("button", { name: m.draftRestore.en, exact: true }).tap();
      await expect(amount(page)).toHaveValue("111");
      expect(await requestId(page), "Unresolved posting key must survive student switch").toBe(originalId);
    });
  });
}
