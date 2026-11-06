import "server-only";

import { createAdminClient } from "@/modules/fees/platform/supabase/admin";
import { getReceiptDetailWith, getReceiptsPage } from "@/modules/receipts/data/queries";
import { EMPTY_RECEIPT_FILTERS } from "@/modules/receipts/domain/filters";
import type { ReceiptDetail, ReceiptListItem } from "@/modules/receipts/domain/types";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { groupReversals, type ReversalRow } from "@/modules/receipts/vx/domain/reversal-history";

/*
 * Reads for the redesigned Receipts screen (/receipts). Every number comes from
 * the ported receipt queries; this file only asks for a date window, finds a
 * receipt by its printed number, and reads the history the detail panel shows.
 * Nothing here writes.
 *
 * Every read uses the fee service-role client. Its callers (the /receipts
 * pages and actions) check `fees:view` first; the cookie client cannot be used
 * here, because fee RLS keys on `public.users.role` and an office account
 * without that row read "₹0 · 0 receipts" with no error while the home page
 * said ₹2,000 (school-day run, accountant B4).
 */
const feeReader = () => createAdminClient();

export type DeskReceiptRow = ReceiptListItem & { isReversed: boolean };

const PAGE_SIZE = 100;
/** Five pages is a month of a busy desk; the screen shows days, not months. */
const MAX_PAGES = 5;

/** Every receipt dated from `from` to `to`, newest first. `truncated` when the window held more. */
export async function loadDeskReceipts(sessionLabel: string, from: string, to: string): Promise<{ rows: DeskReceiptRow[]; truncated: boolean }> {
  const { query: _q, sessionLabel: _s, ...base } = EMPTY_RECEIPT_FILTERS;
  void _q;
  void _s;
  const rows: DeskReceiptRow[] = [];
  const client = feeReader();
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await getReceiptsPage("", { page, pageSize: PAGE_SIZE }, sessionLabel, {
      ...base,
      datePreset: "custom",
      fromDate: from,
      toDate: to,
      sort: "newest",
    }, client);
    total = res.totalCount;
    for (const r of res.receipts) rows.push({ ...r, isReversed: r.isReversed === true });
    if (rows.length >= total || res.receipts.length < PAGE_SIZE) break;
  }
  return { rows, truncated: rows.length < total };
}

