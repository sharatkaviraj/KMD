"use server";

/**
 * Actions behind the redesigned Payment Desk (`/payments`, `/payments/bulk`).
 *
 * Nothing here posts money itself. A payment goes through the classic desk's
 * own `submitPaymentEntryAction` (same validation, same duplicate guards, same
 * waiver-then-post order, same `client_request_id`), a removal through
 * `undoRecentPaymentAction`, a WhatsApp send through
 * `sendReceiptOnWhatsappAction`, and a bulk run through the import batch the
 * upload route uses. Each of those checks its own fee permission again.
 *
 * What this file adds is the redesign's two gates in front of them: this app's
 * permission (`fees:collect` to write, `fees:view` to read) and the view-as
 * preview, which makes a previewed screen read-only.
 */

import { after } from "next/server";

import {
  submitPaymentEntryAction,
  undoRecentPaymentAction,
} from "@/app/(app)/fees/payments/actions";
import { sendReceiptOnWhatsappAction } from "@/app/(app)/fees/receipts/actions";
import { requireStaffPermission, hasStaffPermission } from "@/modules/fees/platform/session";
import {
  commitPaymentImportRows,
  createPaymentImportBatch,
  getPaymentImportBatchSummary,
} from "@/modules/payments/data/bulk/data";
import { PAYMENT_IMPORT_COMMIT_CHUNK_SIZE, type PaymentImportBatchSummary } from "@/modules/payments/domain/bulk/types";
import { INITIAL_PAYMENT_ENTRY_ACTION_STATE } from "@/modules/payments/domain/types";
import { drainFinancialViewRefresh } from "@/modules/system-sync/data/financial-view-refresh";
import { balanceAfter, findDeskReceiptByRequest, loadDeskReceipt, loadDeskStudent, loadDeskPreview, loadDeskTodayCollection } from "@/modules/payments/vx/data";
import { counterConcessionRefusal, type DeskMode } from "@/modules/payments/vx/domain/desk";
import { emptyLiveIsBelievable } from "@/modules/payments/vx/domain/live-balance";
import { latestCloseState } from "@/modules/receipts/vx/domain/day-close";
import { listCloseEvents } from "@/vx/screens/receipts/data";
import type { BulkBatch, DeskCheckResult, DeskReceipt, DeskSaveResult, DeskStudentResult } from "@/modules/payments/vx/types";
import { revalidateAfterPaymentPosting } from "@/modules/system-sync/data/finance-revalidation";
import { revalidateSessionFinance } from "@/modules/system-sync/domain/finance-sync";
import { assertPermission } from "@/platform/auth/current-staff";
import { parseAcademicSessionLabel } from "@/platform/config/fee-rules";
import { schoolToday } from "@/vx/format";
import { assertNotPreviewing } from "@/vx/view-as";
import { assertReceiptVisible, assertSessionWritable, assertStudentVisible } from "@/platform/auth/test-session-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function sessionOf(label: string): string {
  return parseAcademicSessionLabel(String(label ?? "").trim()).normalizedLabel;
}

/** One student's ledger, receipts and family, for the desk. Read-only. */
export async function loadStudentDeskAction(input: { studentId: string; sessionLabel: string }): Promise<DeskStudentResult> {
  try {
    await assertPermission("fees:view");
    await assertSessionWritable(null, input.sessionLabel);
    await assertStudentVisible(null, input.studentId);
    if (!UUID.test(input.studentId)) return { ok: false, message: "That student was not found.", repairable: false };
    return await loadDeskStudent({ studentId: input.studentId, sessionLabel: sessionOf(input.sessionLabel), today: schoolToday() });
  } catch (error) {
    return { ok: false, message: message(error, "This student's dues could not be loaded."), repairable: false };
  }
}

