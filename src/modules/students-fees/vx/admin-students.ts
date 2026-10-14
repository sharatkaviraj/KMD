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
  getStudentMasterFieldsByIds,
  getStudentsPage,
} from "@/modules/students-fees/data/queries";
import { segmentCount, type SegmentId } from "@/modules/students-fees/domain/student-segments";
import { EMPTY_STUDENT_FILTERS } from "@/modules/students-fees/domain/types";
import { buildFeeBreakupDisplayRows } from "@/modules/fees/domain/display-breakdown";
import { isYearCleared } from "@/modules/fees/domain/year-clear";
import { calculateOverdueBaseAmount, calculatePendingLateFeeAmount } from "@/modules/fees/domain/due-amounts";
import { getStudentFinancialSnapshot } from "@/modules/fees/data/policy";
import { getDisplayInstallmentLabel, isCarryForwardInstallment } from "@/modules/prev-year-dues/domain/display";

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
  /** Other children in the confirmed family, from the fee app's sibling pill. */
  siblingCount: number;
  /** The fee app's "New" tier — what the "New this year" chip reads. */
  isNew: boolean;
  /** The fee app's one Year Clear rule (`isYearCleared`), not recomputed here. */
  yearClear: boolean;
  /** An active monthly EMI plan, when there is one. */
  emi: { status: "upcoming" | "on_track" | "due" | "behind" | "completed"; monthly: number; nextDue: string | null } | null;
  /** RTE / Staff Child / 3rd Child Policy. Office context only. */
  concessions: string[];
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
  /**
   * The session the caller already resolved, so the list, its class filter
   * and anything read beside it name one session. Omitted, the view-session
   * cookie decides, as on every other money screen.
   */
  sessionLabel?: string;
  /** The fee app's own orders: by name, or by class then name. */
  sort?: "name" | "class";
}): Promise<MoneyList> {
  await assertPermission("fees:view");
  const view = input.sessionLabel ? { sessionLabel: input.sessionLabel } : await resolveViewSession({ cookieSession: await getViewSessionCookie() });
  const segments: SegmentId[] = input.segment === "all" ? [] : [SEGMENT_OF[input.segment]];

  const [page, counts] = await Promise.all([
    getStudentsPage(
      { ...EMPTY_STUDENT_FILTERS, query: input.query, classId: input.classId, sessionLabel: view.sessionLabel, segments, sort: input.sort ?? "name" },
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
      siblingCount: Math.max(0, Number(row.siblingPill?.siblingCount ?? 0)),
      isNew: row.studentStatusLabel === "New",
      yearClear: isYearCleared({
        outstandingAmount: Number(row.outstandingAmount || 0),
        totalPaid: Number(row.totalPaid || 0),
        discountClosedAmount: Number(row.discountClosedAmount || 0),
        hasPreparedDues: row.duesStatus === "generated",
      }),
      emi: row.emiPlan
        ? { status: row.emiPlan.paymentStatus, monthly: Number(row.emiPlan.monthlyAmount || 0), nextDue: row.emiPlan.nextDueDate }
        : null,
      concessions: [...(row.conventionalDiscountLabels ?? [])],
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

/**
 * The father's name (else the mother's) for the rows on one page of the list,
 * which the design shows under each child ("SR 1234 · Rakesh Sharma"). The
 * list query does not carry it; this reads only the page's ids, beside the
 * attendance read, so it adds no wave.
 */
export async function parentNamesFor(studentIds: readonly string[]): Promise<Map<string, string>> {
  await assertPermission("fees:view");
  const fields = await getStudentMasterFieldsByIds(studentIds);
  const out = new Map<string, string>();
  for (const [id, row] of fields) {
    const name = (row.fatherName ?? "").trim() || (row.motherName ?? "").trim();
    if (name) out.set(id, name);
  }
  return out;
}

/**
 * A child's latest receipts, for the search palette's Receipts section when a
 * name is typed (F04). Newest first; a reversed receipt says so (RULES A).
 */
export async function recentReceiptsFor(
  studentId: string,
  limit = 2,
): Promise<{ id: string; number: string; amount: number; date: string; mode: string; reversed: boolean }[]> {
  await assertPermission("fees:view");
  const result = await createAdminClient()
    .from("receipts")
    .select("id, receipt_number, payment_date, total_amount, payment_mode, created_at")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; receipt_number: string; payment_date: string; total_amount: number | string; payment_mode: string; created_at: string }[]>();
  if (result.error) throw new Error(`Could not read the receipts: ${result.error.message}`);
  const reversals = await getReceiptReversalTotals(result.data.map((row) => row.id));
  return result.data.map((row) => ({
    id: row.id,
    number: row.receipt_number,
    amount: Number(row.total_amount || 0),
    date: row.payment_date,
    mode: row.payment_mode,
    reversed: isReceiptReversed(reversals, row.id, Number(row.total_amount || 0)),
  }));
}

export type StudentFeeInstallment = {
  installmentId: string;
  installmentNo: number;
  /** The fee app's own display label (`getDisplayInstallmentLabel`). */
  installmentLabel: string;
  dueDate: string;
  isCarryForward: boolean;
  baseCharge: number;
  /** Fees settled on this row by the oldest-first pool. Never the late fee. */
  feeSettledAmount: number;
  /** Everything the pool settled here, fees then late fee — the fee app's "Paid". */
  settledAmount: number;
  /** Cash receipted against this row, net of reversals (the pin). */
  appliedAmount: number;
  discountCloseoutAmount: number;
  adjustmentAmount: number;
  pendingAmount: number;
  finalLateFee: number;
  waiverApplied: number;
  lateFeePending: number;
  balanceStatus: "paid" | "partial" | "overdue" | "pending" | "waived";
};

/**
 * The fee app's money band, figure for figure (`StudentMoneyBand` on
 * `/fees/students/[id]`). Same sums over the same rows, so the two screens can
 * never disagree about one child.
 */
export type StudentFeeSummary = {
  /** Fees still owed, all installments. Never contains a late fee. */
  outstanding: number;
  /** Fees past their due date. */
  overdue: number;
  lateFeePending: number;
  lateFeeWaived: number;
  /** Cash collected this session, net of reversals. */
  paidThisSession: number;
  discountClosed: number;
  /** What the ledger charged this session. */
  sessionFee: number;
  creditBalance: number;
  installmentsPaid: number;
  installmentsTotal: number;
  installmentsPending: number;
  nextDue: { label: string; amount: number; dueDate: string } | null;
};

export type StudentFeeBreakup = {
  rows: { id: string; label: string; amount: number; kind: "charge" | "discount" }[];
  annualTotal: number;
  discountTotal: number;
  discountLabels: string[];
  tuitionOverride: number | null;
  transportOverride: number | null;
};

export type StudentFees = {
  sessionLabel: string;
  installments: StudentFeeInstallment[];
  summary: StudentFeeSummary;
  breakup: StudentFeeBreakup | null;
  receipts: { id: string; number: string; date: string; amount: number; mode: string; reversed: boolean }[];
  family: { id: string; fullName: string; admissionNo: string; classLabel: string; isSelf: boolean; outstanding: number | null; totalDue: number | null; totalPaid: number | null }[];
  /** The confirmed family group, for the family statement; null for a child with none. */
  familyGroupId: string | null;
  routeLabel: string | null;
  dateOfBirth: string | null;
  joinedOn: string | null;
  address: string | null;
  status: string | null;
};

export async function studentFees(studentId: string): Promise<StudentFees> {
  await assertPermission("fees:view");
  const admin = createAdminClient();

  // One wave, not three. The session, the receipts' reversal totals and the
  // fee breakup used to wait on each other; each now starts the moment what it
  // needs exists. The snapshot is the fee app's own, cached per student and
  // busted by every posting (`student:{id}`).
  const [view, balances, receipts, family, detail, snapshot] = await Promise.all([
    getViewSessionCookie().then((cookieSession) => resolveViewSession({ cookieSession })),
    getWorkbookInstallmentBalances(studentId),
    admin
      .from("receipts")
      .select("id, receipt_number, payment_date, total_amount, payment_mode, created_at")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<{ id: string; receipt_number: string; payment_date: string; total_amount: number | string; payment_mode: string; created_at: string }[]>()
      .then(async (result) => {
        if (result.error) throw new Error(`Could not read the receipts: ${result.error.message}`);
        const reversals = await getReceiptReversalTotals(result.data.map((row) => row.id));
        return { rows: result.data, reversals };
      }),
    getStudentFamilyMembersDetail(studentId),
    getStudentDetail(studentId),
    getStudentFinancialSnapshot(studentId),
  ]);

  const inSession = balances
    .filter((row) => row.sessionLabel === view.sessionLabel || row.isCarryForward)
    .sort((a, b) => Number(Boolean(b.isCarryForward)) - Number(Boolean(a.isCarryForward)) || a.installmentNo - b.installmentNo);

  const installments: StudentFeeInstallment[] = inSession.map((row) => ({
    installmentId: row.installmentId,
    installmentNo: row.installmentNo,
    installmentLabel: getDisplayInstallmentLabel(row),
    dueDate: row.dueDate,
    isCarryForward: isCarryForwardInstallment(row),
    baseCharge: Number(row.baseCharge || 0),
    feeSettledAmount: Number(row.feeSettledAmount || 0),
    settledAmount: Number(row.settledAmount || 0),
    appliedAmount: Number(row.appliedAmount || 0),
    discountCloseoutAmount: Number(row.discountCloseoutAmount || 0),
    adjustmentAmount: Number(row.adjustmentAmount || 0),
    pendingAmount: Number(row.pendingAmount || 0),
    finalLateFee: Number(row.finalLateFee || 0),
    waiverApplied: Number(row.waiverApplied || 0),
    lateFeePending: Number(row.lateFeePending || 0),
    balanceStatus: row.balanceStatus,
  }));

  const firstPending = installments.find((row) => row.pendingAmount > 0) ?? null;
  const sum = (pick: (row: StudentFeeInstallment) => number) => installments.reduce((total, row) => total + pick(row), 0);

  const summary: StudentFeeSummary = {
    outstanding: sum((row) => row.pendingAmount),
    overdue: calculateOverdueBaseAmount(inSession),
    lateFeePending: calculatePendingLateFeeAmount(inSession),
    lateFeeWaived: sum((row) => row.waiverApplied),
    paidThisSession: sum((row) => row.appliedAmount),
    discountClosed: sum((row) => row.discountCloseoutAmount),
    sessionFee: sum((row) => row.baseCharge),
    creditBalance: Number(snapshot?.creditBalance ?? 0),
    installmentsPaid: installments.filter((row) => row.balanceStatus === "paid").length,
    installmentsTotal: installments.length,
    installmentsPending: installments.filter((row) => row.pendingAmount > 0).length,
    nextDue: firstPending ? { label: firstPending.installmentLabel, amount: firstPending.pendingAmount, dueDate: firstPending.dueDate } : null,
  };

  const breakupRows = snapshot ? buildFeeBreakupDisplayRows(snapshot.resolvedBreakdown) : [];
  const breakup: StudentFeeBreakup | null = snapshot
    ? {
        rows: breakupRows.map((row) => ({ id: row.id, label: row.label, amount: row.amount, kind: row.kind === "discount" ? "discount" : "charge" })),
        annualTotal: snapshot.resolvedBreakdown.annualTotal,
        discountTotal: breakupRows.filter((row) => row.kind === "discount").reduce((total, row) => total + Math.abs(row.amount), 0),
        discountLabels: snapshot.resolvedBreakdown.conventionalDiscountLabels ?? [],
        tuitionOverride: detail?.tuitionOverride ?? null,
        transportOverride: detail?.transportOverride ?? null,
      }
    : null;

  return {
    sessionLabel: view.sessionLabel,
    installments,
    summary,
    breakup,
    receipts: receipts.rows.map((row) => ({
      id: row.id,
      number: row.receipt_number,
      date: row.payment_date,
      amount: Number(row.total_amount || 0),
      mode: row.payment_mode,
      reversed: isReceiptReversed(receipts.reversals, row.id, Number(row.total_amount || 0)),
    })),
    family: family.members.map((member) => ({
      id: member.id,
      fullName: member.fullName,
      admissionNo: member.admissionNo,
      classLabel: member.classLabel,
      isSelf: member.isSelf,
      outstanding: member.financials ? Number(member.financials.outstanding || 0) : null,
      totalDue: member.financials ? Number(member.financials.totalDue || 0) : null,
      totalPaid: member.financials ? Number(member.financials.totalPaid || 0) : null,
    })),
    familyGroupId: family.familyGroupId ?? null,
    routeLabel: detail?.transportRouteId ? detail.transportRouteLabel : null,
    dateOfBirth: detail?.dateOfBirth ?? null,
    joinedOn: detail?.joinedOn ?? null,
    address: detail?.address ?? null,
    status: detail?.status ?? null,
  };
}
