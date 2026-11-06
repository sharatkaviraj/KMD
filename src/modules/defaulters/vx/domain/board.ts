import { byClassLabel } from "@/modules/academics/domain/class-order";

import type { ContactSummary, DuesStudent } from "./families";

/**
 * Overdue fees by class and installment. Every installment past its due date
 * has a column: the board had only Inst 1 and 2 and said "Inst 3 and 4 are
 * not due yet", while Inst 3 (due 20 Oct) was in the total (accountant run,
 * 6 Nov 2026). `other` is any other plan row (an EMI's own numbers).
 */
export type ClassInstRow = { classLabel: string; inst1: number; inst2: number; inst3: number; inst4: number; other: number; lastYear: number; total: number };

export type DuesBoard = {
  students: DuesStudent[];
  contacts: Record<string, ContactSummary>;
  classByInst: ClassInstRow[];
};

export type BoardDefaulter = {
  studentId: string; fullName: string; fatherName: string | null; fatherPhone: string | null; motherPhone: string | null;
  classLabel: string; transportRouteId: string | null; overdueAmount: number; totalPending: number; lateFee: number;
  daysOverdue: number; familyGroupId?: string | null; lastPaymentDate: string | null;
};
export type BoardOverdueRow = { studentId: string; classLabel: string | null; installmentNo: number; isCarryForward?: boolean | null; pendingAmount: number | string | null };

/**
 * The Dues board from the Defaulters page rows, the overdue installment rows
 * and fees not due yet. One rule for both sources: the local copy (test
 * accounts and TEST sessions) and Fees itself through the bridge.
 */
export function buildDuesBoard(input: {
  defaulters: readonly BoardDefaulter[];
  overdue: readonly BoardOverdueRow[];
  notDue: ReadonlyMap<string, number>;
  contacts: Iterable<readonly [string, ContactSummary]>;
}): DuesBoard {
  const instByStudent = new Map<string, Set<number>>();
  const byClass = new Map<string, ClassInstRow>();
  for (const row of input.overdue) {
    const pending = Math.max(0, Number(row.pendingAmount) || 0);
    if (pending <= 0) continue;
    const no = row.isCarryForward ? 0 : row.installmentNo;
    const set = instByStudent.get(row.studentId) ?? new Set<number>();
    set.add(no);
    instByStudent.set(row.studentId, set);
    const label = row.classLabel || "—";
    const c = byClass.get(label) ?? { classLabel: label, inst1: 0, inst2: 0, inst3: 0, inst4: 0, other: 0, lastYear: 0, total: 0 };
    if (row.isCarryForward) c.lastYear += pending;
    else if (row.installmentNo === 1) c.inst1 += pending;
    else if (row.installmentNo === 2) c.inst2 += pending;
    else if (row.installmentNo === 3) c.inst3 += pending;
    else if (row.installmentNo === 4) c.inst4 += pending;
    else c.other += pending;
    c.total += pending;
    byClass.set(label, c);
  }

  const students: DuesStudent[] = input.defaulters.map((r) => ({
    studentId: r.studentId,
    fullName: r.fullName,
    fatherName: r.fatherName,
    fatherPhone: r.fatherPhone ?? r.motherPhone,
    classLabel: r.classLabel,
    transportRouteId: r.transportRouteId,
    overdueAmount: r.overdueAmount,
    totalPending: r.totalPending,
    lateFee: r.lateFee,
    notDueYet: input.notDue.get(r.studentId) ?? 0,
    daysOverdue: r.daysOverdue,
    familyGroupId: r.familyGroupId ?? null,
    lastPaymentDate: r.lastPaymentDate,
    overdueInstallments: [...(instByStudent.get(r.studentId) ?? [])].sort((a, b) => a - b),
  }));

  const contacts: Record<string, ContactSummary> = {};
  for (const [id, c] of input.contacts) {
    contacts[id] = { lastContactedAt: c.lastContactedAt, lastOutcome: c.lastOutcome ?? null, lastChannel: c.lastChannel ?? null, snoozeUntil: c.snoozeUntil ?? null };
  }

  const classByInst = [...byClass.values()].sort((a, b) => byClassLabel(a.classLabel, b.classLabel));
  return { students, contacts, classByInst };
}

export type LeftOwing = {
  studentId: string;
  fullName: string;
  fatherName: string | null;
  phone: string | null;
  status: string;
  classLabel: string | null;
  owed: number;
  lastPaymentDate: string | null;
};

type RecoveryLike = {
  studentId: string; fullName: string; fatherName: string | null; phone: string | null; status: string;
  classLabel: string | null; lastPaymentDate: string | null; dues: readonly { sessionLabel: string | null; remainingAmount: number }[];
};

/**
 * Children who left, graduated or went inactive with money still owed in this
 * session. Not in headcount.
 *
 * The recovery queue spans every session, so on TEST-2026-27 the Left owing
 * tab and the reminder audience were reading live-session children (TEST
 * school day, 6 Nov 2026, accountant B2). Only installments that belong to
 * `sessionLabel` count — a carry-forward row sits in the session it was
 * carried into, so last year's balance is still here.
 */
export function leftOwingInSession(rows: readonly RecoveryLike[], sessionLabel: string): LeftOwing[] {
  return rows
    .map((r) => ({ r, owed: r.dues.filter((d) => d.sessionLabel === sessionLabel).reduce((s, d) => s + Math.max(0, d.remainingAmount), 0) }))
    .filter(({ owed }) => owed > 0)
    .map(({ r, owed }) => ({
      studentId: r.studentId,
      fullName: r.fullName,
      fatherName: r.fatherName,
      phone: r.phone,
      status: r.status,
      classLabel: r.classLabel,
      owed,
      lastPaymentDate: r.lastPaymentDate,
    }))
    .sort((a, b) => b.owed - a.owed);
}

type FamilyInstallmentRow = {
  studentId: string; admissionNo: string | null; route: string | null; installmentNo: number; isCarryForward: boolean;
  label: string; dueDate: string; pendingAmount: number; lateFeePending: number; balanceStatus: string; baseCharge: number;
};
type FamilyContactRow = { studentId: string; contactedAt: string; channel: string | null; outcome: string | null; note: string | null };

/**
 * The family panel from Fees' rows: each child's installments in Fees' order,
 * the SR number and route under the name, and the 20 newest contacts.
 */
export function familyDetailFrom(ids: readonly string[], rows: { installments: readonly FamilyInstallmentRow[]; contacts: readonly FamilyContactRow[] }) {
  const installments: Record<string, { no: number; label: string; dueDate: string; pending: number; lateFee: number; status: string; carry: boolean; amount: number }[]> = {};
  const meta: Record<string, { admissionNo: string | null; route: string | null }> = {};
  for (const id of ids) {
    const mine = rows.installments.filter((r) => r.studentId === id);
    meta[id] = { admissionNo: mine[0]?.admissionNo ?? null, route: mine[0]?.route ?? null };
    installments[id] = mine.map((r) => ({
      no: r.isCarryForward ? 0 : r.installmentNo,
      label: r.label,
      dueDate: r.dueDate,
      pending: Math.max(0, r.pendingAmount),
      lateFee: Math.max(0, r.lateFeePending),
      status: r.balanceStatus,
      carry: r.isCarryForward,
      amount: Math.max(0, r.baseCharge),
    }));
  }
  const contacts = rows.contacts
    .filter((c) => ids.includes(c.studentId))
    .map((c) => ({ at: c.contactedAt, channel: c.channel, outcome: c.outcome, note: c.note, studentId: c.studentId }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 20);
  return { installments, contacts, meta };
}