/** A posted receipt, for the saved state and the duplicate sheet. Read-only. */
export async function loadDeskPreviewAction(input: { studentId: string; sessionLabel: string; paymentDate: string }) {
  await assertPermission("fees:view");
  await assertSessionWritable(null, input.sessionLabel);
  await assertStudentVisible(null, input.studentId);
  await requireStaffPermission("payments:view");
  const sessionLabel = sessionOf(input.sessionLabel);
  if (!UUID.test(input.studentId) || !/^\d{4}-\d{2}-\d{2}$/.test(input.paymentDate) || !Number.isFinite(Date.parse(`${input.paymentDate}T00:00:00Z`))) return { ok: false as const, message: "Choose a valid student and date." };
  return loadDeskPreview({ studentId: input.studentId, sessionLabel, paymentDate: input.paymentDate });
}

export async function loadReceiptAction(receiptId: string): Promise<DeskReceipt | null> {
  await assertPermission("fees:view");
  if (!UUID.test(receiptId)) return null;
  await assertReceiptVisible(null, { id: receiptId });
  return loadDeskReceipt(receiptId);
}

export type DeskPostInput = {
  clientRequestId: string;
  studentId: string;
  sessionLabel: string;
  paymentDate: string;
  mode: DeskMode;
  amount: number;
  quickDiscountAmount?: number;
  /** The whole pending late fee, when the cashier is waiving it; else 0. */
  lateFeeWaiver: number;
  reference: string;
  remarks: string;
  receivedBy: string;
  acknowledgeDuplicate: boolean;
};

/**
 * Post one payment for one student. `clientRequestId` is generated once per
 * attempt by the desk and kept until the post succeeds, so a retry after a
 * dropped connection returns the receipt already written instead of a second.
 */
export async function postDeskPaymentAction(input: DeskPostInput): Promise<DeskSaveResult> {
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, input.sessionLabel);
    // The label is the caller's; the student's own session is the fence.
    await assertStudentVisible(null, input.studentId);
    await assertNotPreviewing();
  } catch (error) {
    return { status: "error", message: message(error, "You cannot take payments here.") };
  }

  const fd = new FormData();
  fd.set("clientRequestId", input.clientRequestId);
  fd.set("studentId", input.studentId);
  fd.set("sessionLabel", input.sessionLabel);
  fd.set("paymentDate", input.paymentDate);
  fd.set("paymentMode", input.mode);
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || !Number.isSafeInteger(input.quickDiscountAmount ?? 0) || (input.quickDiscountAmount ?? 0) < 0 || !Number.isSafeInteger(input.lateFeeWaiver) || input.lateFeeWaiver < 0) {
    return { status: "error", message: "Enter whole rupee amounts." };
  }
  // The counter concession is refused, never silently dropped: a cashier who
  // somehow sent one must not post a receipt the parent thinks was discounted.
  const concessionRefusal = counterConcessionRefusal(input.quickDiscountAmount);
  if (concessionRefusal) return { status: "error", message: concessionRefusal };
  fd.set("paymentAmount", String(input.amount));
  fd.set("quickDiscountAmount", "0");
  fd.set("quickLateFeeWaiverAmount", String(input.lateFeeWaiver));
  fd.set("referenceNumber", input.reference);
  fd.set("receivedBy", input.receivedBy);
  fd.set("collectionContext", "regular");
  fd.set("remarks", input.remarks);
  if (input.acknowledgeDuplicate) {
    fd.set("acknowledgeDailyDuplicate", "true");
    // The near-duplicate override is the admin's alone; the classic action
    // checks payments:adjust before honouring it, so only ask for it then.
    const staff = await requireStaffPermission("payments:write").catch(() => null);
    if (staff && hasStaffPermission(staff, "payments:adjust")) fd.set("acknowledgeNearDuplicate", "true");
  }

  const state = await submitPaymentEntryAction(INITIAL_PAYMENT_ENTRY_ACTION_STATE, fd);

  if (state.status === "duplicate") {
    return {
      status: "duplicate",
      kind: state.duplicateKind === "near-duplicate" ? "near-duplicate" : "daily-amount",
      receiptId: state.receiptId ?? null,
      receiptNumber: state.receiptNumber ?? null,
      createdAt: state.existingReceiptCreatedAt ?? null,
      amount: state.existingReceiptAmount ?? null,
      mode: state.existingReceiptMode ?? null,
      message: state.message ?? "A matching payment was saved a few minutes ago.",
    };
  }
  if (state.status !== "success" || !state.receiptId || !state.receiptNumber) {
    // A failure after the post (the classic action throws "Payment saved, but
    // receipt details are missing" when the receipt read fails) must not read
    // as "nothing was posted". The request id says whether it was.
    const posted = await findDeskReceiptByRequest({ studentId: input.studentId, clientRequestId: input.clientRequestId }).catch(() => undefined);
    if (posted) return postedResult(posted);
    if (posted === undefined) {
      return { status: "uncertain", message: state.message || "The payment could not be confirmed." };
    }
    return { status: "error", message: state.message || "The payment was not saved. Nothing was posted." };
  }

  return postedResult({ receiptId: state.receiptId, receiptNumber: state.receiptNumber });
}

