import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { db } from "../e2e/support/harness";
import { qaAccount } from "../fixtures/qa-accounts";

const tag = "OPS-SCHOOL-20261011-ACCOUNTANT";
const studentId = "4f0d0fb5-1714-4dae-af33-998977941d08";
const date = "2026-04-03";
const session = "2026-27";
const utr = "202610110222";
const chequeNo = "261011";
const ledgerPath = path.resolve("../evidence/accountant-dev-ledger.json");
const plan = [
  { mode: "Cash", dbMode: "cash", amount: 111, marker: "OPS-SCHOOL-20261011-FEE-CASH" },
  { mode: "UPI", dbMode: "upi", amount: 222, marker: "OPS-SCHOOL-20261011-FEE-UPI" },
  { mode: "Cheque", dbMode: "cheque", amount: 333, marker: "OPS-SCHOOL-20261011-FEE-CHEQUE" },
  { mode: "Cash", dbMode: "cash", amount: 3834, marker: "OPS-SCHOOL-20261011-FEE-FULL" },
  { mode: "Cash", dbMode: "cash", amount: 13500, marker: "OPS-SCHOOL-20261011-FEE-ADVANCE" },
];
type Receipt = { id: string; receipt_number: string; payment_date: string; payment_mode: string; total_amount: number; reference_number: string | null; notes: string | null; client_request_id: string | null; created_by: string | null };

