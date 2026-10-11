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
import { balanceAfter, findDeskReceiptByRequest, loadDeskReceipt, loadDeskStudent } from "@/modules/payments/vx/data";
import type { DeskMode } from "@/modules/payments/vx/domain/desk";
import type { BulkBatch, DeskCheckResult, DeskReceipt, DeskSaveResult, DeskStudentResult } from "@/modules/payments/vx/types";
import { revalidateAfterPaymentPosting } from "@/modules/system-sync/data/finance-revalidation";
import { revalidateSessionFinance } from "@/modules/system-sync/domain/finance-sync";
import { assertPermission } from "@/platform/auth/current-staff";
import { parseAcademicSessionLabel } from "@/platform/config/fee-rules";
import { schoolToday } from "@/vx/format";
import { assertNotPreviewing } from "@/vx/view-as";

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
    if (!UUID.test(input.studentId)) return { ok: false, message: "That student was not found.", repairable: false };
    return await loadDeskStudent({ studentId: input.studentId, sessionLabel: sessionOf(input.sessionLabel), today: schoolToday() });
  } catch (error) {
    return { ok: false, message: message(error, "This student's dues could not be loaded."), repairable: false };
  }
}

/** A posted receipt, for the saved state and the duplicate sheet. Read-only. */
export async function loadReceiptAction(receiptId: string): Promise<DeskReceipt | null> {
  await assertPermission("fees:view");
  if (!UUID.test(receiptId)) return null;
  return loadDeskReceipt(receiptId);
}

export type DeskPostInput = {
  clientRequestId: string;
  studentId: string;
  sessionLabel: string;
  paymentDate: string;
  mode: DeskMode;
  amount: number;
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
  fd.set("paymentAmount", String(Math.trunc(input.amount)));
  fd.set("quickDiscountAmount", "0");
  fd.set("quickLateFeeWaiverAmount", String(Math.max(0, Math.trunc(input.lateFeeWaiver))));
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
    if (posted) return savedResult({ ...posted, studentId: input.studentId, sessionLabel: input.sessionLabel });
    if (posted === undefined) {
      return { status: "uncertain", message: state.message || "The payment could not be confirmed." };
    }
    return { status: "error", message: state.message || "The payment was not saved. Nothing was posted." };
  }

  return savedResult({ receiptId: state.receiptId, receiptNumber: state.receiptNumber, studentId: input.studentId, sessionLabel: input.sessionLabel });
}

/**
 * The money is posted. What follows only dresses the saved state, so a
 * failure here must not read as a failed payment: the receipt and the balance
 * come back null and the desk says the receipt could not be shown yet.
 */
async function savedResult(input: { receiptId: string; receiptNumber: string; studentId: string; sessionLabel: string }): Promise<Extract<DeskSaveResult, { status: "saved" }>> {
  const [receipt, after] = await Promise.all([
    loadDeskReceipt(input.receiptId).catch(() => null),
    loadDeskStudent({ studentId: input.studentId, sessionLabel: input.sessionLabel, today: schoolToday() }).catch(() => null),
  ]);
  const student = after && after.ok ? after.student : null;
  return {
    status: "saved",
    receipt,
    receiptId: input.receiptId,
    receiptNumber: input.receiptNumber,
    student,
    balanceAfter: student ? balanceAfter(student, schoolToday()) : null,
  };
}

/**
 * Did the save with this request id post? Asked by the desk when a save's
 * answer never arrived, before it lets the cashier try again. "Could not
 * check" is its own answer, never "not saved".
 */
export async function checkDeskPaymentAction(input: { studentId: string; clientRequestId: string; sessionLabel: string }): Promise<DeskCheckResult> {
  try {
    await assertPermission("fees:collect");
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
    await assertPermission("fees:collect");
    await assertNotPreviewing();
    await requireStaffPermission("payments:bulk");
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
    await assertPermission("fees:collect");
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
