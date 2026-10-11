import "server-only";

/**
 * Reads for the redesigned Payment Desk (`/payments`, `/payments/bulk`).
 *
 * Inside a ported tree on purpose: these are fee reads, and only the fee
 * module may reach the fee clients (tests/architecture.test.ts). Every figure
 * comes from the functions the classic desk already uses — the same views,
 * the same RPC, the same readiness gate — and nothing here writes. The route
 * and its actions authorize before calling in.
 */

import { getFeePolicyForSession } from "@/modules/fees/domain/queries";
import { getWorkbookInstallmentRows, getWorkbookStudentFinancials } from "@/modules/fees/data/queries";
import { createClient } from "@/modules/fees/platform/supabase/server";
import { hasRolePermission, type StaffRole as FeeStaffRole } from "@/modules/fees/platform/roles";
import {
  getPaymentDeskClassOptions,
  getPaymentDeskReadiness,
  getPaymentDeskStudentSummary,
  getPaymentEntryPageData,
} from "@/modules/payments/data/queries";
import { getReceiptDetail } from "@/modules/receipts/data/queries";
import { getReceiptReversalTotals, isReceiptReversed } from "@/modules/receipts/data/reversals";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import {
  deskTotals,
  listPending,
  sessionStartDate,
  shortClassLabel,
  type DeskLedgerRow,
  type DeskMode,
  type RecentReceipt,
} from "@/modules/payments/vx/domain/desk";
import type {
  BulkBoot,
  DeskBoot,
  DeskReceipt,
  DeskSibling,
  DeskStudent,
  DeskStudentResult,
} from "@/modules/payments/vx/types";

const DESK_MODES: readonly DeskMode[] = ["cash", "upi", "bank_transfer", "cheque"];

function single<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function modesFrom(accepted: ReadonlyArray<{ value: string }>): DeskMode[] {
  const allowed = new Set(accepted.map((m) => m.value));
  const modes = DESK_MODES.filter((m) => allowed.has(m));
  return modes.length ? modes : ["cash"];
}

