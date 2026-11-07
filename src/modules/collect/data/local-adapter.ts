/**
 * The local adapter (plan §5): Collect for test accounts and confined
 * deployments, on the TEST session. It posts through the vx Payment Desk's own
 * actions (`app/(app)/payments/actions.ts`), which post through the ported fee
 * action — same validation, duplicate guards, waiver-then-post order and
 * `client_request_id` (= the command id) — and it writes the vx desk's
 * payment attempt before every post, so the classic desk sees an unfinished
 * Collect payment too.
 *
 * Cash + UPI is not offered: the TEST ledger has no tender lines yet.
 */

import {
  checkDeskPaymentAction,
  loadDeskPreviewAction,
  loadStudentDeskAction,
  postDeskPaymentAction,
  settleDeskSaveAction,
  type DeskPostInput,
} from "@/app/(app)/payments/actions";
import { duesFromDesk, studentRowFromDeskList } from "@/modules/collect/domain/local-map";
import { searchLocal } from "@/modules/collect/domain/search";
import type { CollectDues, LikelyRow, SavedReceipt } from "@/modules/collect/domain/types";
import { clearPaymentAttempt, paymentAttemptKey, PaymentAttemptConflict, PaymentRecoveryUnavailable, writePaymentAttempt } from "@/modules/payments/vx/attempt";
import type { DeskListStudent } from "@/modules/payments/vx/types";

import type { MoneyPort, MoneyPortInfo } from "./money-port";

const LIKELY_CAP = 12;

