import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { getDashboardPageData } from "@/modules/dashboard/data/queries";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

/**
 * The money on the admin's Today (P5), read through the fee app's own
 * dashboard query so the figures are the ones the fee desk sees.
 *
 * Read-only, and only for `fees:view`: a teacher never reaches this file, and
 * the page does not call it without the permission either. Fees and late fees
 * stay separate numbers all the way to the screen (RULES B).
 */
export type TodayMoney = {
  sessionLabel: string;
  today: number;
  receiptsToday: number;
  /** Day totals, oldest first, as the fee app's heatmap holds them. */
  days: { date: string; amount: number }[];
  modes: { mode: string; amount: number; receipts: number }[];
  /** Fees still pending, by class and installment. No late fee in any cell. */
  matrix: { classLabel: string; cells: Record<string, number>; total: number }[];
  installments: string[];
  /** Fees only, for the year-pace card. */
  expected: number;
  collected: number;
  dueSoFar: number;
  lateFeePending: number;
  followUps: number;
};

export async function todayMoney(today: string): Promise<TodayMoney> {
  await assertPermission("fees:view");

  const view = await resolveViewSession({ cookieSession: await getViewSessionCookie() });
  const data = await getDashboardPageData({ sessionLabel: view.sessionLabel });

  const installments = [...new Set(data.installmentSummary.map((row) => row.installmentLabel))];

  let expected = 0;
  let collected = 0;
  let dueSoFar = 0;
  for (const row of data.installmentSummary) {
    expected += Number(row.expectedAmount || 0);
    collected += Number(row.collectedAmount || 0);
    if (row.dueDate && row.dueDate.slice(0, 10) <= today) dueSoFar += Number(row.expectedAmount || 0);
  }

  return {
    sessionLabel: view.sessionLabel,
    today: Number(data.kpis.todaysCollection || 0),
    receiptsToday: Number(data.kpis.receiptsToday || 0),
    days: data.collectionHeatmap.map((point) => ({ date: point.date, amount: Number(point.amount || 0) })),
    modes: data.todayPaymentModeBreakdown.map((row) => ({ mode: row.paymentMode, amount: Number(row.amount || 0), receipts: row.receiptCount })),
    matrix: data.classInstallmentMatrix.map((row) => ({
      classLabel: row.classLabel,
      cells: Object.fromEntries(row.installments.map((cell) => [cell.installmentLabel, Number(cell.pendingAmount || 0)])),
      total: Number(row.totalPendingAmount || 0),
    })),
    installments,
    expected,
    collected,
    dueSoFar,
    lateFeePending: Number(data.kpis.lateFeePending ?? 0),
    followUps: data.followUpQueue.length,
  };
}

export type PendingRefund = {
  id: string;
  studentId: string;
  studentName: string;
  amount: number;
  reason: string | null;
  requestedAt: string;
};

/** Refund requests waiting for approval — shown in Needs you, decided on the fee screen. */
export async function pendingRefunds(): Promise<PendingRefund[]> {
  await assertPermission("fees:view");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("refund_requests")
    .select("id, student_id, requested_amount, reason, created_at")
    .eq("status", "pending_approval")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<{ id: string; student_id: string; requested_amount: number | string; reason: string | null; created_at: string }[]>();
  if (error) throw new Error(`Could not read the refund requests: ${error.message}`);
  if (data.length === 0) return [];

  const ids = [...new Set(data.map((row) => row.student_id))];
  const names = await fetchInChunks<{ id: string; full_name: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin.from("students").select("id, full_name").in("id", chunk),
  );
  if (names.error) throw new Error("Could not read the students.");
  const nameOf = new Map(names.data.map((row) => [row.id, row.full_name]));

  return data.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    studentName: nameOf.get(row.student_id) ?? "—",
    amount: Number(row.requested_amount || 0),
    reason: row.reason,
    requestedAt: row.created_at,
  }));
}
