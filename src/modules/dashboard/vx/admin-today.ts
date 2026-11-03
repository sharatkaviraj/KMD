import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { getDashboardPageData } from "@/modules/dashboard/data/queries";
import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { settleParts } from "@/platform/helpers/partial-read";
import { deskReason } from "@/modules/dashboard/domain/desk-reason";
import { p, type Pair } from "@/vx/text";

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
  /** Each installment's due date, by the label the matrix uses; null when the setup has none. */
  dueDates: Record<string, string | null>;
  /** Labels that are a previous session's balance, always past due. */
  carryForward: string[];
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
    dueDates: Object.fromEntries(data.installmentSummary.map((row) => [row.installmentLabel, row.dueDate ? row.dueDate.slice(0, 10) : null])),
    carryForward: [...new Set(data.installmentSummary.filter((row) => row.isCarryForward).map((row) => row.installmentLabel))],
  };
}

export type PendingRefund = {
  id: string;
  studentId: string;
  studentName: string;
  amount: number;
  reason: string | null;
  /** The reason in words, both languages, with the note and who asked; preferred over `reason`. */
  reasonText?: Pair;
  /** A request from the accounts desk (`acc_requests`): its own title. */
  title?: Pair;
  requestedAt: string;
  /** Where the request is decided; the fee refund screen when absent. */
  href?: string;
  /** Set for a fee desk request, which is not a refund. */
  deskKind?: "reversal" | "write_off";
  receiptNumber?: string | null;
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

/**
 * Reversals and write-offs asked for at the fee desk by staff who cannot do
 * them (`vppsone.fee_desk_requests`), for the admin's Needs you. Each links to
 * the screen where the admin decides it; nothing here moves money.
 */
export async function pendingDeskRequests(): Promise<PendingRefund[]> {
  await assertPermission("fees:view");
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vppsone")
    .from("fee_desk_requests")
    .select("id, kind, student_id, receipt_number, amount, reason_code, note, requested_by_name, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<{ id: string; kind: "reversal" | "write_off"; student_id: string; receipt_number: string | null; amount: number | string; reason_code: string; note: string | null; requested_by_name: string | null; created_at: string }[]>();
  if (error) throw new Error(`Could not read the fee desk requests: ${error.message}`);
  if (data.length === 0) return [];

  const ids = [...new Set(data.map((row) => row.student_id))];
  const names = await fetchInChunks<{ id: string; full_name: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin.from("students").select("id, full_name").in("id", chunk),
  );
  if (names.error) throw new Error("Could not read the students.");
  const nameOf = new Map(names.data.map((row) => [row.id, row.full_name]));

  return data.map((row) => ({
    id: `desk:${row.id}`,
    studentId: row.student_id,
    studentName: nameOf.get(row.student_id) ?? "—",
    amount: Number(row.amount || 0),
    reason: deskReason(row.reason_code, row.note, row.requested_by_name).en,
    reasonText: deskReason(row.reason_code, row.note, row.requested_by_name),
    deskKind: row.kind,
    receiptNumber: row.receipt_number,
    requestedAt: row.created_at,
    href:
      row.kind === "reversal" && row.receipt_number
        ? `/receipts/${encodeURIComponent(row.receipt_number)}?sheet=reverse`
        : `/dues?tab=left&wo=${row.student_id}&sheet=wo`,
  }));
}

const ACC_KIND: Record<string, Pair> = {
  late_fee_waiver: p("Waive a late fee", "विलंब शुल्क माफ़"),
  reversal: p("Reverse a receipt", "रसीद रद्द"),
  refund: p("Refund", "धन वापसी"),
  fee_change: p("Change a fee", "फ़ीस बदलें"),
  other: p("Request", "अनुरोध"),
};

/**
 * Requests the accounts desk sent the admin (`vppsone.acc_requests`) and nobody
 * has decided or withdrawn. A ₹500 refund asked for on 10 Oct waited eleven
 * days without ever reaching Needs you (smoke run, 20 Oct).
 */
export async function pendingAccountRequests(): Promise<PendingRefund[]> {
  await assertPermission("fees:view");
  const admin = createAdminClient();
  const { data, error } = await admin
    .schema("vppsone")
    .from("acc_requests")
    .select("id, kind, title, reason, amount, student_id, requested_by, requested_at")
    .is("decision", null)
    .is("withdrawn_at", null)
    .order("requested_at", { ascending: true })
    .limit(50)
    .returns<{ id: string; kind: string; title: string; reason: string; amount: number | null; student_id: string | null; requested_by: string; requested_at: string }[]>();
  if (error) throw new Error(`Could not read the accounts requests: ${error.message}`);
  if (data.length === 0) return [];

  const studentIds = [...new Set(data.map((row) => row.student_id).filter((id): id is string => Boolean(id)))];
  const staffIds = [...new Set(data.map((row) => row.requested_by))];
  const [names, staff] = await Promise.all([
    fetchInChunks<{ id: string; full_name: string }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) => admin.from("students").select("id, full_name").in("id", chunk)),
    fetchInChunks<{ id: string; display_name: string }>(staffIds, IN_FILTER_CHUNK_SIZE, (chunk) => admin.schema("vppsone").from("staff_profiles").select("id, display_name").in("id", chunk)),
  ]);
  if (names.error || staff.error) throw new Error("Could not read who the requests are about.");
  const nameOf = new Map(names.data.map((row) => [row.id, row.full_name]));
  const staffOf = new Map(staff.data.map((row) => [row.id, row.display_name]));

  return data.map((row) => {
    const kind = ACC_KIND[row.kind] ?? ACC_KIND.other;
    const by = staffOf.get(row.requested_by) ?? null;
    return {
      id: `acc:${row.id}`,
      studentId: row.student_id ?? "",
      studentName: row.student_id ? (nameOf.get(row.student_id) ?? "—") : "—",
      amount: Number(row.amount ?? 0),
      reason: row.reason,
      reasonText: deskReason(null, `${row.title} · ${row.reason}`, by),
      title: kind,
      requestedAt: row.requested_at,
      href: "/accounts/books?view=requests",
    };
  });
}

/**
 * Everything money-side that waits on an admin: refunds, the desk's reversal
 * and write-off requests, and the accounts desk's requests. Each part stands
 * alone: one that cannot be read no longer hides the others (T03) — the rest
 * arrive inside a `PartialReadError` and the queue says something is missing.
 */
export async function pendingMoneyRequests(): Promise<PendingRefund[]> {
  return settleParts<PendingRefund>([["refunds", pendingRefunds], ["desk", pendingDeskRequests], ["accounts", pendingAccountRequests]]);
}

/**
 * The same queue under the live Fees connection: One's own desk and accounts
 * requests only. Fees' refund requests live in Fees, and the local
 * `refund_requests` read is refused there by design.
 */
export async function pendingOneMoneyRequests(): Promise<PendingRefund[]> {
  return settleParts<PendingRefund>([["desk", pendingDeskRequests], ["accounts", pendingAccountRequests]]);
}