/**
 * The answer the cashier waits for: the money is posted and this is its
 * receipt number. Nothing else is read here (accountant B2): the balance
 * views' refresh took from 12 s to 2.5 min on the school-day run, and the
 * cashier stared at "Saving…" with the parent's cash in hand. The desk asks
 * `settleDeskSaveAction` for the receipt and the balance straight after, which
 * reads the balance from the live ledger, so it never shows the figure from
 * before the payment (D-271, B07).
 */
function postedResult(input: { receiptId: string; receiptNumber: string }): Extract<DeskSaveResult, { status: "saved" }> {
  return { status: "saved", receipt: null, receiptId: input.receiptId, receiptNumber: input.receiptNumber, student: null, balanceAfter: null, settling: true };
}

/**
 * The receipt, the student's live balance and today's total after a save.
 * Read-only — it never posts — so the desk calls it right after
 * `postDeskPaymentAction` answers and again from its Retry button. A failure
 * is null: the payment is posted either way, and the desk says the balance
 * could not refresh.
 */
export async function settleDeskSaveAction(input: { receiptId: string; receiptNumber: string; studentId: string; sessionLabel: string }): Promise<Extract<DeskSaveResult, { status: "saved" }> | null> {
  try {
    await assertPermission("fees:view");
    await assertSessionWritable(null, input.sessionLabel);
    if (!UUID.test(input.receiptId) || !UUID.test(input.studentId)) return null;
    await assertStudentVisible(null, input.studentId);
    await assertReceiptVisible(null, { id: input.receiptId });
    return await savedResult({ receiptId: input.receiptId, receiptNumber: input.receiptNumber, studentId: input.studentId, sessionLabel: sessionOf(input.sessionLabel) });
  } catch {
    return null;
  }
}

/**
 * The money is posted. What follows only dresses the saved state, so a
 * failure here must not read as a failed payment: the receipt and the balance
 * come back null and the desk says the balance could not refresh, with Retry.
 */
async function savedResult(input: { receiptId: string; receiptNumber: string; studentId: string; sessionLabel: string }): Promise<Extract<DeskSaveResult, { status: "saved" }>> {
  // The post only queues the balance views' refresh. Draining here used to be
  // how the receipt avoided a stale balance (D-271), but the drain takes
  // `skip locked` and returns false when the fee action's own after() drain
  // holds the lock, and the refresh is concurrent, so a read straight after
  // it could still see the view from before the payment (B07: ₹7,100 shown
  // where ₹7,099 was right). The balance now comes from the live ledger
  // (`live: true`), which needs no drain; the drain still runs, after this
  // answer, so the dashboards catch up.
  after(drainFinancialViewRefresh);
  const today = schoolToday();
  const [receipt, read, todayCollection] = await Promise.all([
    loadDeskReceipt(input.receiptId).catch(() => null),
    loadDeskStudent({ studentId: input.studentId, sessionLabel: input.sessionLabel, today, live: true }).catch(() => null),
    loadDeskTodayCollection(input.sessionLabel, today).catch(() => null),
  ]);
  // Only a live read is the balance now. A snapshot read is not returned at
  // all: the desk keeps what it had and offers Retry instead of a figure
  // that may predate the payment.
  const live = read && read.ok && read.student.balanceSource === "live" ? read.student : null;
  // An empty live ledger is "nothing owed" only when the receipt itself says so.
  const student = live && emptyLiveIsBelievable(live.liveRowCount ?? 0, receipt ? receipt.outstandingAfter : null) ? live : null;
  return {
    status: "saved",
    receipt,
    receiptId: input.receiptId,
    receiptNumber: input.receiptNumber,
    student,
    balanceAfter: student ? balanceAfter(student, today) : null,
    balanceSource: student ? "live" : null,
    balanceReadAt: student ? student.readAt : null,
    todayCollection,
  };
}

