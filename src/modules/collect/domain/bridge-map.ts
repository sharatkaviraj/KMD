/**
 * Fees' bridge reads (`/directory/lookup`, `/students/:id/fees|receipts|household`)
 * in Collect's shapes. Pure; the zod schemas that already parsed them are the
 * contract, this only renames. Nothing is guessed: no household → no siblings.
 */

import type { z } from "zod";

import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import type {
  bridgeDirectoryLookupSchema,
  BridgeStudentFees,
  BridgeStudentHousehold,
  BridgeStudentReceipts,
} from "@/platform/fees-bridge/student-read-contracts";

import type { LedgerMode } from "./cash";
import type { CollectDues, CollectReceiptRow, CollectStudentRow } from "./types";

type DirectoryRow = z.infer<typeof bridgeDirectoryLookupSchema>["students"][number];

const whole = (n: number | null | undefined) => (Number.isFinite(n) ? Math.max(0, Math.round(Number(n))) : 0);

export function studentRowFromDirectory(row: DirectoryRow): CollectStudentRow {
  // `outstandingAmount` is the fee balance; the late fee is reported apart and never added.
  return {
    id: row.id,
    name: row.fullName,
    sr: row.admissionNo,
    classLabel: row.classLabel,
    father: row.fatherName,
    phone: row.fatherPhone ?? row.motherPhone,
    fees: whole(row.outstandingAmount),
    late: whole(row.pendingLateFeeAmount),
    siblings: row.siblingCount,
  };
}

export function ledgerRowsFromFees(fees: Pick<BridgeStudentFees, "installmentBalances">): DeskLedgerRow[] {
  return (fees.installmentBalances ?? []).map((row) => ({
    id: row.installmentId,
    installmentNo: row.installmentNo,
    label: row.installmentLabel,
    isCarryForward: Boolean(row.isCarryForward),
    dueDate: row.dueDate,
    charge: whole(row.baseCharge),
    feesPaid: whole(row.feeSettledAmount),
    feesPending: whole(row.pendingAmount),
    lateFeePending: whole(row.lateFeePending),
    lateFeeRaw: whole(row.rawLateFee),
    lateFeeWaived: whole(row.waiverApplied),
    lateFeeStatus: row.lateFeeStatus === "waived" ? "waived" : row.lateFeeStatus,
    planPriority: row.planPriority,
  }));
}

const CLOSED_PLAN = /cancel|complete|supersed|closed|ended/i;

export function onActivePlan(fees: Pick<BridgeStudentFees, "repaymentPlan">): boolean {
  const plan = fees.repaymentPlan;
  return Boolean(plan && !CLOSED_PLAN.test(plan.summary.lifecycle));
}

export function receiptRowsFromBridge(read: Pick<BridgeStudentReceipts, "receipts">): CollectReceiptRow[] {
  return (read.receipts ?? []).map((row) => ({
    id: row.id,
    number: row.receiptNumber,
    date: row.paymentDate.slice(0, 10),
    amount: whole(row.totalAmount),
    mode: row.paymentModeLabel || row.paymentMode,
    createdAt: row.createdAt,
    reversed: row.isReversed,
  }));
}

export function duesFromBridge(input: {
  fees: BridgeStudentFees;
  receipts: BridgeStudentReceipts | null;
  household: BridgeStudentHousehold | null;
  acceptedModes?: LedgerMode[] | null;
}): CollectDues {
  const { fees, receipts, household } = input;
  const shown = receiptRowsFromBridge(receipts ?? { receipts: null });
  const total = receipts?.pagination?.totalCount ?? shown.length;
  const members = household?.family?.members ?? null;
  return {
    student: {
      id: fees.student.id,
      name: fees.student.fullName,
      sr: fees.student.admissionNo,
      classLabel: fees.student.classLabel,
      father: fees.student.fatherName,
      phone: fees.student.fatherPhone ?? fees.student.motherPhone,
    },
    rows: ledgerRowsFromFees(fees),
    onPlan: onActivePlan(fees),
    receipts: shown,
    olderReceipts: Math.max(0, total - shown.length),
    siblings: (members ?? [])
      .filter((m) => !m.isSelf && m.id !== fees.student.id)
      .map((m) => ({ id: m.id, name: m.fullName, classLabel: m.classLabel, outstanding: m.financials ? whole(m.financials.outstanding) : null })),
    siblingsKnown: members !== null,
    acceptedModes: input.acceptedModes ?? null,
  };
}

/** Paid today already: a receipt dated today, or entered today, that was not reversed. */
export function paidToday(receipts: readonly CollectReceiptRow[], today: string, schoolDayOf: (iso: string) => string): CollectReceiptRow | null {
  return receipts.find((r) => !r.reversed && (r.date === today || (r.createdAt !== null && schoolDayOf(r.createdAt) === today))) ?? null;
}
