"use server";

import { getStudentMasterFieldsByIds, getStudents } from "@/modules/students-fees/data/queries";
import { EMPTY_STUDENT_FILTERS } from "@/modules/students-fees/domain/types";
import { getReceiptsList } from "@/modules/receipts/data/queries";
import { recentReceiptsFor } from "@/modules/students-fees/vx/admin-students";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { assertStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { listMoney, mobileOf } from "@/vx/screens/admin/logic";
import { moneyStatus, type MoneyStatus } from "@/vx/screens/admin/students-logic";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { matchStaff, type StaffHit } from "@/vx/shell/staff-search";

export type { StaffHit };

export type StudentHit = {
  id: string;
  name: string;
  classLabel: string;
  sr: string;
  /** Father's (else mother's) name, when known. */
  parent: string | null;
  href: string;
  /** Pending today / on track / paid up — only for `fees:view`. */
  money: MoneyStatus | null;
};

export type ReceiptHit = {
  id: string;
  number: string;
  amount: number;
  student: string;
  date: string;
  mode: string;
  /** Kept in the list and marked, never hidden (RULES A). */
  reversed: boolean;
  /** Found through the child's name rather than the receipt number (the phone lists these, F04). */
  byChild?: boolean;
  href: string;
};

export type ActionHit =
  | { kind: "collect"; href: string; student: string; pending: number | null }
  | { kind: "call"; tel: string; who: string | null; relation: "father" | "mother"; child: string };

/** `staff`: colleagues by name, for whoever may see the staff list or the timetable (B12). */
export type SearchResult = { students: StudentHit[]; receipts: ReceiptHit[]; actions: ActionHit[]; staff?: StaffHit[] };

const EMPTY: SearchResult = { students: [], receipts: [], actions: [] };

type MoneyFields = { overdueAmount: number; outstandingAmount: number; pendingLateFeeAmount: number; totalPaid: number; totalDue: number; lateFeeTotal: number };

/** The fee app's figures in the design's three words; the late fee is never added in. */
function statusOf(s: MoneyFields): MoneyStatus {
  return moneyStatus(
    listMoney({
      overdueAmount: Number(s.overdueAmount || 0),
      outstandingAmount: Number(s.outstandingAmount || 0),
      pendingLateFeeAmount: Number(s.pendingLateFeeAmount || 0),
      totalPaid: Number(s.totalPaid || 0),
      totalDue: Number(s.totalDue || 0),
      lateFeeTotal: Number(s.lateFeeTotal || 0),
    }),
  );
}

/**
 * The search palette's one server call (Ctrl K, D07-Search / F04-Search).
 * Students for anyone who may see the roster or the fee desk; their money in
 * the design's words only for `fees:view`; receipts only for the fee desk.
 * "Do it now" offers Collect for `fees:collect` and a call to the first
 * child's parent. Teachers get pages only — they have their own class lists.
 */
export async function searchEverythingAction(query: string): Promise<SearchResult> {
  const staff = await assertStaff();
  const q = query.trim();
  if (q.length < 2) return EMPTY;

  const seesStudents = can(staff, "students:view") || can(staff, "fees:view");
  const seesReceipts = can(staff, "fees:view");
  const staffTo = can(staff, "staff:view") ? "staff" : can(staff, "timetable:view") ? "timetable" : null;
  const colleagues = staffTo ? listStaff().then((all) => matchStaff(all, q, staffTo)).catch(() => [] as StaffHit[]) : Promise.resolve([] as StaffHit[]);
  if (!seesStudents && !seesReceipts) {
    const found = await colleagues;
    return found.length ? { ...EMPTY, staff: found } : EMPTY;
  }

  const session = await resolveViewSession({ cookieSession: await getViewSessionCookie() }).catch(() => null);
  const sessionLabel = session?.sessionLabel ?? "";
  const collects = can(staff, "fees:collect");
  const profile = can(staff, "students:view");
  const money = can(staff, "fees:view");

  const [students, receipts] = await Promise.all([
    seesStudents
      ? getStudents({ ...EMPTY_STUDENT_FILTERS, sessionLabel, query: q }).catch(() => [])
      : Promise.resolve([]),
    seesReceipts && /\d/.test(q) ? getReceiptsList(q, sessionLabel).catch(() => []) : Promise.resolve([]),
  ]);

  const top = students.slice(0, 5);
  // The parents' names are not on the list read; one small read for the five
  // shown. A name search finds the first child's latest receipts beside it.
  const byName = seesReceipts && receipts.length === 0 && top.length > 0;
  const [parents, recent] = await Promise.all([
    top.length ? getStudentMasterFieldsByIds(top.map((s) => s.id)).catch(() => null) : null,
    byName ? recentReceiptsFor(top[0].id).catch(() => []) : Promise.resolve([]),
  ]);
  const parentOf = (id: string) => {
    const row = parents?.get(id);
    return (row?.fatherName ?? "").trim() || (row?.motherName ?? "").trim() || null;
  };

  const found = await colleagues;
  const out: SearchResult = { students: [], receipts: [], actions: [], ...(found.length ? { staff: found } : {}) };
  for (const s of top) {
    out.students.push({
      id: s.id,
      name: s.fullName,
      classLabel: s.classLabel,
      sr: s.admissionNo,
      parent: parentOf(s.id),
      href: profile ? `/students/${s.id}` : collects ? `/payments?student=${s.id}` : `/dues?student=${s.id}`,
      money: money ? statusOf(s) : null,
    });
  }

  const first = top[0];
  if (first) {
    if (collects) {
      const status = money ? statusOf(first) : null;
      out.actions.push({ kind: "collect", href: `/payments?student=${first.id}`, student: first.fullName, pending: status?.kind === "pending" ? status.amount : null });
    }
    const record = parents?.get(first.id);
    const father = mobileOf(first.fatherPhone);
    const mother = mobileOf(first.motherPhone);
    if (father) out.actions.push({ kind: "call", tel: father, who: (record?.fatherName ?? "").trim() || null, relation: "father", child: first.fullName });
    else if (mother) out.actions.push({ kind: "call", tel: mother, who: (record?.motherName ?? "").trim() || null, relation: "mother", child: first.fullName });
  }

  for (const r of receipts.slice(0, 5)) {
    out.receipts.push({
      id: r.id,
      number: r.receiptNumber,
      amount: Number(r.totalAmount),
      student: r.studentFullName,
      date: r.paymentDate,
      mode: r.paymentMode,
      reversed: Boolean(r.isReversed),
      href: `/receipts/${encodeURIComponent(r.receiptNumber)}`,
    });
  }
  for (const r of recent) {
    out.receipts.push({ id: r.id, number: r.number, amount: r.amount, student: top[0].fullName, date: r.date, mode: r.mode, reversed: r.reversed, byChild: true, href: `/receipts/${encodeURIComponent(r.number)}` });
  }
  return out;
}
