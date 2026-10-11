import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { currentSessionLabel, db, signIn } from "../e2e/support/harness";
import { W } from "../../src/vx/screens/payments/words";
import type { Pair } from "../../src/vx/text";

test.describe.configure({ mode: "serial" });
const ledgerPath = "../evidence/fee-collector-dev-ledger.json";
const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
const studentId: string = ledger.planned.studentId;
const tag: string = ledger.run;
const paymentDate: string = ledger.paymentDate;
const integratedCommit = process.env.OPS_FEE_DEV_INTEGRATED_COMMIT ?? "";
const appEnv = readFileSync(".env.local", "utf8");
if (!appEnv.split(/\r?\n/).some(line => line.trim() === "NEXT_PUBLIC_SUPABASE_URL=https://wtgxcptmucjerhufzjcf.supabase.co")) throw new Error("Collector app target must match the exact verified DEV project.");
if (!/^[a-f0-9]{40}$/.test(integratedCommit)) throw new Error("Exact integrated commit is required before collector posting.");
if (execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() !== integratedCommit) throw new Error("Collector source does not match the approved integration commit.");
execFileSync("git", ["diff", "--quiet", "--", "src/vx/screens/payments", "src/modules/payments/vx", "src/app/(app)/payments"]);

function escaped(text: string) { return text.replace(/[.*+?^$()|[\]\\]/g, "\\$&"); }
function label(pair: Pair, prefix = false) { return new RegExp("^(?:" + escaped(pair.en) + "|" + escaped(pair.hi ?? pair.en) + ")" + (prefix ? "" : "$")); }
function audit(action: string, result: unknown) {
  ledger.events.push({ at: new Date().toISOString(), action, sourceCommit: integratedCommit, result });
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
}
async function state() {
  const [receipts, payments, notices] = await Promise.all([
    db("public").from("receipts").select("id,receipt_number,student_id,payment_date,payment_mode,total_amount,reference_number,client_request_id,created_by,received_by,notes").eq("student_id", studentId).order("created_at").abortSignal(AbortSignal.timeout(20_000)),
    db("public").from("payments").select("id,receipt_id,student_id,installment_id,amount").eq("student_id", studentId).abortSignal(AbortSignal.timeout(20_000)),
    db("public").from("whatsapp_reminder_sends").select("id,receipt_id,notice_kind,status,provider_message_id").eq("student_id", studentId).abortSignal(AbortSignal.timeout(20_000)),
  ]);
  if (receipts.error || payments.error || notices.error) throw new Error("Collector persisted payment/notice readback failed: " + (receipts.error?.message ?? payments.error?.message ?? notices.error?.message));
  return { receipts: receipts.data ?? [], payments: payments.data ?? [], notices: notices.data ?? [] };
}
async function guards(page: Page, loseOwnedPartial = false) {
  const transport = { intercepted: false, requestId: null as string | null, holdChecks: loseOwnedPartial, recoveryChecks: [] as string[], failure: null as string | null };
  await page.context().route("**/*", async route => {
    const url = new URL(route.request().url());
    if (!["localhost", "127.0.0.1", "wtgxcptmucjerhufzjcf.supabase.co"].includes(url.hostname)) {
      await route.abort("blockedbyclient");
      throw new Error("External/provider request blocked during collector regression: " + url.hostname);
    }
    const request = route.request();
    if (loseOwnedPartial && request.method() === "POST" && url.pathname === "/payments" && request.headers()["next-action"]) {
      const body = request.postData() ?? "";
      let input: Record<string, unknown> | null = null;
      try {
        const args: unknown = JSON.parse(body);
        if (Array.isArray(args) && args[0] && typeof args[0] === "object") input = args[0] as Record<string, unknown>;
      } catch { /* An unrecognized owned financial request must not be forwarded. */ }
      if (!transport.intercepted && body.includes(tag + "-PARTIAL")) {
        if (input?.studentId !== studentId || input.sessionLabel !== "2026-27" || input.amount !== 1000 || input.mode !== "cash" || typeof input.clientRequestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.clientRequestId)) {
          transport.failure = "Owned partial server-action shape was not recognized; no request forwarded.";
          await route.abort("blockedbyclient"); return;
        }
        transport.intercepted = true; transport.requestId = input.clientRequestId;
        audit("owned-partial-request-ID-captured-before-delivery-fault", { clientRequestId: transport.requestId, amount: 1000 });
        try {
          const response = await route.fetch({ timeout: 90_000, maxRedirects: 0 });
          await response.body(); // Fully consume the original action reply before withholding delivery.
          const written = await state();
          expect(written.receipts).toHaveLength(1);
          expect(written.receipts[0]).toMatchObject({ client_request_id: transport.requestId, total_amount: 1000, student_id: studentId });
          expect(written.payments.reduce((sum, row) => sum + row.amount, 0)).toBe(1000);
          expect(written.notices).toHaveLength(0);
          ledger.receipts = written.receipts; ledger.status = "partial-committed-browser-reply-withheld-keep-original-ID";
          audit("owned-partial-action-settled-and-DB-readback-before-aborting-delivery", written);
        } catch {
          transport.failure = "Owned partial response/readback did not settle safely; stop and retain original request ID.";
          audit("partial-delivery-fault-precondition-unconfirmed-no-blind-retry", { clientRequestId: transport.requestId });
        }
        await route.abort("failed"); return;
      }
      if (transport.intercepted && input?.studentId === studentId && input.clientRequestId === transport.requestId && !Object.hasOwn(input, "amount")) {
        if (transport.holdChecks) { await route.abort("failed"); return; }
        transport.recoveryChecks.push(String(input.clientRequestId));
      }
    }
    return route.continue();
  });
  await page.addInitScript(() => { window.print = () => { document.documentElement.dataset.collectorPrintRequested = "yes"; }; });
  return transport;
}
async function enter(page: Page, amount: number, mode: "cash" | "upi") {
  await expect(page.locator(".pd-amt input")).toBeVisible();
  await page.getByRole("radio", { name: label(W.otherDate) }).tap();
  await page.locator('input[type="date"]').fill(paymentDate);
  await page.getByRole("radio", { name: label(mode === "cash" ? W.modeCash : W.modeUpi) }).tap();
  if (mode === "upi") await page.getByRole("textbox", { name: label(W.upiRef) }).fill("202610114801");
  await page.locator("textarea").fill(tag + (mode === "cash" ? "-PARTIAL" : "-FULL"));
  await page.locator(".pd-amt input").fill(String(amount));
}
async function confirmTwice(page: Page, expectSaved = true) {
  const button = page.getByRole("button", { name: label(W.confirmSave, true) });
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  await button.tap();
  if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  if (expectSaved) await expect(page.getByText(label(W.saved)).first()).toBeVisible();
}

