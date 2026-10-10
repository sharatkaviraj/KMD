"use server";

import { revalidatePath } from "next/cache";

import { reverseReceiptAdminAction } from "@/app/(app)/fees/payments/actions";
import { assertPermission } from "@/platform/auth/current-staff";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { getDeskReceipt, loadDeskReceipts } from "@/modules/receipts/vx/data";
import {
  canCloseDay,
  countedCash,
  DENOMINATIONS,
  isIsoDate,
  isReversalReason,
  latestCloseState,
  summarizeReceipts,
  type DenominationCounts,
} from "@/modules/receipts/vx/domain/day-close";
import { insertCloseEvent, insertReversalRequest, listCloseEvents } from "@/vx/screens/receipts/data";
import { assertNotPreviewing } from "@/vx/view-as";

export type DeskActionResult = { ok: true; kind?: "reversed" | "requested" | "exists" } | { ok: false; error: string };

const REASON_LABEL: Record<string, string> = {
  wrong_amount: "Wrong amount typed",
  wrong_student: "Wrong student",
  cheque_bounced: "Cheque bounced",
  duplicate: "Entered twice",
};

function failure(caught: unknown): DeskActionResult {
  return { ok: false, error: caught instanceof Error ? caught.message : "Something went wrong. Try again." };
}

/**
 * Close a desk day after counting the cash. The totals are worked out again
 * here from the receipts, never taken from the browser, and the close is a new
 * row: nothing about the receipts themselves changes.
 */
export async function closeDayAction(input: {
  date: string;
  sessionLabel: string;
  denominations: DenominationCounts;
  upiChecked: boolean;
  note: string;
}): Promise<DeskActionResult> {
  try {
    const staff = await assertPermission("fees:collect");
    await assertNotPreviewing();
    if (!isIsoDate(input.date)) return { ok: false, error: "Pick a real day." };

    const events = await listCloseEvents(input.date, input.date);
    if (latestCloseState(events).closed) return { ok: false, error: "This day is already closed." };

    const { rows } = await loadDeskReceipts(input.sessionLabel, input.date, input.date);
    const day = rows.filter((r) => r.paymentDate === input.date);
    const summary = summarizeReceipts(day);
    const denominations: Record<string, number> = {};
    for (const d of DENOMINATIONS) {
      const n = Math.max(0, Math.floor(Number(input.denominations[d] ?? 0)));
      if (n > 0) denominations[String(d)] = n;
    }
    const counted = countedCash(input.denominations);
    const expected = summary.byMode.cash.amount;
    const note = input.note.trim().slice(0, 500);
    if (!canCloseDay({ counted, expected, note, upiChecked: input.upiChecked })) {
      return { ok: false, error: input.upiChecked ? "The cash does not match. Add a note for the record." : "Check UPI against the bank app first." };
    }

    await insertCloseEvent({
      paymentDate: input.date,
      action: "close",
      sessionLabel: input.sessionLabel,
      expected: {
        cash: summary.byMode.cash.amount,
        upi: summary.byMode.upi.amount,
        cheque: summary.byMode.cheque.amount,
        bank: summary.byMode.bank.amount,
        total: summary.net,
      },
      denominations,
      cashExpected: expected,
      cashCounted: counted,
      upiChecked: input.upiChecked,
      receiptCount: summary.count,
      reversedCount: summary.reversedCount,
      note: note || null,
      actorId: staff.id,
      actorName: staff.displayName,
    });
    revalidatePath("/receipts");
    return { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}

/** Reopen a closed day. Admin only, with a reason; the close stays on record. */
export async function reopenDayAction(input: { date: string; sessionLabel: string; note: string }): Promise<DeskActionResult> {
  try {
    const staff = await assertPermission("fees:manage");
    await assertNotPreviewing();
    if (!isIsoDate(input.date)) return { ok: false, error: "Pick a real day." };
    const note = input.note.trim().slice(0, 500);
    if (note.length < 5) return { ok: false, error: "Say why the day is being reopened." };
    const events = await listCloseEvents(input.date, input.date);
    if (!latestCloseState(events).closed) return { ok: false, error: "This day is not closed." };
    await insertCloseEvent({
      paymentDate: input.date,
      action: "reopen",
      sessionLabel: input.sessionLabel,
      expected: {},
      denominations: {},
      cashExpected: 0,
      cashCounted: 0,
      upiChecked: false,
      receiptCount: 0,
      reversedCount: 0,
      note,
      actorId: staff.id,
      actorName: staff.displayName,
    });
    revalidatePath("/receipts");
    return { ok: true };
  } catch (caught) {
    return failure(caught);
  }
}

/**
 * Reverse a receipt. An admin reverses through the fee app's own action (an
 * append-only adjustment; the receipt stays in history). Anyone else who takes
 * money files a request for an admin under "Needs you".
 */
export async function reverseReceiptAction(input: { receiptNumber: string; reasonCode: string; note: string }): Promise<DeskActionResult> {
  try {
    const staff = await assertPermission("fees:collect");
    await assertNotPreviewing();
    if (!isReversalReason(input.reasonCode)) return { ok: false, error: "Choose why this receipt is being reversed." };

    const found = await getDeskReceipt(input.receiptNumber);
    if (!found) return { ok: false, error: "Receipt not found." };
    if (found.isReversed) return { ok: false, error: "This receipt is already reversed." };
    const { detail } = found;
    const note = input.note.trim().slice(0, 400);

    if (feePermissionsFor(staff.role).includes("payments:reverse_any")) {
      const form = new FormData();
      form.set("receiptId", detail.id);
      form.set("studentId", detail.studentId);
      form.set("sessionLabel", detail.sessionLabel);
      form.set("reasonCode", input.reasonCode);
      // The fee action needs a note; the design makes it optional, so the reason stands in.
      form.set("reasonNote", note || REASON_LABEL[input.reasonCode]);
      const result = await reverseReceiptAdminAction(form);
      if (!result.ok) return { ok: false, error: result.message ?? "Could not reverse this receipt." };
      revalidatePath("/receipts");
      return { ok: true, kind: "reversed" };
    }

    const outcome = await insertReversalRequest({
      sessionLabel: detail.sessionLabel,
      studentId: detail.studentId,
      receiptId: detail.id,
      receiptNumber: detail.receiptNumber,
      amount: detail.totalAmount - (detail.reversedAmount ?? 0),
      reasonCode: input.reasonCode,
      note: note || null,
      requestedBy: staff.id,
      requestedByName: staff.displayName,
    });
    revalidatePath("/receipts");
    return { ok: true, kind: outcome === "exists" ? "exists" : "requested" };
  } catch (caught) {
    return failure(caught);
  }
}
