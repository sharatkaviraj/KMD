import "server-only";

import { byClassLabel } from "@/modules/academics/domain/class-order";

import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createClient } from "@/modules/fees/platform/supabase/server";
import { getWorkbookInstallmentRows } from "@/modules/fees/data/queries";
import { getStudentContactLog } from "@/modules/defaulters/data/contacts";
import { getDefaultersPageData } from "@/modules/defaulters/data/queries";
import { EMPTY_DEFAULTER_FILTERS } from "@/modules/defaulters/domain/types";
import { getReceiptsPage } from "@/modules/receipts/data/queries";
import { EMPTY_RECEIPT_FILTERS } from "@/modules/receipts/domain/filters";
import { getRecoveryQueue } from "@/modules/recovery/data/queries";
import type { ContactSummary, DuesStudent, PaymentFact } from "@/modules/defaulters/vx/domain/families";

/*
 * Reads for the redesigned Dues & calls screen (/dues). Every amount comes from
 * the ported defaulter, workbook and recovery queries, which already keep fees
 * and late fees apart. Nothing here writes.
 */

export type ClassInstRow = { classLabel: string; inst1: number; inst2: number; lastYear: number; total: number };

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
    const c = byClass.get(label) ?? { classLabel: label, inst1: 0, inst2: 0, lastYear: 0, total: 0 };
    if (row.isCarryForward) c.lastYear += pending;
    else if (row.installmentNo === 1) c.inst1 += pending;
    else if (row.installmentNo === 2) c.inst2 += pending;
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

/** Children who left, graduated or went inactive with money still owed. Not in headcount. */
export async function loadLeftOwing(): Promise<LeftOwing[]> {
  const q = await getRecoveryQueue();
  return q.rows
    .filter((r) => r.totalRemaining > 0)
    .map((r) => ({
      studentId: r.studentId,
      fullName: r.fullName,
      fatherName: r.fatherName,
      phone: r.phone,
      status: r.status,
      classLabel: r.classLabel,
      owed: r.totalRemaining,
      lastPaymentDate: r.lastPaymentDate,
    }))
    .sort((a, b) => b.owed - a.owed);
}

/** Calls logged today (school day, IST) across the desk. */
export async function countCallsToday(sessionLabel: string, today: string): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("defaulter_contacts")
    .select("id", { count: "exact", head: true })
    .eq("session_label", sessionLabel)
    .eq("channel", "call")
    .gte("contacted_at", `${today}T00:00:00+05:30`);
  return count ?? 0;
}

/** Money received this week, from the receipt aggregate. */
export async function collectedThisWeek(sessionLabel: string): Promise<number> {
  const { query: _q, sessionLabel: _s, ...base } = EMPTY_RECEIPT_FILTERS;
  void _q;
  void _s;
  const res = await getReceiptsPage("", { page: 1, pageSize: 1 }, sessionLabel, { ...base, datePreset: "week" });
  return res.aggregate.totalAmount;
}

/** Receipts of these children dated on or after `since`, to judge promises. */
export async function paymentsSince(studentIds: string[], since: string): Promise<PaymentFact[]> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const supabase = await createClient();
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
  const supabase = await createClient();
  const { data } = await fetchInChunks<{ id: string; full_name: string; father_name: string | null; primary_phone: string | null }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    supabase
      .from("students")
      .select("id, full_name, father_name, primary_phone")
      .in("id", chunk)
      .returns<{ id: string; full_name: string; father_name: string | null; primary_phone: string | null }[]>(),
  );
  return data.map((s) => ({ studentId: s.id, fullName: s.full_name, fatherName: s.father_name, phone: s.primary_phone }));
}

export type KidInstallment = { no: number; label: string; dueDate: string; pending: number; lateFee: number; status: string; carry: boolean };

export type FamilyContact = { at: string; channel: string | null; outcome: string | null; note: string | null; studentId: string };

/** Installments and the contact log for the children of one family. */
export async function loadFamilyDetail(sessionLabel: string, studentIds: string[]): Promise<{ installments: Record<string, KidInstallment[]>; contacts: FamilyContact[] }> {
  const ids = studentIds.slice(0, 8);
  const [inst, logs] = await Promise.all([
    Promise.all(ids.map((id) => getWorkbookInstallmentRows({ sessionLabel, studentId: id }))),
    Promise.all(ids.map((id) => getStudentContactLog(id, sessionLabel, { limit: 15 }))),
  ]);
  const installments: Record<string, KidInstallment[]> = {};
  ids.forEach((id, i) => {
    installments[id] = inst[i].map((r) => ({
      no: r.isCarryForward ? 0 : r.installmentNo,
      label: r.installmentLabel,
      dueDate: r.dueDate,
      pending: Math.max(0, Number(r.pendingAmount) || 0),
      lateFee: Math.max(0, Number(r.lateFeePending) || 0),
      status: r.balanceStatus,
      carry: r.isCarryForward === true,
    }));
  });
  const contacts: FamilyContact[] = ids
    .flatMap((id, i) => logs[i].map((c) => ({ at: c.contactedAt, channel: c.channel, outcome: c.outcome, note: c.note, studentId: id })))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 20);
  return { installments, contacts };
}
