import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { getWorkbookInstallmentBalances } from "@/modules/fees/data/queries";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getReceiptReversalTotals, isReceiptReversed } from "@/modules/receipts/data/reversals";
import { getStudentSegmentCounts } from "@/modules/students-fees/data/directory";
import {
  getStudentDetail,
  getStudentFamilyMembersDetail,
  getStudentsPage,
} from "@/modules/students-fees/data/queries";
import { segmentCount, type SegmentId } from "@/modules/students-fees/domain/student-segments";
import { EMPTY_STUDENT_FILTERS } from "@/modules/students-fees/domain/types";

/**
 * The fee side of the admin's Students list and Student 360 (P5).
 *
 * Read-only wrappers over the fee app's own queries, each behind `fees:view`:
 * the list and the card show money only to somebody who may see it, and a
 * reader without the permission gets this app's own directory instead. No
 * figure is recomputed here — installments come back as the fee app settled
 * them, and fees and late fees stay apart.
 */

/** The list's chips onto the fee app's saved views. */
const SEGMENT_OF = {
  pending: "overdue",
  bus: "onTransport",
  new: "newThisYear",
  paid: "yearClear",
} as const satisfies Record<string, SegmentId>;

export type MoneyListRow = {
  id: string;
  fullName: string;
  admissionNo: string;
  classLabel: string;
  routeLabel: string;
  parentName: string | null;
  phone: string | null;
  overdueAmount: number;
  outstandingAmount: number;
  pendingLateFeeAmount: number;
  totalPaid: number;
  totalDue: number;
  lateFeeTotal: number;
  status: string;
};

export type MoneyList = {
  sessionLabel: string;
  rows: MoneyListRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: { all: number | null; pending: number | null; bus: number | null; new: number | null; paid: number | null };
};

export async function studentMoneyList(input: {
  query: string;
  classId: string;
  segment: "all" | keyof typeof SEGMENT_OF;
  page: number;
  pageSize: number;
}): Promise<MoneyList> {
  await assertPermission("fees:view");
  const view = await resolveViewSession({ cookieSession: await getViewSessionCookie() });
  const segments: SegmentId[] = input.segment === "all" ? [] : [SEGMENT_OF[input.segment]];

  const [page, counts] = await Promise.all([
    getStudentsPage(
      { ...EMPTY_STUDENT_FILTERS, query: input.query, classId: input.classId, sessionLabel: view.sessionLabel, segments },
      { page: input.page, pageSize: input.pageSize },
    ),
    getStudentSegmentCounts({ sessionLabel: view.sessionLabel, classId: input.classId || undefined, query: input.query || undefined }).catch(() => null),
  ]);

  return {
    sessionLabel: view.sessionLabel,
    total: page.totalCount,
    page: page.page,
    pageSize: page.pageSize,
    rows: page.students.map((row) => ({
      id: row.id,
      fullName: row.fullName,
      admissionNo: row.admissionNo,
      classLabel: row.classLabel,
      routeLabel: row.transportRouteLabel,
      parentName: null,
      phone: row.fatherPhone ?? row.motherPhone ?? null,
      overdueAmount: Number(row.overdueAmount || 0),
      outstandingAmount: Number(row.outstandingAmount || 0),
      pendingLateFeeAmount: Number(row.pendingLateFeeAmount || 0),
      totalPaid: Number(row.totalPaid || 0),
      totalDue: Number(row.totalDue || 0),
      lateFeeTotal: Number(row.lateFeeTotal || 0),
      status: row.status,
    })),
    counts: {
      all: counts ? (segmentCount(counts, "active") ?? counts.scopeTotal) : null,
      pending: segmentCount(counts, "overdue"),
      bus: segmentCount(counts, "onTransport"),
      new: segmentCount(counts, "newThisYear"),
      paid: segmentCount(counts, "yearClear"),
    },
  };
}

export type StudentFees = {
  sessionLabel: string;
  installments: {
    installmentNo: number;
    installmentLabel: string;
    dueDate: string;
    isCarryForward: boolean;
    baseCharge: number;
    feeSettledAmount: number;
    pendingAmount: number;
    lateFeePending: number;
    balanceStatus: "paid" | "partial" | "overdue" | "pending" | "waived";
  }[];
  receipts: { id: string; number: string; date: string; amount: number; mode: string; reversed: boolean }[];
  family: { id: string; fullName: string; admissionNo: string; classLabel: string; isSelf: boolean; outstanding: number | null }[];
  routeLabel: string | null;
  dateOfBirth: string | null;
  joinedOn: string | null;
  address: string | null;
  status: string | null;
};

export async function studentFees(studentId: string): Promise<StudentFees> {
  await assertPermission("fees:view");
  const view = await resolveViewSession({ cookieSession: await getViewSessionCookie() });
  const admin = createAdminClient();

  const [balances, receipts, family, detail] = await Promise.all([
    getWorkbookInstallmentBalances(studentId),
    admin
      .from("receipts")
      .select("id, receipt_number, payment_date, total_amount, payment_mode, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; receipt_number: string; payment_date: string; total_amount: number | string; payment_mode: string; created_at: string }[]>(),
    getStudentFamilyMembersDetail(studentId).catch(() => ({ familyGroupId: null, members: [] })),
    getStudentDetail(studentId).catch(() => null),
  ]);

  if (receipts.error) throw new Error(`Could not read the receipts: ${receipts.error.message}`);
  const reversals = await getReceiptReversalTotals(receipts.data.map((row) => row.id));

  const inSession = balances.filter((row) => row.sessionLabel === view.sessionLabel || row.isCarryForward);

  return {
    sessionLabel: view.sessionLabel,
    installments: inSession
      .map((row) => ({
        installmentNo: row.installmentNo,
        installmentLabel: row.installmentLabel,
        dueDate: row.dueDate,
        isCarryForward: Boolean(row.isCarryForward),
        baseCharge: Number(row.baseCharge || 0),
        feeSettledAmount: Number(row.feeSettledAmount || 0),
        pendingAmount: Number(row.pendingAmount || 0),
        lateFeePending: Number(row.lateFeePending || 0),
        balanceStatus: row.balanceStatus,
      }))
      .sort((a, b) => Number(b.isCarryForward) - Number(a.isCarryForward) || a.installmentNo - b.installmentNo),
    receipts: receipts.data.map((row) => ({
      id: row.id,
      number: row.receipt_number,
      date: row.payment_date,
      amount: Number(row.total_amount || 0),
      mode: row.payment_mode,
      reversed: isReceiptReversed(reversals, row.id, Number(row.total_amount || 0)),
    })),
    family: family.members.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      admissionNo: member.admissionNo,
      classLabel: member.classLabel,
      isSelf: member.isSelf,
      outstanding: member.financials ? Number(member.financials.outstanding || 0) : null,
    })),
    routeLabel: detail?.transportRouteId ? detail.transportRouteLabel : null,
    dateOfBirth: detail?.dateOfBirth ?? null,
    joinedOn: detail?.joinedOn ?? null,
    address: detail?.address ?? null,
    status: detail?.status ?? null,
  };
}
