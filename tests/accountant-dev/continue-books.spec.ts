import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { db } from "../e2e/support/harness";
import { qaAccount } from "../fixtures/qa-accounts";

const tag = "OPS-SCHOOL-20261011-ACCOUNTANT";
const studentId = "4f0d0fb5-1714-4dae-af33-998977941d08";
const actorId = "f8d35f69-debd-4273-8c03-13efca8a20d2";
const staffProfileId = "c96ffb1a-e9ef-4ced-abb5-54587bbb4908";
const date = "2026-04-03";
const session = "2026-27";
const chequeId = "f0e10905-66d4-409f-8d6b-2a9c6f53a645";
const upiId = "25c45f2c-22f6-4ecd-8deb-6e1ba35c2fdd";
const bankLineId = "dd33e8e1-7115-4323-b095-16c2077422ca";
const matchEventId = "c48794b8-8668-41df-9d82-fb97095e81c8";
const ledgerPath = path.resolve("../evidence/accountant-dev-ledger.json");
const retained = [
  { id: "ff00a84c-854b-4a8c-8ec7-1dd133af706c", amount: 111, mode: "cash", number: "SVP20260403-0001" },
  { id: upiId, amount: 222, mode: "upi", number: "SVP20260403-0002" },
  { id: chequeId, amount: 333, mode: "cheque", number: "SVP20260403-0003" },
  { id: "ac05afb1-2026-44ab-a45e-e88b6156fcda", amount: 3834, mode: "cash", number: "SVP20260403-0004" },
  { id: "25fe44dd-79e1-4d8b-8cdd-5b073682d7c8", amount: 13500, mode: "cash", number: "SVP20260403-0005" },
];

function audit(status: string, patch: Record<string, unknown> = {}) {
  const previous = JSON.parse(readFileSync(ledgerPath, "utf8"));
  if (previous.project !== "wtgxcptmucjerhufzjcf" || previous.run !== tag) throw Error("Refusing unrelated audit ledger.");
  writeFileSync(ledgerPath, JSON.stringify({ ...previous, ...patch, status, updatedAt: new Date().toISOString() }, null, 2));
}
async function readReceipts() {
  const result = await db("public").from("receipts").select("id,receipt_number,payment_date,payment_mode,total_amount,reference_number,notes,client_request_id,created_by").eq("student_id", studentId).order("created_at");
  expect(result.error).toBeNull();
  return result.data!;
}
async function ownNotices() {
  const result = await db("public").from("whatsapp_reminder_sends").select("id,receipt_id,notice_kind,status,provider_message_id").eq("student_id", studentId).eq("session_label", session);
  expect(result.error).toBeNull(); expect(result.data).toHaveLength(0);
  return result.data;
}
async function signInExisting(page: Page) {
  const email = qaAccount("accountant").email;
  const existing = await db().auth.admin.listUsers({ page: 1, perPage: 1000 });
  const user = existing.data?.users.find(candidate => candidate.email === email);
  if (existing.error || user?.id !== actorId) throw Error("Existing QA accountant identity unavailable; no auth creation allowed.");
  const { data, error } = await db().auth.admin.generateLink({ type: "magiclink", email });
  if (error || data?.user.id !== actorId || !data.properties.hashed_token) throw Error("Existing QA accountant login unavailable.");
  try { await page.goto(`/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent("/accounts/books?view=upi")}`); }
  catch { throw Error("QA navigation failed; auth URL withheld."); }
  expect(page.url()).not.toContain("/login");
}