/**
 * Is this payment date already closed on Receipts? The desk warns on the
 * review sheet before a receipt is posted into a counted day (accountant B17).
 * Read-only; "could not tell" is `closed: false`, since the warning is advice
 * and the Receipts screen still flags a late receipt afterwards.
 */
export async function deskDayStateAction(input: { date: string; sessionLabel: string }): Promise<{ closed: boolean; closedAt: string | null }> {
  try {
    await assertPermission("fees:view");
    await assertSessionWritable(null, input.sessionLabel);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { closed: false, closedAt: null };
    const events = await listCloseEvents(input.date, input.date, { sessionLabel: sessionOf(input.sessionLabel) });
    const state = latestCloseState(events);
    return { closed: state.closed, closedAt: state.closed ? (state.event?.createdAt ?? null) : null };
  } catch {
    return { closed: false, closedAt: null };
  }
}

/**
 * Did the save with this request id post? Asked by the desk when a save's
 * answer never arrived, before it lets the cashier try again. "Could not
 * check" is its own answer, never "not saved".
 */
export async function checkDeskPaymentAction(input: { studentId: string; clientRequestId: string; sessionLabel: string }): Promise<DeskCheckResult> {
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, input.sessionLabel);
    await assertStudentVisible(null, input.studentId);
  } catch (error) {
    return { status: "unknown", message: message(error, "You cannot take payments here.") };
  }
  if (!UUID.test(input.studentId) || !UUID.test(input.clientRequestId)) return { status: "unknown", message: "That payment could not be checked." };
  try {
    const posted = await findDeskReceiptByRequest({ studentId: input.studentId, clientRequestId: input.clientRequestId });
    if (!posted) return { status: "not_saved" };
    return await savedResult({ ...posted, studentId: input.studentId, sessionLabel: sessionOf(input.sessionLabel) });
  } catch (error) {
    return { status: "unknown", message: message(error, "The payment could not be checked.") };
  }
}

/**
 * Remove a payment saved in the last ten minutes: a full reversal, written
 * alongside the receipt (nothing is deleted). Admin only — the classic action
 * requires payments:adjust and the RPC checks it again.
 */
export async function removePaymentAction(input: { receiptId: string; studentId: string; sessionLabel: string; reason: string }) {
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, input.sessionLabel);
    await assertReceiptVisible(null, { id: input.receiptId });
    await assertNotPreviewing();
  } catch (error) {
    return { ok: false, message: message(error, "You cannot remove payments here.") };
  }
  const fd = new FormData();
  fd.set("receiptId", input.receiptId);
  fd.set("studentId", input.studentId);
  fd.set("sessionLabel", input.sessionLabel);
  fd.set("reason", input.reason);
  return undoRecentPaymentAction(fd);
}

/** Send the receipt to the parent on WhatsApp, through the existing notice (receipts:print, app setting). */
export async function sendReceiptWhatsappAction(receiptId: string): Promise<{ ok: boolean; message: string }> {
  try {
    await assertPermission("fees:collect");
    // Phase 3 fence: a test account never messages a real parent.
    await assertReceiptVisible(null, { id: receiptId });
    await assertNotPreviewing();
  } catch (error) {
    return { ok: false, message: message(error, "You cannot send receipts here.") };
  }
  const fd = new FormData();
  fd.set("receiptId", receiptId);
  const state = await sendReceiptOnWhatsappAction({ status: "idle" }, fd);
  return { ok: state.status === "success", message: state.message ?? (state.status === "success" ? "Sent." : "Not sent.") };
}

