"use server";

/**
 * Collect on the Fees bridge (plan §5, the bridge adapter). Real staff only:
 * `credentials()` in the bridge client refuses anyone `usesCanonicalFees`
 * does not admit, and Fees re-checks the actor grant. Each action checks this
 * app's permission and the session fence first; posting also needs the bridge
 * writes switch (`FEES_BRIDGE_WRITES_ENABLED`) and refuses a preview.
 *
 * Nothing here retries. A lost or unreadable answer to a post comes back
 * `uncertain`, and the screen asks `collectStatusAction` with the same id.
 */

import { z } from "zod";

import { duesFromBridge, studentRowFromDirectory } from "@/modules/collect/domain/bridge-map";
import type { LedgerMode } from "@/modules/collect/domain/cash";
import type { CollectPost, PostOutcome, Prepared, SavedReceipt, StatusOutcome } from "@/modules/collect/domain/types";
import type { DuesAnswer, SearchAnswer } from "@/modules/collect/data/money-port";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertSessionWritable } from "@/platform/auth/test-session-access";
import { getBridgeCollectDues, getBridgeCommand, lookupBridgeDirectory, postBridgePayment, quoteBridgePayment } from "@/platform/fees-bridge/client";
import type { BridgePostedPayment, BridgePostInput } from "@/platform/fees-bridge/contracts";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { sourceReceiptHref } from "@/vx/screens/receipts/source-receipt";

const SESSION = z.string().regex(/^\d{4}-\d{2}$/);
const LEDGER_MODES = ["cash", "upi", "bank_transfer", "cheque"] as const;

function why(error: unknown, fallback: string): string {
  return error instanceof FeesBridgeError && error.message ? error.message : fallback;
}

export async function collectSearchAction(sessionLabel: string, query: string): Promise<SearchAnswer> {
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, sessionLabel);
    const result = await lookupBridgeDirectory({ sessionLabel: SESSION.parse(sessionLabel), query: z.string().trim().min(2).max(100).parse(query), status: "active", pageSize: 10 });
    return { ok: true, rows: result.students.map(studentRowFromDirectory) };
  } catch (error) {
    return { ok: false, message: why(error, "The search did not come back.") };
  }
}

export async function collectDuesAction(studentId: string, sessionLabel: string): Promise<DuesAnswer> {
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, sessionLabel);
    const read = await getBridgeCollectDues(z.uuid().parse(studentId), SESSION.parse(sessionLabel));
    return { ok: true, dues: duesFromBridge(read) };
  } catch (error) {
    return { ok: false, message: why(error, "This child's dues could not be loaded.") };
  }
}

/**
 * Fees' quote for one child's payment: first without a waiver (the late fee
 * owed on that date), then — when waiving — with the whole of it, as the live
 * desk's review does. The hash that comes back is what the post must carry.
 */
export async function collectQuoteAction(input: { studentId: string; sessionLabel: string; amount: number; paymentDate: string; waive: boolean }): Promise<Prepared> {
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, input.sessionLabel);
    const body = {
      studentId: z.uuid().parse(input.studentId), sessionLabel: SESSION.parse(input.sessionLabel), paymentDate: z.iso.date().parse(input.paymentDate),
      amount: z.number().int().positive().parse(input.amount), quickDiscountAmount: 0, lateFeeWaiverAmount: 0,
    };
    const plain = await quoteBridgePayment(body);
    const quote = z.boolean().parse(input.waive) && plain.lateFeePending > 0 ? await quoteBridgePayment({ ...body, lateFeeWaiverAmount: plain.lateFeePending }) : plain;
    return {
      ok: true,
      quoteHash: quote.quoteHash,
      lateFee: plain.lateFeePending,
      maxPayable: quote.payableAfterAdjustments,
      rows: null,
      acceptedModes: quote.acceptedPaymentModes.filter((m): m is LedgerMode => (LEDGER_MODES as readonly string[]).includes(m)),
    };
  } catch (error) {
    return { ok: false, message: why(error, "Fees could not quote this payment.") };
  }
}

function savedFrom(result: BridgePostedPayment): SavedReceipt {
  const split = result.paymentMode === "split";
  return {
    receiptId: result.receiptId,
    receiptNumber: result.receiptNumber,
    studentId: result.studentId,
    amount: result.amountReceived,
    paymentDate: result.paymentDate,
    paymentMode: result.paymentMode,
    tenders: result.tenders?.flatMap((line) => ((LEDGER_MODES as readonly string[]).includes(line.mode) ? [{ mode: line.mode as LedgerMode, amount: line.amount }] : [])) ?? null,
    receivedBy: result.receivedBy,
    lateFeeWaived: result.lateFeeWaivedApplied,
    remaining: result.remainingBalance,
    // One draws a single-mode Fees receipt itself (`/receipts/[no]`); a split one
    // is not in its receipt template yet, so Print opens Fees' own print page.
    printHref: split ? result.printUrl : sourceReceiptHref(result.receiptNumber, result.receiptId, result.sessionLabel),
    printExternal: split,
  };
}

export async function collectPostAction(input: CollectPost & { sessionLabel: string }): Promise<PostOutcome> {
  let body: BridgePostInput;
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, input.sessionLabel);
    body = {
      studentId: input.studentId, sessionLabel: input.sessionLabel, paymentDate: input.paymentDate, amount: input.amount,
      quickDiscountAmount: 0, lateFeeWaiverAmount: input.lateFeeWaiver, commandId: input.commandId, quoteHash: input.quoteHash ?? "",
      ...(input.tenders ? { tenders: input.tenders } : { paymentMode: input.paymentMode ?? undefined }),
      referenceNumber: input.tenders ? null : input.reference, remarks: input.remarks,
      acknowledgeDailyDuplicate: input.acknowledgeDailyDuplicate, acknowledgeNearDuplicate: input.acknowledgeNearDuplicate,
    };
  } catch (error) {
    return { kind: "refused", code: "forbidden", message: error instanceof Error ? error.message : "You cannot take payments here.", quoteChanged: false };
  }
  try {
    return { kind: "saved", receipt: savedFrom(await postBridgePayment(body)) };
  } catch (error) {
    if (error instanceof FeesBridgeError) {
      if (error.uncertain) return { kind: "uncertain", message: error.message };
      if (error.code === "daily_duplicate" || error.code === "near_duplicate") return { kind: "duplicate", near: error.code === "near_duplicate", message: error.message, receiptNumber: null };
      return { kind: "refused", code: error.code, message: error.message, quoteChanged: error.code === "quote_changed" };
    }
    // A malformed request never left One: nothing was posted.
    return { kind: "refused", code: "invalid_request", message: error instanceof z.ZodError ? "Check the payment details." : "This payment could not be sent.", quoteChanged: false };
  }
}

export async function collectStatusAction(input: { commandId: string; sessionLabel: string }): Promise<StatusOutcome> {
  try {
    await assertPermission("fees:collect");
    await assertSessionWritable(null, input.sessionLabel);
    const result = await getBridgeCommand(z.uuid().parse(input.commandId));
    return result.status === "completed" ? { kind: "saved", receipt: savedFrom(result) } : { kind: "not_saved" };
  } catch (error) {
    return { kind: "unknown", message: why(error, "Fees could not be asked about this payment.") };
  }
}