function audit(stage: string, patch: Record<string, unknown> = {}) {
  const previous = JSON.parse(readFileSync(ledgerPath, "utf8")) as Record<string, unknown>;
  if (previous.project !== "wtgxcptmucjerhufzjcf" || previous.run !== tag) throw Error("Refusing unrelated audit ledger.");
  writeFileSync(ledgerPath, JSON.stringify({ ...previous, ...patch, status: stage, updatedAt: new Date().toISOString() }, null, 2));
}
async function receipts(): Promise<Receipt[]> {
  const { data, error } = await db("public").from("receipts")
    .select("id,receipt_number,payment_date,payment_mode,total_amount,reference_number,notes,client_request_id,created_by")
    .eq("student_id", studentId).order("created_at");
  if (error) throw Error("Could not read synthetic receipts; nothing may be assumed saved.");
  return (data ?? []) as Receipt[];
}
async function safeSignIn(page: Page) {
  const email = qaAccount("accountant").email;
  const existing = await db().auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = existing.data?.users.find(candidate => candidate.email === email);
  if (existing.error || !user) throw Error("Existing QA accountant auth record unavailable; refusing account creation.");
  const { data, error } = await db().auth.admin.generateLink({ type: "magiclink", email });
  if (error || !data?.properties?.hashed_token) throw Error("Existing QA accountant login unavailable.");
  if (data.user.id !== user.id) throw Error("QA login identity changed; refusing navigation.");
  try { await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(`/payments?student=${studentId}&session=${session}`)}`); }
  catch { throw Error("QA login navigation failed; auth URL withheld."); }
  expect(page.url().includes("/login")).toBe(false);
  return user.id;
}

test("genuine UI accountant tagged bookkeeping receipts, reconciliation and single day-close", async ({ page }) => {
  // Parent must explicitly release integration before this opt-in is supplied.
  test.skip(process.env.OPS_ACCOUNTANT_FINANCE_RUN !== tag, "Prepared only; awaiting stable payment integration and parent signal.");
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 390, height: 844 });
  // No physical print job; verify the genuine receipt page and Print invocation.
  await page.context().addInitScript(() => {
    window.print = () => {
      document.documentElement.dataset.qaPrintCalls = String(Number(document.documentElement.dataset.qaPrintCalls ?? "0") + 1);
    };
  });
  const own = await db("public").from("students").select("admission_no,primary_phone,secondary_phone,email").eq("id", studentId).single();
  expect(own.error).toBeNull(); expect(own.data?.admission_no).toBe(tag);
  expect(own.data?.primary_phone).toBeNull(); expect(own.data?.secondary_phone).toBeNull();
  expect(own.data?.email).toBe("ops.accountant.20261011@qa.vpps.local");
  expect(await receipts()).toHaveLength(0);
  const dateBaseline = await db("public").from("receipts").select("id", { count: "exact", head: true }).eq("payment_date", date);
  const closeBaseline = await db().from("fee_day_close_events").select("id", { count: "exact", head: true }).eq("payment_date", date);
  expect(dateBaseline.error).toBeNull(); expect(dateBaseline.count).toBe(0);
  expect(closeBaseline.error).toBeNull(); expect(closeBaseline.count).toBe(0);
  audit("financial-ui-preflight-verified", { financialPlan: plan, expectedTotals: { net: 18000, cash: 17445, upi: 222, cheque: 333 }, printMode: "browser invocation stub; no physical printer" });
  try {
    const actorId = await safeSignIn(page);
    for (const [index, payment] of plan.entries()) await test.step(`${payment.mode} ${payment.amount}: form > review > back > confirm > exact readback`, async () => {
      if (index) await page.goto(`/payments?student=${studentId}&session=${session}`);
      await expect(page.locator("#pd-amount")).toBeVisible();
      await page.locator("#pd-amount").fill(String(payment.amount));
      await page.getByRole("radio", { name: "Other date", exact: true }).tap();
      await page.getByLabel("Date the parent paid", { exact: true }).fill(date);
      await page.getByRole("radio", { name: payment.mode, exact: true }).tap();
      if (payment.mode === "UPI") await page.getByLabel("UPI ref no. (optional)", { exact: true }).fill(utr);
      if (payment.mode === "Cheque") {
        await page.getByLabel("Cheque no.", { exact: true }).fill(chequeNo);
        await page.getByLabel("Bank", { exact: true }).fill("OPS Synthetic Bank");
        await page.getByLabel("Cheque date", { exact: true }).fill(date);
      }
      await page.getByLabel("Notes (optional)", { exact: true }).fill(`${payment.marker}; synthetic bookkeeping only; no transfer or send`);
      expect(await receipts()).toHaveLength(index);
      await page.getByRole("button", { name: "Review payment", exact: true }).tap();
      await expect(page.getByRole("heading", { name: "Review this payment", exact: true })).toBeVisible();
      expect(await receipts()).toHaveLength(index);
      await page.getByRole("button", { name: /^Back\s*[—–-]\s*change something$/ }).tap();
      await expect(page.locator("#pd-amount")).toHaveValue(String(payment.amount));
      await page.getByRole("button", { name: "Review payment", exact: true }).tap();
      audit(`before-ui-save-${index + 1}`, { receipts: await receipts(), nextPayment: payment });
      await page.getByRole("button", { name: /Confirm and save payment/ }).tap();
      await expect.poll(async () => (await receipts()).filter(r => r.notes?.includes(payment.marker)).length, { timeout: 120_000 }).toBe(1);
      const written = await receipts(); expect(written).toHaveLength(index + 1);
      const row = written.find(r => r.notes?.includes(payment.marker))!;
      expect(row.total_amount).toBe(payment.amount); expect(row.payment_mode).toBe(payment.dbMode); expect(row.payment_date).toBe(date);
      expect(row.created_by).toBe(actorId);
      expect(row.client_request_id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(new Set(written.map(r => r.client_request_id)).size).toBe(written.length);
      audit(`receipt-${index + 1}-persisted-readback`, { receipts: written });
      await expect(page.locator(".pd-receipt")).toContainText(row.receipt_number);
      await expect(page.locator(".pd-receipt")).toContainText(payment.marker);
      const print = page.getByRole("link", { name: "Print", exact: true });
      await print.tap();
      await expect(page.locator("body")).toContainText(row.receipt_number);
      await expect(page.locator("body")).toContainText("OPS Synthetic Accountant Student");
      const [receiptPdf] = await Promise.all([
        page.waitForEvent("download", { timeout: 120_000 }),
        page.getByRole("link", { name: "Print", exact: true }).tap(),
      ]);
      const pdfPath = await receiptPdf.path(); expect(pdfPath).not.toBeNull();
      const pdf = readFileSync(pdfPath!);
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-"); expect(pdf.length).toBeGreaterThan(200);
      await receiptPdf.saveAs(path.resolve(`../evidence/accountant-synthetic-receipt-${index + 1}.pdf`));
      // The Vx Print link issues a PDF. The supported classic phone bar has
      // Print A4 and opens a fresh print tab; only its browser call is stubbed.
      await page.goto(`/fees/receipts/${row.id}?session=${session}`);
      await expect(page.locator("body")).toContainText(row.receipt_number);
      const [printTab] = await Promise.all([
        page.waitForEvent("popup"),
        page.getByRole("link", { name: "Print A4", exact: true }).tap(),
      ]);
      await printTab.waitForLoadState("domcontentloaded");
      await expect(printTab.locator("body")).toContainText(row.receipt_number);
      await expect.poll(async () => Number(await printTab.evaluate(() => document.documentElement.dataset.qaPrintCalls ?? "0"))).toBeGreaterThan(0);
      await printTab.close();
      await page.reload();
      await expect(page.locator("body")).toContainText(row.receipt_number);
      expect(await receipts()).toHaveLength(index + 1);
      await page.goto(`/payments?student=${studentId}&session=${session}&receipt=${row.id}`);
      await expect(page.locator(".pd-receipt")).toContainText(row.receipt_number);
      expect(await receipts()).toHaveLength(index + 1);
    });
    const written = await receipts();
    expect(written.reduce((sum, row) => sum + row.total_amount, 0)).toBe(18000);
    const effective = await db("public").from("v_receipt_effective_allocation_totals").select("receipt_id,effective_allocation_total,variance").in("receipt_id", written.map(r => r.id));
    expect(effective.error).toBeNull(); expect(effective.data).toHaveLength(5);
    expect(effective.data?.every(r => Number(r.variance) === 0)).toBe(true);
    expect(effective.data?.reduce((sum, r) => sum + Number(r.effective_allocation_total), 0)).toBe(18000);
    await expect.poll(async () => {
      const result = await db("public").from("v_workbook_installment_balances").select("installment_id,pending_amount,late_fee_pending,fee_settled_amount,due_date").eq("student_id", studentId).eq("session_label", session);
      if (result.error || result.data?.length !== 4) return null;
      return { pending: result.data.reduce((sum, r) => sum + Number(r.pending_amount) + Number(r.late_fee_pending), 0), settled: result.data.reduce((sum, r) => sum + Number(r.fee_settled_amount), 0) };
    }, { timeout: 120_000 }).toEqual({ pending: 0, settled: 18000 });
    audit("five-receipts-and-installments-reconciled", { receipts: written, allocationRows: effective.data });

    await test.step("reconcile only the tagged synthetic UPI bank line", async () => {
      await page.goto("/accounts/books?view=upi");
      await page.getByRole("button", { name: "New statement", exact: true }).tap();
      const dialog = page.getByRole("dialog", { name: "New bank statement" });
      await dialog.locator("textarea").fill(`${date} 09:30,222,${tag} payer,${utr}`);
      await dialog.getByLabel("Account", { exact: true }).fill(`${tag} synthetic bank`);
      await dialog.getByRole("button", { name: "Add 1 payments", exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      const bank = await db().from("acc_upi_lines").select("id,amount,payer,utr").eq("utr", utr).eq("amount", 222);
      expect(bank.error).toBeNull(); expect(bank.data).toHaveLength(1); expect(bank.data?.[0].payer).toBe(`${tag} payer`);
      audit("synthetic-bank-line-readback", { bankLines: bank.data });
      const line = page.locator(".ac-ur").filter({ hasText: `${tag} payer` });
      await line.getByRole("button", { name: "Match with a receipt", exact: true }).tap();
      const matching = page.getByRole("dialog", { name: "Match with a receipt" });
      const upiReceipt = written.find(r => r.payment_mode === "upi")!;
      await matching.getByRole("radio").filter({ hasText: upiReceipt.receipt_number }).tap();
      await matching.getByRole("button", { name: "Match", exact: true }).tap();
      await expect(matching).not.toBeVisible();
      const events = await db().from("acc_upi_events").select("id,line_id,action,receipt_id").eq("line_id", bank.data![0].id).order("created_at");
      expect(events.error).toBeNull(); expect(events.data).toHaveLength(1);
      expect(events.data?.[0].action).toBe("match"); expect(events.data?.[0].receipt_id).toBe(upiReceipt.id);
      audit("upi-match-persisted-readback", { upiEvents: events.data });
      await page.reload(); await page.getByRole("radio", { name: /^Matched(?:\s|$)/ }).tap();
      await expect(page.locator(".ac-ur").filter({ hasText: `${tag} payer` })).toContainText(upiReceipt.receipt_number);
    });

    await test.step("synthetic cheque deposit slip and cleared readback", async () => {
      const chequeReceipt = written.find(r => r.payment_mode === "cheque")!;
      await page.goto("/accounts/books?view=cheques");
      const cheque = page.locator(".row.ac-ct").filter({ hasText: chequeReceipt.receipt_number });
      await cheque.getByRole("checkbox", { name: `Select cheque ${chequeNo}`, exact: true }).tap();
      await page.getByRole("button", { name: "Make deposit slip", exact: true }).tap();
      const deposit = page.getByRole("dialog", { name: "Deposit slip", exact: true });
      await deposit.getByLabel("Bank and account", { exact: true }).fill(`${tag} synthetic bank`);
      await deposit.getByLabel("Deposited on", { exact: true }).fill(date);
      await page.evaluate(() => { document.documentElement.dataset.qaPrintCalls = "0"; });
      await deposit.getByRole("button", { name: "Print", exact: true }).tap();
      await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.qaPrintCalls)).toBe("1");
      await deposit.getByRole("button", { name: "Mark as deposited", exact: true }).tap();
      await expect(deposit).not.toBeVisible();
      const deposited = await db().from("acc_cheque_events").select("id,receipt_id,status,deposit_slip_id").eq("receipt_id", chequeReceipt.id).eq("status", "deposited");
      expect(deposited.error).toBeNull(); expect(deposited.data).toHaveLength(1);
      const slips = await db().from("acc_deposit_slips").select("id,slip_no,bank_label,deposited_on,total_amount,cheque_count").eq("id", deposited.data![0].deposit_slip_id);
      expect(slips.error).toBeNull(); expect(slips.data).toHaveLength(1);
      expect(slips.data?.[0].total_amount).toBe(333); expect(slips.data?.[0].cheque_count).toBe(1);
      expect(slips.data?.[0].bank_label).toBe(`${tag} synthetic bank`); expect(slips.data?.[0].deposited_on).toBe(date);
      audit("cheque-deposit-slip-persisted-readback", { chequeEvents: deposited.data, depositSlips: slips.data });
      await page.getByRole("radio", { name: /^Deposited/ }).tap();
      await page.locator(".row.ac-ct").filter({ hasText: chequeReceipt.receipt_number }).getByRole("button", { name: "Cleared", exact: true }).tap();
      const cleared = await db().from("acc_cheque_events").select("id,receipt_id,status,deposit_slip_id").eq("receipt_id", chequeReceipt.id).order("created_at");
      expect(cleared.error).toBeNull(); expect(cleared.data).toHaveLength(2); expect(cleared.data?.[1].status).toBe("cleared");
      audit("cheque-cleared-persisted-readback", { chequeEvents: cleared.data });
      await page.reload(); await page.getByRole("radio", { name: /^Cleared/ }).tap();
      await expect(page.locator(".row.ac-ct").filter({ hasText: chequeReceipt.receipt_number })).toContainText("Cleared");
    });

    await test.step("single-accountant cash count and close snapshot", async () => {
      await page.goto(`/receipts?date=${date}&view=close&session=${session}`);
      const close = page.getByRole("button", { name: "Close the day", exact: true });
      await expect(close).toBeDisabled();
      await page.getByRole("switch", { name: /^UPI matches the bank app(?:\s|$)/ }).tap();
      await expect(close).toBeDisabled(); // A discrepancy with no note must not close.
      for (const [label, amount] of [["500", "34"], ["200", "2"], ["20", "2"], ["Coins", "5"]]) {
        await page.getByRole("textbox", { name: new RegExp(label === "Coins" ? "^Coins$" : `^.${label}$`) }).fill(amount);
      }
      await page.getByLabel("Note for the record (needed if cash does not match)", { exact: true }).fill(`${tag} synthetic single-accountant close; no transfer`);
      await expect(close).toBeEnabled();
      await close.tap();
      await expect.poll(async () => {
        const result = await db().from("fee_day_close_events").select("id").eq("payment_date", date).eq("session_label", session);
        return result.error ? -1 : result.data?.length;
      }, { timeout: 120_000 }).toBe(1);
      const events = await db().from("fee_day_close_events").select("*").eq("payment_date", date).eq("session_label", session);
      expect(events.error).toBeNull(); const event = events.data![0];
      expect(event.action).toBe("close"); expect(Number(event.cash_expected)).toBe(17445); expect(Number(event.cash_counted)).toBe(17445);
      expect(event.upi_checked).toBe(true); expect(event.receipt_count).toBe(5); expect(event.reversed_count).toBe(0);
      expect(Number(event.expected.total)).toBe(18000); expect(Number(event.expected.upi)).toBe(222); expect(Number(event.expected.cheque)).toBe(333);
      audit("single-close-snapshot-readback", { events: events.data });
      await page.reload(); await expect(page.locator("body")).toContainText("Day closed");
      await expect(page.getByRole("button", { name: "Reopen day (admin)", exact: true })).toHaveCount(0);
      expect(await receipts()).toHaveLength(5);
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 120_000 }),
        page.getByRole("link", { name: "Day book (CSV)", exact: true }).tap(),
      ]);
      expect(download.suggestedFilename()).toMatch(/2026-04-03.*\.csv$/);
      const downloadedPath = await download.path();
      expect(downloadedPath).not.toBeNull();
      const csv = readFileSync(downloadedPath!, "utf8");
      expect(csv).toContain("Entry type,Entry date,Posted at,Student,SR no");
      const ownRows = csv.split(/\r?\n/).filter(line => line.includes(tag));
      expect(ownRows).toHaveLength(5);
      for (const row of written) {
        const lines = ownRows.filter(line => line.includes(row.receipt_number));
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(date);
        expect(lines[0]).toContain(row.notes!);
      }
      // Keep only the synthetic rows in shared evidence, even if unrelated
      // historical adjustments are present in the real day-book export.
      writeFileSync(path.resolve("../evidence/accountant-synthetic-day-book.csv"), [csv.split(/\r?\n/)[0], ...ownRows].join("\n"));
      audit("single-close-and-day-book-export-verified", { events: events.data, dayBook: { filename: download.suggestedFilename(), ownRowCount: ownRows.length } });
    });
    audit("genuine-ui-finance-complete-retained-append-only", { receipts: await receipts(), exclusions: ["No real transfer or provider send", "Physical print not tested", "Concurrent/uncertain close remains separate P1 schema blocker", "Over-ledger credit is not supported by this desk; future scheduled installment was paid early"] });
  } catch (error) {
    let readback: Receipt[] | null = null;
    try { readback = await receipts(); } catch { /* Keep earlier exact IDs if the readback itself is unavailable. */ }
    audit("financial-ui-interrupted-do-not-rerun-posts-blindly", {
      ...(readback ? { receipts: readback } : { receiptReadbackUnavailable: true }),
      failure: error instanceof Error ? error.message.split("\n")[0] : "Uncertain workflow error",
    });
    throw error;
  }
});