test.beforeAll(async () => {
  expect(ledger.project).toBe("wtgxcptmucjerhufzjcf");
  expect(await currentSessionLabel()).toBe("2026-27");
  const [student, family, profile, users] = await Promise.all([
    db("public").from("students").select("id,admission_no,primary_phone,secondary_phone,guardian_phone,emergency_contact_phone,email,notes").eq("id", studentId).single(),
    db("public").from("student_family_groups").select("id,guardian_phone,notes").eq("id", ledger.planned.familyId).single(),
    db().from("staff_profiles").select("id,user_id,role,is_active").eq("id", ledger.collectorProfileId).single(),
    db().auth.admin.listUsers({ perPage: 1000 }),
  ]);
  for (const result of [student, family, profile, users]) if (result.error) throw new Error(result.error.message);
  expect(student.data?.notes).toContain(tag);
  expect(student.data).toMatchObject({ primary_phone: null, secondary_phone: null, guardian_phone: null, emergency_contact_phone: null });
  expect(student.data?.email).toMatch(/@qa\.vpps\.local$/);
  expect(family.data).toMatchObject({ guardian_phone: null });
  expect(profile.data).toMatchObject({ role: "fee_collector", is_active: true });
  if (users.error) throw new Error("Existing QA auth read failed.");
  const existing = users.data.users.find(user => user.email === "qa.recovery@qa.vpps.local");
  expect(existing?.id).toBe(profile.data?.user_id);
  ledger.collectorAuthUserId = existing!.id;
  const [dateReceipts, dateCloses] = await Promise.all([
    db("public").from("receipts").select("id", { count: "exact", head: true }).eq("payment_date", paymentDate),
    db().from("fee_day_close_events").select("id", { count: "exact", head: true }).eq("payment_date", paymentDate),
  ]);
  expect(dateReceipts.error).toBeNull(); expect(dateReceipts.count).toBe(0);
  expect(dateCloses.error).toBeNull(); expect(dateCloses.count).toBe(0);
  const before = await state();
  expect(before.receipts).toHaveLength(0); expect(before.payments).toHaveLength(0);
  expect(before.notices).toHaveLength(0);
  audit("preflight-existing-QA-collector-and-empty-own-ledger", { profile: profile.data?.id, paymentDate, ownReceiptCount: 0, ownPaymentCount: 0 });
});