export function localAdapter(info: MoneyPortInfo, roll: readonly DeskListStudent[]): MoneyPort {
  const session = info.sessionLabel;
  const rows = roll.map(studentRowFromDeskList);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const cache = new Map<string, CollectDues>();
  const attemptKey = paymentAttemptKey(info.userId, session);

  function receiptOf(input: { receiptId: string; receiptNumber: string; studentId: string; amount: number; paymentDate: string; mode: string; waived: number; remaining: number | null }): SavedReceipt {
    return {
      receiptId: input.receiptId, receiptNumber: input.receiptNumber, studentId: input.studentId, amount: input.amount,
      paymentDate: input.paymentDate, paymentMode: input.mode, tenders: null, receivedBy: info.staffName,
      lateFeeWaived: input.waived, remaining: input.remaining,
      printHref: `/receipts/${encodeURIComponent(input.receiptNumber)}?print=1`, printExternal: false,
    };
  }

  return {
    ...info,
    async search(raw) {
      return { ok: true, rows: searchLocal(rows, raw) };
    },
    async likely(recentIds) {
      const out: LikelyRow[] = [];
      const seen = new Set<string>();
      const push = (id: string, reason: LikelyRow["reason"]) => {
        const row = byId.get(id);
        if (!row || seen.has(id)) return;
        seen.add(id);
        out.push({ ...row, reason });
      };
      const last = recentIds[0] ? cache.get(recentIds[0]) : undefined;
      for (const sibling of last?.siblings ?? []) if ((byId.get(sibling.id)?.fees ?? 0) > 0) push(sibling.id, "sibling_of_last");
      [...rows].filter((r) => r.fees > 0 && r.late > 0).sort((a, b) => b.late - a.late || b.fees - a.fees).slice(0, 6).forEach((r) => push(r.id, "overdue_late"));
      [...rows].filter((r) => r.fees > 0).sort((a, b) => b.fees - a.fees).slice(0, 6).forEach((r) => push(r.id, "overdue"));
      recentIds.forEach((id) => push(id, "paid_recently"));
      return out.slice(0, LIKELY_CAP);
    },
    async dues(studentId) {
      try {
        const result = await loadStudentDeskAction({ studentId, sessionLabel: session });
        if (!result.ok) return { ok: false, message: result.message };
        const dues = duesFromDesk(result.student, info.modes);
        cache.set(studentId, dues);
        return { ok: true, dues };
      } catch {
        return { ok: false, message: "This child's dues could not be loaded." };
      }
    },
    async prepare(input) {
      try {
        let ledger = cache.get(input.studentId)?.rows ?? null;
        if (!ledger || input.paymentDate !== info.today) {
          const read = await loadDeskPreviewAction({ studentId: input.studentId, sessionLabel: session, paymentDate: input.paymentDate });
          if (!read.ok) return { ok: false, message: read.message };
          ledger = read.rows;
        }
        const fees = ledger.reduce((s, r) => s + Math.max(0, r.feesPending), 0);
        const late = ledger.reduce((s, r) => s + Math.max(0, r.lateFeePending), 0);
        return { ok: true, quoteHash: null, lateFee: late, maxPayable: fees + (input.waive ? 0 : late), rows: input.paymentDate === info.today ? null : ledger, acceptedModes: info.modes };
      } catch {
        return { ok: false, message: "The dues for this date did not come back." };
      }
    },
    async post(input) {
      if (!input.paymentMode || input.tenders) return { kind: "refused", code: "split_unavailable", message: "Cash + UPI is not available in the test session yet.", quoteChanged: false };
      const desk: DeskPostInput = {
        clientRequestId: input.commandId, studentId: input.studentId, sessionLabel: session, paymentDate: input.paymentDate,
        mode: input.paymentMode, amount: input.amount, quickDiscountAmount: 0, lateFeeWaiver: input.lateFeeWaiver,
        reference: input.reference ?? "", remarks: input.remarks ?? "", receivedBy: info.staffName,
        acknowledgeDuplicate: input.acknowledgeDailyDuplicate || input.acknowledgeNearDuplicate,
      };
      try {
        await writePaymentAttempt(attemptKey, { input: desk, form: {} });
      } catch (error) {
        if (error instanceof PaymentAttemptConflict) return { kind: "refused", code: "attempt_conflict", message: "Another payment is still unresolved in this browser. Finish it on the classic desk first.", quoteChanged: false };
        if (error instanceof PaymentRecoveryUnavailable) return { kind: "refused", code: "storage", message: "This browser cannot keep a safe copy of the payment. Use an updated browser.", quoteChanged: false };
        return { kind: "refused", code: "storage", message: "This browser could not keep a safe copy of the payment first.", quoteChanged: false };
      }
      let result: Awaited<ReturnType<typeof postDeskPaymentAction>>;
      try {
        result = await postDeskPaymentAction(desk);
      } catch {
        return { kind: "uncertain", message: "The answer did not come back. It may have been saved." };
      }
      if (result.status === "uncertain") return { kind: "uncertain", message: result.message };
      // Anything but uncertain is settled: a refusal posted nothing, a save is a receipt.
      await clearPaymentAttempt(attemptKey, input.commandId).catch(() => undefined);
      if (result.status === "duplicate") return { kind: "duplicate", near: result.kind === "near-duplicate", message: result.message, receiptNumber: result.receiptNumber };
      if (result.status === "error") return { kind: "refused", code: "refused", message: result.message, quoteChanged: false };
      const settled = await settleDeskSaveAction({ receiptId: result.receiptId, receiptNumber: result.receiptNumber, studentId: input.studentId, sessionLabel: session }).catch(() => null);
      return {
        kind: "saved",
        receipt: receiptOf({
          receiptId: result.receiptId, receiptNumber: result.receiptNumber, studentId: input.studentId, amount: input.amount,
          paymentDate: input.paymentDate, mode: input.paymentMode, waived: settled?.receipt?.lateFeeWaived ?? input.lateFeeWaiver,
          remaining: settled?.receipt?.outstandingAfter ?? null,
        }),
      };
    },
    async status(input) {
      try {
        const result = await checkDeskPaymentAction({ studentId: input.studentId, clientRequestId: input.commandId, sessionLabel: session });
        if (result.status === "not_saved") return { kind: "not_saved" };
        if (result.status === "unknown") return { kind: "unknown", message: result.message };
        await clearPaymentAttempt(attemptKey, input.commandId).catch(() => undefined);
        const r = result.receipt;
        return {
          kind: "saved",
          receipt: receiptOf({
            receiptId: result.receiptId, receiptNumber: result.receiptNumber, studentId: input.studentId, amount: r?.total ?? 0,
            paymentDate: r?.paymentDate ?? info.today, mode: r?.mode ?? "cash", waived: r?.lateFeeWaived ?? 0, remaining: r?.outstandingAfter ?? null,
          }),
        };
      } catch {
        return { kind: "unknown", message: "The payment could not be checked." };
      }
    },
  };
}