function toBatch(summary: PaymentImportBatchSummary): BulkBatch {
  return {
    batchId: summary.batchId,
    rows: summary.rows.map((r) => ({
      id: r.id,
      rowNumber: r.rowNumber,
      sr: r.admissionNo,
      studentName: r.studentName,
      amount: r.amount,
      paymentDate: r.paymentDate,
      mode: r.paymentMode,
      remarks: r.remarks,
      status: r.validationStatus,
      messages: r.validationMessages,
      receiptNumber: r.receiptNumber,
      postError: r.postError,
    })),
  };
}

/**
 * Stage rows for checking: the typed grid (as the template's CSV) or an
 * uploaded file. The server's validation is the one that counts; nothing is
 * posted until `commitBulkRowsAction`.
 */
export async function createBulkBatchAction(formData: FormData): Promise<{ ok: true; batch: BulkBatch } | { ok: false; message: string }> {
  try {
    await assertPermission("fees:accounts");
    await assertNotPreviewing();
    await requireStaffPermission("payments:bulk");
    await assertSessionWritable(null, String(formData.get("sessionLabel") ?? ""), { orActive: true });
    const sessionLabel = sessionOf(String(formData.get("sessionLabel") ?? ""));
    const csv = formData.get("csv");
    const upload = formData.get("file");
    const file =
      upload instanceof File && upload.size > 0
        ? upload
        : typeof csv === "string" && csv.trim()
          ? new File([csv], `desk-entry-${schoolToday()}.csv`, { type: "text/csv" })
          : null;
    if (!file) return { ok: false, message: "There are no rows to check." };
    const summary = await createPaymentImportBatch(file, sessionLabel);
    return { ok: true, batch: toBatch(summary) };
  } catch (error) {
    return { ok: false, message: message(error, "The rows could not be checked.") };
  }
}

/**
 * Post staged rows, in chunks the server can finish inside its time limit.
 * Each row posts through the same RPC as the desk, one student per receipt,
 * with its own staged client_request_id, so a re-run cannot post twice.
 */
export async function commitBulkRowsAction(input: {
  batchId: string;
  rowIds: string[];
  acknowledgedRowIds: string[];
  receivedBy: string;
}): Promise<{ ok: true; posted: number; failed: number; batch: BulkBatch } | { ok: false; message: string }> {
  try {
    await assertPermission("fees:accounts");
    await assertNotPreviewing();
    const staff = await requireStaffPermission("payments:bulk");
    if (!UUID.test(input.batchId)) return { ok: false, message: "That batch was not found." };
    const rowIds = input.rowIds.filter((id) => UUID.test(id)).slice(0, PAYMENT_IMPORT_COMMIT_CHUNK_SIZE);
    if (rowIds.length === 0) return { ok: false, message: "No rows to post." };
    const result = await commitPaymentImportRows({
      batchId: input.batchId,
      rowIds,
      acknowledgedRowIds: input.acknowledgedRowIds.filter((id) => UUID.test(id)),
      receivedBy: input.receivedBy.trim() || ((staff.email as string | undefined) ?? "Bulk entry"),
      canAcknowledgeNearDuplicate: hasStaffPermission(staff, "payments:adjust"),
    });
    const summary = await getPaymentImportBatchSummary(input.batchId);
    if (result.posted > 0) {
      const affected = [...new Set(summary.rows.filter((r) => r.postedAt && r.studentId).map((r) => r.studentId as string))];
      revalidateSessionFinance(summary.sessionLabel, affected);
      revalidateAfterPaymentPosting(affected);
    }
    return { ok: true, posted: result.posted, failed: result.failed, batch: toBatch(summary) };
  } catch (error) {
    return { ok: false, message: message(error, "The rows could not be posted.") };
  }
}
