import "server-only";

import { byClassLabel } from "@/modules/academics/domain/class-order";

import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { getWorkbookInstallmentRows } from "@/modules/fees/data/queries";
import { getStudentContactLog } from "@/modules/defaulters/data/contacts";
import { getDefaultersPageData } from "@/modules/defaulters/data/queries";
import { EMPTY_DEFAULTER_FILTERS } from "@/modules/defaulters/domain/types";
import { getReceiptsPage } from "@/modules/receipts/data/queries";
import { EMPTY_RECEIPT_FILTERS } from "@/modules/receipts/domain/filters";
import { getRecoveryQueue } from "@/modules/recovery/data/queries";
import type { ContactSummary, DuesStudent, PaymentFact } from "@/modules/defaulters/vx/domain/families";
import type { StudentRecoveryDueRow } from "@/modules/recovery/domain/types";

/*
 * Reads for the redesigned Dues & calls screen (/dues). Every amount comes from
 * the ported defaulter, workbook and recovery queries, which already keep fees
 * and late fees apart. Nothing here writes.
 *
 * The direct reads here use the fee service-role client: /dues checks
 * `fees:view` before it calls them, and the cookie client returned nothing for
 * an office account with no `public.users` row ("collected this week ₹0.0 L",
 * school-day run, accountant B4).
 */
const feeReader = () => createAdminClient();

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