export async function loadDeskBoot(payload: {
  sessionLabel: string;
  today: string;
  isCollectable: boolean;
  feeRole: FeeStaffRole;
  myName: string;
}): Promise<DeskBoot> {
  const { sessionLabel, today, feeRole } = payload;
  const canWrite = hasRolePermission(feeRole, "payments:write");
  const [policy, readiness, classOptions, financials, pageData] = await Promise.all([
    getFeePolicyForSession(sessionLabel),
    getPaymentDeskReadiness({ sessionLabel, staffAppRole: feeRole, canWritePayments: canWrite }),
    getPaymentDeskClassOptions(sessionLabel),
    getWorkbookStudentFinancials({ sessionLabel }),
    getPaymentEntryPageData({ studentId: null, searchQuery: "", sessionLabel, initialSelectedSummary: null }),
  ]);

  const dueDates = policy.installmentSchedule.map((item) => item.dueDate);
  const students = financials
    .filter((s) => s.recordStatus === "active")
    .map((s) => {
      const pending = listPending(
        {
          instPending: [s.inst1Pending, s.inst2Pending, s.inst3Pending, s.inst4Pending].map((v) => Number(v ?? 0)),
          baseOutstanding: Number(s.baseOutstandingAmount ?? 0),
          lateOutstanding: Number(s.lateFeeOutstandingAmount ?? 0),
        },
        dueDates,
        today,
      );
      return {
        id: s.studentId,
        name: s.studentName,
        sr: s.admissionNo,
        classId: s.classId,
        classLabel: s.classLabel,
        father: s.fatherName,
        phone: s.fatherPhone ?? s.motherPhone ?? null,
        pendingToday: pending.pendingToday,
        lateFee: pending.lateFee,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const blocking = !payload.isCollectable
    ? {
        title: "This session is read-only",
        detail: `${sessionLabel} cannot take payments. Switch to the active session to collect.`,
        actionLabel: null,
        actionHref: null,
      }
    : readiness.blockingReason
      ? {
          title: readiness.blockingReason.title,
          detail: readiness.blockingReason.detail,
          actionLabel: readiness.blockingReason.actionLabel,
          actionHref: readiness.blockingReason.actionHref,
        }
      : null;

  return {
    sessionLabel,
    today,
    sessionStart: sessionStartDate(sessionLabel),
    canPost: readiness.canPostPayments && payload.isCollectable,
    blocking,
    modes: modesFrom(policy.acceptedPaymentModes),
    classes: classOptions.map((c) => ({ id: c.id, label: c.label, short: shortClassLabel(c.label) })),
    students,
    todayCollection: { count: pageData.todayCollection.receiptCount, amount: pageData.todayCollection.totalAmount },
    lateFeeFlat: policy.lateFeeFlatAmount,
    me: {
      name: payload.myName,
      isAdmin: feeRole === "admin",
      canWaive: hasRolePermission(feeRole, "payments:waive_late_fee"),
      canRemove: hasRolePermission(feeRole, "payments:adjust"),
      canBulk: hasRolePermission(feeRole, "payments:bulk"),
    },
  };
}

async function loadStudentReceipts(studentId: string, sessionStart: string): Promise<RecentReceipt[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("id, receipt_number, total_amount, payment_mode, payment_date, created_at")
    .eq("student_id", studentId)
    .gte("payment_date", sessionStart)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) throw new Error(`Unable to load this student's receipts: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; receipt_number: string; total_amount: number; payment_mode: string; payment_date: string; created_at: string | null }>;
  const reversals = await getReceiptReversalTotals(rows.map((r) => r.id), supabase);
  return rows
    .filter((r) => r.payment_mode !== "discount")
    .map((r) => ({
      id: r.id,
      receiptNumber: r.receipt_number,
      amount: Number(r.total_amount ?? 0),
      mode: r.payment_mode,
      paymentDate: r.payment_date,
      createdAt: r.created_at,
      isReversed: isReceiptReversed(reversals, r.id, Number(r.total_amount ?? 0)),
    }));
}

async function loadSiblings(studentId: string, familyGroupId: string | null | undefined, sessionLabel: string): Promise<DeskSibling[]> {
  if (!familyGroupId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("student_family_members")
    .select("student_id, student_ref:students(id, full_name, status, class_ref:classes(class_name, section, stream_name))")
    .eq("family_group_id", familyGroupId)
    .eq("academic_session_label", sessionLabel);
  if (error || !data) return [];
  type Row = {
    student_id: string;
    student_ref:
      | { id: string; full_name: string; status: string; class_ref: { class_name: string; section: string | null; stream_name: string | null } | Array<{ class_name: string; section: string | null; stream_name: string | null }> | null }
      | Array<{ id: string; full_name: string; status: string; class_ref: { class_name: string; section: string | null; stream_name: string | null } | Array<{ class_name: string; section: string | null; stream_name: string | null }> | null }>
      | null;
  };
  return (data as Row[])
    .filter((r) => r.student_id !== studentId)
    .map((r) => {
      const s = single(r.student_ref);
      const c = single(s?.class_ref ?? null);
      return s && s.status === "active" ? { id: s.id, name: s.full_name, classLabel: [c?.class_name, c?.stream_name].filter(Boolean).join(" ") } : null;
    })
    .filter((s): s is DeskSibling => Boolean(s));
}

export async function loadDeskStudent(payload: { studentId: string; sessionLabel: string; today: string }): Promise<DeskStudentResult> {
  const { studentId, sessionLabel, today } = payload;
  const summary = await getPaymentDeskStudentSummary({
    studentId,
    paymentDate: today,
    sessionLabel,
    autoPrepareMissingDues: true,
    includeLatestReceipt: false,
  });
  if (!summary.student) {
    const issue = summary.issue;
    return {
      ok: false,
      message: issue ? `${issue.title} ${issue.detail}`.trim() : "This student's dues could not be loaded.",
      repairable: Boolean(issue?.repairStudentId),
    };
  }
  const s = summary.student;
  const sessionStart = sessionStartDate(sessionLabel);
  const pendingIds = new Set(s.breakdown.map((b) => b.installmentId));
  const [ledger, receipts, siblings] = await Promise.all([
    getWorkbookInstallmentRows({ studentId }),
    loadStudentReceipts(studentId, sessionStart),
    loadSiblings(studentId, s.confirmedFamilyGroupId, sessionLabel),
  ]);

  let rows: DeskLedgerRow[] = ledger
    .filter((r) => r.sessionLabel === sessionLabel || pendingIds.has(r.installmentId))
    .map((r) => ({
      id: r.installmentId,
      installmentNo: r.installmentNo,
      label: r.installmentLabel,
      isCarryForward: Boolean(r.isCarryForward),
      dueDate: r.dueDate,
      charge: Number(r.baseCharge ?? 0),
      feesPaid: Number(r.feeSettledAmount ?? 0),
      feesPending: Number(r.pendingAmount ?? 0),
      lateFeePending: Number(r.lateFeePending ?? 0),
      lateFeeRaw: Number(r.rawLateFee ?? 0),
      lateFeeWaived: Number(r.waiverApplied ?? 0),
      lateFeeStatus: r.lateFeeStatus,
      planPriority: Number(r.planPriority ?? 1),
    }));

  // The view and the RPC are built on the same snapshot; if the view is ever
  // missing a row the RPC has, fall back to the RPC's rows so the desk never
  // offers less than the ledger will take.
  const viewIds = new Set(rows.map((r) => r.id));
  const missing = s.breakdown.filter((b) => !viewIds.has(b.installmentId));
  if (missing.length) {
    rows = rows.concat(
      missing.map((b) => ({
        id: b.installmentId,
        installmentNo: b.installmentNo,
        label: b.displayLabel ?? b.installmentLabel,
        isCarryForward: Boolean(b.isCarryForward),
        dueDate: b.dueDate,
        charge: b.amountDue,
        feesPaid: Math.max(0, b.amountDue - b.feesPending),
        feesPending: b.feesPending,
        lateFeePending: b.lateFeePending,
        lateFeeRaw: b.rawLateFee,
        lateFeeWaived: b.waiverApplied,
        lateFeeStatus: b.lateFeePending > 0 ? "pending" : "none",
        planPriority: b.planPriority ?? 1,
      })),
    );
  }

  const fee = s.feeHeadDistribution;
  const student: DeskStudent = {
    id: s.id,
    name: s.fullName,
    sr: s.admissionNo,
    classLabel: s.classLabel,
    father: s.fatherName,
    phone: s.fatherPhone ?? s.motherPhone ?? null,
    route: s.transportRouteLabel && !/^no\b/i.test(s.transportRouteLabel) ? s.transportRouteLabel : null,
    isNew: s.studentStatusLabel === "New",
    onPlan: Boolean(summary.repaymentPlan),
    rows,
    receipts,
    siblings,
    plan: fee ? { tuition: fee.tuitionFee, transport: fee.transportFee, academic: fee.academicFee, installments: fee.installmentCount } : null,
    readAt: new Date().toISOString(),
  };
  return { ok: true, student };
}

/** The three numbers a receipt freezes: fees pending today, not due yet, late fee. */
export function balanceAfter(student: DeskStudent, today: string) {
  const t = deskTotals(student.rows, today);
  return { pendingToday: t.pendingToday, dueToday: t.dueToday, notDueYet: t.notDueYet, lateFee: t.lateFee };
}

export async function loadDeskReceipt(receiptId: string): Promise<DeskReceipt | null> {
  const detail = await getReceiptDetail(receiptId);
  if (!detail) return null;
  return {
    id: detail.id,
    receiptNumber: detail.receiptNumber,
    studentId: detail.studentId,
    studentName: detail.studentFullName,
    sr: detail.admissionNo,
    classLabel: detail.classLabel,
    father: detail.fatherName,
    phone: detail.fatherPhone ?? detail.motherPhone ?? null,
    paymentDate: detail.paymentDate,
    createdAt: detail.createdAt,
    mode: detail.paymentMode,
    reference: detail.referenceNumber,
    notes: detail.notes,
    receivedBy: detail.createdByName ?? detail.receivedBy,
    total: detail.totalAmount,
    lines: detail.breakdown.filter((b) => b.amount !== 0).map((b) => ({ label: b.installmentLabel, amount: b.amount })),
    lateFeePaid: 0,
    lateFeeWaived: Number(detail.lateFeeWaived ?? 0),
    isReversed: Boolean(detail.isVoided),
    outstandingAfter: Number(detail.outstandingAfterReceipt ?? 0),
  };
}

/** The roster the bulk grid looks SR numbers up in: this session's active students. */
export async function loadBulkBoot(payload: { sessionLabel: string; today: string; feeRole: FeeStaffRole; myName: string }): Promise<BulkBoot> {
  const [policy, financials] = await Promise.all([
    getFeePolicyForSession(payload.sessionLabel),
    getWorkbookStudentFinancials({ sessionLabel: payload.sessionLabel }),
  ]);
  return {
    sessionLabel: payload.sessionLabel,
    today: payload.today,
    sessionStart: sessionStartDate(payload.sessionLabel),
    students: financials
      .filter((s) => s.recordStatus === "active")
      .map((s) => ({ id: s.studentId, name: s.studentName, sr: s.admissionNo, classLabel: s.classLabel, father: s.fatherName })),
    modes: modesFrom(policy.acceptedPaymentModes),
    canBulk: hasRolePermission(payload.feeRole, "payments:bulk"),
    me: payload.myName,
  };
}

/** Receipts posted by a bulk run, for the done screen's list. Chunked: a run can hold 200 rows. */
export async function loadReceiptsByNumber(numbers: string[]) {
  if (numbers.length === 0) return [];
  const supabase = await createClient();
  type Row = { receipt_number: string; total_amount: number; payment_mode: string; student_ref: { full_name: string } | Array<{ full_name: string }> | null };
  const { data: rows, error } = await fetchInChunks<Row>(numbers, IN_FILTER_CHUNK_SIZE, async (chunk) => {
    const res = await supabase
      .from("receipts")
      .select("receipt_number, total_amount, payment_mode, student_ref:students(full_name)")
      .in("receipt_number", chunk);
    return { data: (res.data ?? []) as Row[], error: res.error };
  });
  if (error) throw new Error(error instanceof Error ? error.message : "Unable to load the posted receipts.");
  return rows.map((r) => ({ receiptNumber: r.receipt_number, amount: Number(r.total_amount ?? 0), mode: r.payment_mode, name: single(r.student_ref)?.full_name ?? "" }));
}

/**
 * The receipt a desk save wrote, found by the request id the desk sent with it.
 *
 * `receipts_student_client_request_id_unique` makes this at most one row. The
 * desk asks this when a save's answer never arrived, so "did it post?" is a
 * question the database answers rather than one the cashier guesses at. An
 * error throws: "could not check" must not read as "not saved".
 */
export async function findDeskReceiptByRequest(payload: { studentId: string; clientRequestId: string }): Promise<{ receiptId: string; receiptNumber: string } | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("receipts")
    .select("id, receipt_number")
    .eq("student_id", payload.studentId)
    .eq("client_request_id", payload.clientRequestId)
    .maybeSingle<{ id: string; receipt_number: string | null }>();
  if (error) throw new Error(`Could not check for the receipt: ${error.message}`);
  if (!data?.id || !data.receipt_number) return null;
  return { receiptId: data.id, receiptNumber: data.receipt_number };
}