/** The last day on or before `onOrBefore` that has any receipt, so an empty today can point somewhere. */
export async function lastReceiptDate(onOrBefore: string, sessionLabel: string): Promise<string | null> {
  const supabase = feeReader();
  const { data, error } = await supabase
    .from("receipts")
    // Receipts have no session column; allocations retain the paid session
    // even when the student's current class has moved to another year.
    .select("payment_date, payments!inner(installment_ref:installments!inner(class_ref:classes!inner(session_label)))")
    .eq("payments.installment_ref.class_ref.session_label", sessionLabel)
    .lte("payment_date", onOrBefore)
    .order("payment_date", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { payment_date?: string } | undefined;
  return row?.payment_date ?? null;
}

export async function findReceiptIdByNumber(receiptNumber: string): Promise<string | null> {
  const supabase = feeReader();
  const { data, error } = await supabase.from("receipts").select("id").eq("receipt_number", receiptNumber).limit(1);
  if (error) throw new Error(error.message);
  const row = (data ?? [])[0] as { id?: string } | undefined;
  return row?.id ?? null;
}

export type ReceiptHistoryEvent = {
  at: string;
  kind: "posted" | "reversed" | "sent" | "read";
  amount?: number;
  note?: string | null;
  /** A reversal's author: the fee user id on the adjustment, when recorded. */
  by?: string | null;
};

export type DeskReceiptDetail = {
  detail: ReceiptDetail;
  isReversed: boolean;
  share: { status: "not_sent" | "sent" | "delivered" | "read" | "failed"; at: string | null };
  history: ReceiptHistoryEvent[];
  /** Late fee forgiven at the counter with this payment (same request id), not voided. */
  lateFeeWaivedWithReceipt: number;
};

/** One receipt by its printed number, with its reversal and WhatsApp history. */
export async function getDeskReceipt(receiptNumber: string): Promise<DeskReceiptDetail | null> {
  const id = await findReceiptIdByNumber(receiptNumber);
  if (!id) return null;
  const supabase = feeReader();
  const detail = await getReceiptDetailWith(supabase, id);
  if (!detail) return null;

  const [paymentsRes, sendsRes, waivedWithReceipt] = await Promise.all([
    supabase.from("payments").select("id").eq("receipt_id", id),
    supabase
      .from("whatsapp_reminder_sends")
      .select("status, delivery_status, created_at, delivered_at, read_at")
      .eq("receipt_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
    lateFeeWaivedWith(supabase, id),
  ]);
  if (paymentsRes.error) throw new Error(paymentsRes.error.message);
  if (sendsRes.error) throw new Error(sendsRes.error.message);
  const paymentIds = ((paymentsRes.data ?? []) as { id: string }[]).map((p) => p.id);
  const reversals: ReversalRow[] = [];
  for (let offset = 0; offset < paymentIds.length; offset += IN_FILTER_CHUNK_SIZE) {
    const { data, error } = await supabase
      .from("payment_adjustments")
      .select("amount_delta, reason, created_at, created_by")
      .eq("adjustment_type", "reversal")
      .in("payment_id", paymentIds.slice(offset, offset + IN_FILTER_CHUNK_SIZE))
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    reversals.push(...((data ?? []) as typeof reversals));
  }

  const history: ReceiptHistoryEvent[] = [{ at: detail.createdAt, kind: "posted", amount: detail.totalAmount, note: detail.receivedBy ?? detail.createdByName }];
  // Grouped by the absolute minute; the time shown keeps its offset (B08).
  for (const e of groupReversals(reversals)) history.push({ at: e.at, kind: "reversed", amount: e.amount, note: e.note, by: e.by });

  const sends = (sendsRes.data ?? []) as { status: string | null; delivery_status: string | null; created_at: string; delivered_at: string | null; read_at: string | null }[];
  const last = sends[0];
  let share: DeskReceiptDetail["share"] = { status: "not_sent", at: null };
  if (last) {
    history.push({ at: last.created_at, kind: "sent" });
    if (last.read_at) history.push({ at: last.read_at, kind: "read" });
    const failed = last.status === "failed" || last.delivery_status === "failed";
    share = last.read_at
      ? { status: "read", at: last.read_at }
      : failed
        ? { status: "failed", at: last.created_at }
        : last.delivered_at
          ? { status: "delivered", at: last.delivered_at }
          : { status: "sent", at: last.created_at };
  }
  history.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const reversedAmount = detail.reversedAmount ?? 0;
  return { detail, isReversed: detail.totalAmount > 0 && reversedAmount >= detail.totalAmount, share, history, lateFeeWaivedWithReceipt: waivedWithReceipt };
}

/**
 * The desk forgives a late fee with `waive_late_fee` BEFORE it posts, under the
 * same client request id, so the waiver lands in `student_late_fee_waivers`
 * and not as a writeoff on the receipt. The receipt therefore said nothing
 * about the ₹3,000 it was taken with (TEST school day, 6 Nov 2026, accountant
 * B4). Matching on the request id finds exactly that waiver. A read failure
 * shows no line rather than failing the receipt.
 */
async function lateFeeWaivedWith(supabase: ReturnType<typeof feeReader>, receiptId: string): Promise<number> {
  try {
    const { data: r } = await supabase.from("receipts").select("student_id, client_request_id").eq("id", receiptId).maybeSingle();
    const row = r as { student_id: string | null; client_request_id: string | null } | null;
    if (!row?.client_request_id || !row.student_id) return 0;
    const { data } = await supabase
      .from("student_late_fee_waivers")
      .select("amount")
      .eq("student_id", row.student_id)
      .eq("client_request_id", row.client_request_id)
      .is("voided_at", null);
    return ((data ?? []) as { amount: number | string | null }[]).reduce((sum, w) => sum + Math.max(0, Number(w.amount) || 0), 0);
  } catch {
    return 0;
  }
}