/** Everyone with fees still owed this session, with the overdue installment numbers per child. */
export async function loadDuesBoard(sessionLabel: string): Promise<DuesBoard> {
  const [page, overdue] = await Promise.all([
    getDefaultersPageData(EMPTY_DEFAULTER_FILTERS, sessionLabel),
    getWorkbookInstallmentRows({ sessionLabel, overdueOnly: true }),
  ]);

  const instByStudent = new Map<string, Set<number>>();
  const byClass = new Map<string, ClassInstRow>();
  for (const row of overdue) {
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

  const students: DuesStudent[] = page.rows.map((r) => ({
    studentId: r.studentId,
    fullName: r.fullName,
    fatherName: r.fatherName,
    fatherPhone: r.fatherPhone ?? r.motherPhone,
    classLabel: r.classLabel,
    transportRouteId: r.transportRouteId,
    overdueAmount: r.overdueAmount,
    totalPending: r.totalPending,
    lateFee: r.lateFee,
    daysOverdue: r.daysOverdue,
    familyGroupId: r.familyGroupId ?? null,
    lastPaymentDate: r.lastPaymentDate,
    overdueInstallments: [...(instByStudent.get(r.studentId) ?? [])].sort((a, b) => a - b),
  }));

  const contacts: Record<string, ContactSummary> = {};
  for (const [id, c] of page.contactSummaries) {
    contacts[id] = { lastContactedAt: c.lastContactedAt, lastOutcome: c.lastOutcome ?? null, lastChannel: c.lastChannel ?? null, snoozeUntil: c.snoozeUntil };
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
export async function loadLeftOwing(sessionLabel: string): Promise<LeftOwing[]> {
  const q = await getRecoveryQueue();
  return leftOwingInSession(q.rows, sessionLabel);
}

export function leftOwingInSession(rows: readonly StudentRecoveryDueRow[], sessionLabel: string): LeftOwing[] {
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

/**
 * The children a call was logged for today (school day, IST) across the desk.
 *
 * One call to a family writes one contact row per child, so counting rows
 * said "Calls done today 3 of 75" after a single call to a family of three
 * (TEST school day, 6 Nov 2026, accountant B8). The caller counts families.
 */
export async function studentsCalledToday(sessionLabel: string, today: string): Promise<string[]> {
  const supabase = feeReader();
  const { data } = await supabase
    .from("defaulter_contacts")
    .select("student_id")
    .eq("session_label", sessionLabel)
    .eq("channel", "call")
    .gte("contacted_at", `${today}T00:00:00+05:30`)
    .limit(5000);
  return [...new Set(((data ?? []) as { student_id: string | null }[]).map((r) => String(r.student_id ?? "")).filter(Boolean))];
}

/** Money received this week, from the receipt aggregate. */
export async function collectedThisWeek(sessionLabel: string): Promise<number> {
  const { query: _q, sessionLabel: _s, ...base } = EMPTY_RECEIPT_FILTERS;
  void _q;
  void _s;
  const res = await getReceiptsPage("", { page: 1, pageSize: 1 }, sessionLabel, { ...base, datePreset: "week" }, feeReader());
  return res.aggregate.totalAmount;
}

/** Receipts of these children dated on or after `since`, to judge promises. */
export async function paymentsSince(studentIds: string[], since: string): Promise<PaymentFact[]> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const supabase = feeReader();
  const { data } = await fetchInChunks<{ student_id: string; payment_date: string; total_amount: number; receipt_number: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    supabase
      .from("receipts")
      .select("student_id, payment_date, total_amount, receipt_number")
      .in("student_id", chunk)
      .gte("payment_date", since)
      .returns<{ student_id: string; payment_date: string; total_amount: number; receipt_number: string }[]>(),
  );
  return data.map((r) => ({ studentId: r.student_id, paymentDate: r.payment_date, amount: Number(r.total_amount) || 0, receiptNumber: r.receipt_number }));
}

export type StudentBrief = { studentId: string; fullName: string; fatherName: string | null; phone: string | null };

/** Names for children who are not on today's dues list (a promise kept, a child who left). */
export async function studentBriefs(studentIds: string[]): Promise<StudentBrief[]> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const supabase = feeReader();
  const { data } = await fetchInChunks<{ id: string; full_name: string; father_name: string | null; primary_phone: string | null }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    supabase
      .from("students")
      .select("id, full_name, father_name, primary_phone")
      .in("id", chunk)
      .returns<{ id: string; full_name: string; father_name: string | null; primary_phone: string | null }[]>(),
  );
  return data.map((s) => ({ studentId: s.id, fullName: s.full_name, fatherName: s.father_name, phone: s.primary_phone }));
}

export type KidInstallment = {
  no: number;
  label: string;
  dueDate: string;
  pending: number;
  lateFee: number;
  status: string;
  carry: boolean;
  /** The installment's charge, so a paid one can say what was paid. */
  amount?: number;
};

/** What the family panel says under a child's name: SR number and bus route. */
export type KidMeta = { admissionNo: string | null; route: string | null };

export type FamilyContact = { at: string; channel: string | null; outcome: string | null; note: string | null; studentId: string };

/** Installments and the contact log for the children of one family. */
export async function loadFamilyDetail(
  sessionLabel: string,
  studentIds: string[],
): Promise<{ installments: Record<string, KidInstallment[]>; contacts: FamilyContact[]; meta: Record<string, KidMeta> }> {
  const ids = studentIds.slice(0, 8);
  const [inst, logs] = await Promise.all([
    Promise.all(ids.map((id) => getWorkbookInstallmentRows({ sessionLabel, studentId: id }))),
    Promise.all(ids.map((id) => getStudentContactLog(id, sessionLabel, { limit: 15 }))),
  ]);
  const installments: Record<string, KidInstallment[]> = {};
  const meta: Record<string, KidMeta> = {};
  ids.forEach((id, i) => {
    const first = inst[i][0];
    meta[id] = { admissionNo: first?.admissionNo ?? null, route: first?.transportRouteName ?? first?.transportRouteCode ?? null };
    installments[id] = inst[i].map((r) => ({
      no: r.isCarryForward ? 0 : r.installmentNo,
      label: r.installmentLabel,
      dueDate: r.dueDate,
      pending: Math.max(0, Number(r.pendingAmount) || 0),
      lateFee: Math.max(0, Number(r.lateFeePending) || 0),
      status: r.balanceStatus,
      carry: r.isCarryForward === true,
      amount: Math.max(0, Number(r.baseCharge) || 0),
    }));
  });
  const contacts: FamilyContact[] = ids
    .flatMap((id, i) => logs[i].map((c) => ({ at: c.contactedAt, channel: c.channel, outcome: c.outcome, note: c.note, studentId: id })))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 20);
  return { installments, contacts, meta };
}