test("five immutable existing receipts and matched UPI: finish owned cheque bookkeeping, day close and CSV", async ({ page }) => {
  test.skip(process.env.OPS_ACCOUNTANT_BOOKS_RUN !== tag, "Explicit existing-five continuation opt-in required; no payment posts.");
  expect(execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()).toBe(process.env.OPS_ACCOUNTANT_BUILD_HEAD);
  const expectedHashes = JSON.parse(process.env.OPS_ACCOUNTANT_SOURCE_HASHES ?? "{}");
  expect(Object.keys(expectedHashes)).toHaveLength(5);
  for (const [file, expected] of Object.entries(expectedHashes)) expect(createHash("sha256").update(readFileSync(file)).digest("hex")).toBe(expected);
  test.setTimeout(600_000);
  page.setDefaultTimeout(20_000); page.setDefaultNavigationTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.context().addInitScript(() => { window.print = () => { document.documentElement.dataset.qaPrintCalls = String(Number(document.documentElement.dataset.qaPrintCalls ?? "0") + 1); }; });
  const previous = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const metadataResume = process.env.OPS_ACCOUNTANT_BOOKS_METADATA_RESUME === chequeId;
  const closeResume = process.env.OPS_ACCOUNTANT_CLOSE_RESUME === "64bf2787-5ad0-468f-ba0b-c1cfc0658eb9";
  const written = await readReceipts();
  expect(written).toHaveLength(5); expect(previous.receipts).toHaveLength(5);
  for (const expected of retained) {
    const row = written.find(candidate => candidate.id === expected.id)!;
    const recorded = previous.receipts.find((candidate: { id: string }) => candidate.id === expected.id);
    expect(row).toMatchObject({ id: expected.id, receipt_number: expected.number, total_amount: expected.amount, payment_mode: expected.mode, payment_date: date, created_by: actorId });
    expect(row.client_request_id).toBe(recorded.client_request_id);
    expect(row.client_request_id).toMatch(/^[0-9a-f-]{36}$/i);
  }
  expect(new Set(written.map(row => row.client_request_id)).size).toBe(5);
  expect(written.reduce((sum, row) => sum + Number(row.total_amount), 0)).toBe(18000);
  const own = await db("public").from("students").select("admission_no,primary_phone,secondary_phone,email").eq("id", studentId).single();
  expect(own.error).toBeNull(); expect(own.data).toMatchObject({ admission_no: tag, primary_phone: null, secondary_phone: null, email: "ops.accountant.20261011@qa.vpps.local" });
  const dateRows = await db("public").from("receipts").select("id").eq("payment_date", date);
  expect(dateRows.error).toBeNull(); expect(dateRows.data?.map(row => row.id).sort()).toEqual(retained.map(row => row.id).sort());
  const allocations = await db("public").from("v_receipt_effective_allocation_totals").select("receipt_id,effective_allocation_total,variance").in("receipt_id", retained.map(row => row.id));
  expect(allocations.error).toBeNull(); expect(allocations.data).toHaveLength(5);
  expect(allocations.data?.every(row => Number(row.variance) === 0)).toBe(true);
  expect(allocations.data?.reduce((sum, row) => sum + Number(row.effective_allocation_total), 0)).toBe(18000);
  const bank = await db().from("acc_upi_lines").select("id,amount,payer,utr").eq("id", bankLineId);
  expect(bank.error).toBeNull(); expect(bank.data).toEqual([{ id: bankLineId, amount: 222, payer: `${tag} payer`, utr: "202610110222" }]);
  const matches = await db().from("acc_upi_events").select("id,line_id,action,receipt_id").eq("line_id", bankLineId);
  expect(matches.error).toBeNull(); expect(matches.data).toEqual([{ id: matchEventId, line_id: bankLineId, action: "match", receipt_id: upiId }]);
  const profile = await db().from("staff_profiles").select("id,user_id,role,is_active").eq("user_id", actorId).single();
  expect(profile.error).toBeNull(); expect(profile.data).toEqual({ id: staffProfileId, user_id: actorId, role: "accountant", is_active: true });
  const [details, chequeEvents, slips, close] = await Promise.all([
    db().from("acc_cheques").select("receipt_id,cheque_no,bank_name,cheque_date,created_by").eq("receipt_id", chequeId),
    db().from("acc_cheque_events").select("id,receipt_id,status,deposit_slip_id").eq("receipt_id", chequeId).order("created_at"),
    db().from("acc_deposit_slips").select("id,slip_no,bank_label,deposited_on,total_amount,cheque_count").eq("bank_label", `${tag} synthetic bank`),
    db().from("fee_day_close_events").select("id").eq("payment_date", date),
  ]);
  for (const result of [chequeEvents, slips, close]) expect(result.error).toBeNull();
  expect(close.data).toHaveLength(0);
  expect(chequeEvents.data).toEqual(closeResume ? [
    { id: "8ae3a304-d099-4680-bd29-382f25da50a8", receipt_id: chequeId, status: "deposited", deposit_slip_id: "00f9ff8c-ca0c-4e23-a150-783b29ec301f" },
    { id: "64bf2787-5ad0-468f-ba0b-c1cfc0658eb9", receipt_id: chequeId, status: "cleared", deposit_slip_id: null },
  ] : []);
  expect(slips.data).toEqual(closeResume ? [{ id: "00f9ff8c-ca0c-4e23-a150-783b29ec301f", slip_no: "DS-0001", bank_label: `${tag} synthetic bank`, deposited_on: date, total_amount: 333, cheque_count: 1 }] : []);
  expect(details.error).toBeNull();
  expect(details.data).toEqual(metadataResume ? [{ receipt_id: chequeId, cheque_no: "261011", bank_name: "OPS Synthetic Bank", cheque_date: date, created_by: staffProfileId }] : []);
  audit("five-existing-receipts-matched-upi-continuation-preflight", { receipts: written, ownNoticeRows: await ownNotices(), ...(metadataResume ? { chequeMetadata: details.data } : {}), ...(closeResume ? { chequeEvents: chequeEvents.data, depositSlips: slips.data } : {}), continuation: { noPaymentPost: true, noChequeReplay: closeResume, fiveReceiptRequestIdsImmutable: true, bankLineId, matchEventId, authUserId: actorId, bookkeepingStaffProfileId: staffProfileId, chequeDetailsBaseline: metadataResume ? 1 : 0, chequeEventBaseline: closeResume ? 2 : 0, depositSlipBaseline: closeResume ? 1 : 0, closeBaseline: 0, buildHead: process.env.OPS_ACCOUNTANT_BUILD_HEAD, sourceHashes: process.env.OPS_ACCOUNTANT_SOURCE_HASHES ? JSON.parse(process.env.OPS_ACCOUNTANT_SOURCE_HASHES) : {} } });
  try {
    await signInExisting(page);
    if (!closeResume) {
    await page.getByRole("radio", { name: /^Matched(?:\s|$)/ }).tap();
    await expect(page.locator(".ac-ur").filter({ hasText: `${tag} payer` })).toContainText("SVP20260403-0002");
    await page.goto("/accounts/books?view=cheques");
    const cheque = page.locator(".row.ac-ct").filter({ hasText: "SVP20260403-0003" });
    if (!metadataResume) {
    await expect(cheque).toContainText("bank not written");
    await cheque.getByRole("button", { name: "Add details", exact: true }).tap();
    const detailDialog = page.getByRole("dialog", { name: "Cheque details", exact: true });
    await expect(detailDialog.getByLabel("Cheque number", { exact: true })).toHaveValue("261011");
    await expect(detailDialog.getByLabel("Date on the cheque", { exact: true })).toHaveValue(date);
    await detailDialog.getByLabel("Bank and branch", { exact: true }).fill("OPS Synthetic Bank");
    audit("before-own-cheque-metadata-save", { chequeMetadataPlan: { receiptId: chequeId, chequeNo: "261011", bank: "OPS Synthetic Bank", date } });
    await detailDialog.getByRole("button", { name: "Save details", exact: true }).tap();
    await expect(detailDialog).not.toBeVisible();
    const savedDetails = await db().from("acc_cheques").select("receipt_id,cheque_no,bank_name,cheque_date,created_by").eq("receipt_id", chequeId);
    expect(savedDetails.error).toBeNull(); expect(savedDetails.data).toEqual([{ receipt_id: chequeId, cheque_no: "261011", bank_name: "OPS Synthetic Bank", cheque_date: date, created_by: staffProfileId }]);
    audit("own-cheque-metadata-persisted-readback", { chequeMetadata: savedDetails.data });
    }
    await expect(cheque).toContainText("OPS Synthetic Bank");
    await cheque.getByRole("checkbox", { name: "Select cheque 261011", exact: true }).tap();
    const makeDeposit = page.getByRole("button", { name: /^Make a deposit slip \(/ });
    await makeDeposit.scrollIntoViewIfNeeded();
    const depositGeometry = await makeDeposit.evaluate(button => {
      const rect = button.getBoundingClientRect(); const nav = document.querySelector("nav.vx-bottom")!.getBoundingClientRect();
      return { buttonBottom: rect.bottom, navigationTop: nav.top, gap: nav.top - rect.bottom, centerOwned: button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
    });
    expect(depositGeometry.gap).toBeGreaterThanOrEqual(12); expect(depositGeometry.centerOwned).toBe(true);
    await makeDeposit.evaluate(button => button.addEventListener("click", event => { document.documentElement.dataset.qaDepositTrusted = String(event.isTrusted); }, { once: true }));
    await makeDeposit.tap();
    expect(await page.evaluate(() => document.documentElement.dataset.qaDepositTrusted)).toBe("true");
    audit("own-native-deposit-dialog-open", { depositGeometry, depositTrustedClick: true });
    const deposit = page.getByRole("dialog", { name: /^Deposit slip DS-\d+$/ });
    await deposit.getByLabel("Bank and account", { exact: true }).fill(`${tag} synthetic bank`);
    await deposit.getByLabel("Deposited on", { exact: true }).fill(date);
    await page.evaluate(() => { document.documentElement.dataset.qaPrintCalls = "0"; });
    await deposit.getByRole("button", { name: "Print", exact: true }).tap();
    await expect.poll(async () => page.evaluate(() => document.documentElement.dataset.qaPrintCalls)).toBe("1");
    audit("before-own-cheque-deposit", { depositPlan: { receiptId: chequeId, amount: 333, date, bankLabel: `${tag} synthetic bank` } });
    await deposit.getByRole("button", { name: "Mark as deposited", exact: true }).tap();
    await expect(deposit).not.toBeVisible();
    const deposited = await db().from("acc_cheque_events").select("id,receipt_id,status,deposit_slip_id").eq("receipt_id", chequeId);
    expect(deposited.error).toBeNull(); expect(deposited.data).toHaveLength(1); expect(deposited.data![0].status).toBe("deposited");
    const savedSlips = await db().from("acc_deposit_slips").select("id,slip_no,bank_label,deposited_on,total_amount,cheque_count").eq("id", deposited.data![0].deposit_slip_id);
    expect(savedSlips.error).toBeNull(); expect(savedSlips.data).toHaveLength(1);
    expect(savedSlips.data![0]).toMatchObject({ bank_label: `${tag} synthetic bank`, deposited_on: date, total_amount: 333, cheque_count: 1 });
    audit("cheque-deposit-slip-persisted-readback", { chequeEvents: deposited.data, depositSlips: savedSlips.data });
    await page.getByRole("radio", { name: /^Deposited/ }).tap();
    await page.locator(".row.ac-ct").filter({ hasText: "SVP20260403-0003" }).getByRole("button", { name: "Cleared", exact: true }).tap();
    await expect.poll(async () => { const result = await db().from("acc_cheque_events").select("id").eq("receipt_id", chequeId); return result.error ? -1 : result.data?.length; }, { timeout: 60_000 }).toBe(2);
    const cleared = await db().from("acc_cheque_events").select("id,receipt_id,status,deposit_slip_id").eq("receipt_id", chequeId).order("created_at");
    expect(cleared.error).toBeNull(); expect(cleared.data).toHaveLength(2); expect(cleared.data![1].status).toBe("cleared");
    audit("cheque-cleared-persisted-readback", { chequeEvents: cleared.data });
    }
    await page.goto("/accounts/books?view=cheques");
    await page.reload(); await page.getByRole("radio", { name: /^Cleared/ }).tap();
    await expect(page.locator(".row.ac-ct").filter({ hasText: "SVP20260403-0003" })).toContainText("Cleared");
    await page.goto(`/receipts?date=${date}&view=close&session=${session}`);
    const closeButton = page.getByRole("button", { name: "Close the day", exact: true });
    await expect(closeButton).toBeDisabled();
    await page.getByRole("switch", { name: /^UPI matches the bank app(?:\s|$)/ }).tap();
    await expect(closeButton).toBeDisabled();
    for (const [label, count] of [["500", "34"], ["200", "2"], ["20", "2"], ["Coins", "5"]]) await page.getByRole("textbox", { name: new RegExp(label === "Coins" ? "^Coins$" : `^.${label}$`) }).fill(count);
    await page.getByLabel("Note for the record (needed if cash does not match)", { exact: true }).fill(`${tag} synthetic single-accountant close; no transfer`);
    await expect(closeButton).toBeEnabled();
    audit("before-owned-single-day-close", { closePlan: { date, session, receiptCount: 5, net: 18000, cash: 17445, upi: 222, cheque: 333 } });
    await closeButton.tap();
    await expect.poll(async () => { const result = await db().from("fee_day_close_events").select("id").eq("payment_date", date).eq("session_label", session); return result.error ? -1 : result.data?.length; }, { timeout: 60_000 }).toBe(1);
    const closed = await db().from("fee_day_close_events").select("*").eq("payment_date", date).eq("session_label", session);
    expect(closed.error).toBeNull(); const event = closed.data![0];
    expect(event.action).toBe("close"); expect(Number(event.cash_expected)).toBe(17445); expect(Number(event.cash_counted)).toBe(17445);
    expect(event.upi_checked).toBe(true); expect(event.receipt_count).toBe(5); expect(event.reversed_count).toBe(0);
    expect(Number(event.expected.total)).toBe(18000); expect(Number(event.expected.upi)).toBe(222); expect(Number(event.expected.cheque)).toBe(333);
    audit("single-close-snapshot-readback", { events: closed.data });
    await page.reload(); await expect(page.locator("body")).toContainText("Day closed");
    await expect(page.getByRole("button", { name: "Reopen day (admin)", exact: true })).toHaveCount(0);
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("link", { name: "Day book (CSV)", exact: true }).tap()]);
    expect(download.suggestedFilename()).toMatch(/2026-04-03.*\.csv$/);
    const downloadedPath = await download.path(); expect(downloadedPath).not.toBeNull();
    const csv = readFileSync(downloadedPath!, "utf8"); expect(csv).toContain("Entry type,Entry date,Posted at,Student,SR no");
    const ownRows = csv.split(/\r?\n/).filter(line => line.includes(tag)); expect(ownRows).toHaveLength(5);
    for (const row of written) { const lines = ownRows.filter(line => line.includes(row.receipt_number)); expect(lines).toHaveLength(1); expect(lines[0]).toContain(date); expect(lines[0]).toContain(row.notes!); }
    writeFileSync(path.resolve("../evidence/accountant-synthetic-day-book.csv"), [csv.split(/\r?\n/)[0], ...ownRows].join("\n"));
    expect(await readReceipts()).toEqual(written);
    audit("genuine-ui-finance-complete-retained-append-only", { receipts: written, ownNoticeRows: await ownNotices(), events: closed.data, dayBook: { filename: download.suggestedFilename(), ownRowCount: ownRows.length }, failure: null, blockedBy: null, exclusions: ["Physical device/printer not tested", "No provider-send interaction or real transfer", "Concurrent/uncertain day-close remains separate schema blocker", "Cheque bank metadata was explicitly completed through existing Books Add details workflow"] });
  } catch (error) {
    let currentReceipts: Awaited<ReturnType<typeof readReceipts>> | null = null;
    try { currentReceipts = await readReceipts(); } catch { /* Preserve already recorded IDs. */ }
    audit("five-existing-books-interrupted-no-blind-retry", { ...(currentReceipts ? { receipts: currentReceipts } : { receiptReadbackUnavailable: true }), failure: error instanceof Error ? error.message.split("\n")[0] : "Unknown continuation result" });
    throw error;
  }
});
