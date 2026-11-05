/**
 * The local (TEST) ledger's desk reads in Collect's shapes: the same reads the
 * vx Payment Desk uses (`loadDeskBoot`, `loadDeskStudent`), renamed. Pure.
 */

import type { DeskListStudent, DeskStudent } from "@/modules/payments/vx/types";
import type { DeskMode } from "@/modules/payments/vx/domain/desk";

import type { LedgerMode } from "./cash";
import type { CollectDues, CollectStudentRow } from "./types";

const MODE_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", bank_transfer: "Bank", cheque: "Cheque", split: "Cash + UPI", online: "Online" };

/** How many past receipts the dues card is handed; it shows as many as fit. */
export const RECEIPTS_HANDED = 8;

export function studentRowFromDeskList(row: DeskListStudent): CollectStudentRow {
  return {
    id: row.id,
    name: row.name,
    sr: row.sr,
    classLabel: row.classLabel,
    father: row.father,
    phone: row.phone,
    // The roll knows overdue fees and the late fee; the dues card reads the rest.
    fees: Math.max(0, Math.round(row.pendingToday)),
    late: Math.max(0, Math.round(row.lateFee)),
    siblings: 0,
  };
}

export function duesFromDesk(student: DeskStudent, modes: readonly DeskMode[]): CollectDues {
  const receipts = [...student.receipts]
    .sort((a, b) => (b.createdAt ?? b.paymentDate).localeCompare(a.createdAt ?? a.paymentDate))
    .map((r) => ({
      id: r.id,
      number: r.receiptNumber,
      date: r.paymentDate,
      amount: Math.round(r.amount),
      mode: MODE_LABEL[r.mode] ?? r.mode,
      createdAt: r.createdAt,
      reversed: r.isReversed,
    }));
  return {
    student: { id: student.id, name: student.name, sr: student.sr, classLabel: student.classLabel, father: student.father, phone: student.phone },
    rows: student.rows,
    onPlan: student.onPlan,
    receipts: receipts.slice(0, RECEIPTS_HANDED),
    olderReceipts: Math.max(0, receipts.length - RECEIPTS_HANDED),
    siblings: student.siblings.map((s) => ({ id: s.id, name: s.name, classLabel: s.classLabel, outstanding: null })),
    siblingsKnown: true,
    acceptedModes: modes.filter((m): m is LedgerMode => ["cash", "upi", "bank_transfer", "cheque"].includes(m)),
  };
}

export function modeLabel(mode: string): string {
  return MODE_LABEL[mode] ?? mode;
}