test.afterEach(async ({}, info) => {
  if (info.status === info.expectedStatus) return;
  try {
    const written = await state();
    ledger.receipts = written.receipts;
    ledger.status = "collector-UI-interrupted-retain-records-do-not-blindly-rerun";
    audit("interrupted-test-independent-financial-readback", written);
  } catch {
    audit("interrupted-test-readback-unavailable-retain-earlier-IDs", { earlierReceiptIds: ledger.receipts.map((row: { id: string }) => row.id) });
  }
});

test("collector phone reviews partial/full, posts exactly once, and opens the persisted printable receipt", async ({ page }) => {
  test.setTimeout(300_000);
  const transport = await guards(page, true);
  try { await signIn(page, "feeCollector", "/payments?student=" + studentId + "&session=2026-27"); }
  catch { throw new Error("Existing QA collector login failed; auth URL withheld."); }
  await enter(page, 1000, "cash");
  await page.getByRole("button", { name: label(W.review) }).tap();
  expect((await state()).receipts).toHaveLength(0);
  await page.getByRole("button", { name: label(W.backToForm) }).tap();
  await expect(page.locator(".pd-amt input")).toHaveValue("1000");
  await page.getByRole("button", { name: label(W.review) }).tap();
  await confirmTwice(page, false);
  await expect.poll(() => transport.intercepted || transport.failure !== null, { timeout: 30_000 }).toBe(true);
  expect(transport.failure).toBeNull();
  await expect(page.getByText(label(W.uncertainTitle)).first()).toBeVisible({ timeout: 120_000 });
  expect(transport.failure).toBeNull();
  expect(transport.requestId).toMatch(/^[a-f0-9-]{36}$/i);
  await expect.poll(async () => (await state()).receipts.length).toBe(1);
  await page.reload();
  await expect(page.getByText(label(W.uncertainTitle)).first()).toBeVisible();
  transport.holdChecks = false;
  await page.getByRole("button", { name: label(W.checkAgain) }).tap();
  await expect(page.getByText(label(W.saved)).first()).toBeVisible();
  expect(transport.recoveryChecks).toContain(transport.requestId);
  const partial = await state();
  expect(partial.receipts).toHaveLength(1);
  expect(partial.receipts[0].client_request_id).toBe(transport.requestId);
  expect(partial.notices).toHaveLength(0);
  expect(partial.receipts[0]).toMatchObject({ student_id: studentId, payment_date: paymentDate, payment_mode: "cash", total_amount: 1000, created_by: ledger.collectorAuthUserId });
  expect(partial.receipts[0].notes).toContain(tag + "-PARTIAL");
  expect(partial.receipts[0].client_request_id).toMatch(/^[a-f0-9-]{36}$/i);
  expect(partial.payments.reduce((sum, row) => sum + row.amount, 0)).toBe(1000);
  expect(partial.payments.every(row => row.installment_id === ledger.planned.installmentIds[0])).toBe(true);
  ledger.receipts = partial.receipts; audit("partial-cash-post-UI-and-persisted-exactly-once", partial);

  await page.getByRole("link", { name: label(W.print) }).tap();
  await expect(page).toHaveURL(new RegExp("/receipts/" + escaped(encodeURIComponent(partial.receipts[0].receipt_number))));
  await expect(page.getByText(partial.receipts[0].receipt_number, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("Synthetic Collector Student 48af9254", { exact: false }).first()).toBeVisible();
  await page.reload();
  expect((await state()).receipts).toHaveLength(1);
  audit("persisted-printable-receipt-open-and-reload-no-new-effect", { id: partial.receipts[0].id, number: partial.receipts[0].receipt_number });

  await page.goto("/payments?student=" + studentId + "&session=2026-27");
  await enter(page, 17000, "upi");
  await page.getByRole("button", { name: label(W.review) }).tap();
  expect((await state()).receipts).toHaveLength(1);
  await confirmTwice(page);
  await expect.poll(async () => (await state()).receipts.length).toBe(2);
  const full = await state();
  expect(full.notices).toHaveLength(0);
  expect(full.receipts[1]).toMatchObject({ student_id: studentId, payment_date: paymentDate, payment_mode: "upi", total_amount: 17000, reference_number: "202610114801", created_by: ledger.collectorAuthUserId });
  expect(full.receipts[1].notes).toContain(tag + "-FULL");
  expect(new Set(full.receipts.map(row => row.client_request_id)).size).toBe(2);
  expect(full.receipts.every(row => /^[a-f0-9-]{36}$/i.test(row.client_request_id ?? ""))).toBe(true);
  expect(full.receipts.reduce((sum, row) => sum + row.total_amount, 0)).toBe(18000);
  expect(full.payments.reduce((sum, row) => sum + row.amount, 0)).toBe(18000);
  for (const id of ledger.planned.installmentIds) expect(full.payments.filter(row => row.installment_id === id).reduce((sum, row) => sum + row.amount, 0)).toBe(4500);
  expect(full.receipts.filter(row => row.client_request_id === partial.receipts[0].client_request_id)).toHaveLength(1);
  ledger.receipts = full.receipts; ledger.status = "collector-UI-two-receipts-18000-readback-verified"; audit("remaining-full-UPI-post-and-persisted-principal-cleared", full);
});

test("collector phone cannot enter bulk or remove a saved entry", async ({ page }) => {
  await guards(page);
  const before = await state();
  expect(before.receipts).toHaveLength(2);
  try { await signIn(page, "feeCollector", "/payments?student=" + studentId + "&session=2026-27"); }
  catch { throw new Error("Existing QA collector login failed; auth URL withheld."); }
  await expect(page.locator('a[href="/payments/bulk"]')).toHaveCount(0);
  await expect(page.getByRole("radio", { name: label(W.lateWaive) })).toHaveCount(0);
  await page.goto("/payments/bulk");
  await expect(page).toHaveURL(/\/access-denied(?:\?|$)/);
  await page.goto("/receipts/" + encodeURIComponent(before.receipts[0].receipt_number));
  await expect(page.getByRole("button", { name: /Remove entry|Reverse|Undo|हटाएँ|वापस करें/ })).toHaveCount(0);
  expect(await state()).toEqual(before);
  audit("collector-bulk-route-denied-and-correction-controls-unavailable", { receiptsUnchanged: 2, financialMutationAttempted: false, waiverLimit: "Fixture has zero late fees; this UI absence does not independently prove forged waiver-action denial." });
});
