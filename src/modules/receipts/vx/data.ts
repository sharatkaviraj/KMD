import "server-only";

import { createClient } from "@/modules/fees/platform/supabase/server";
import { getReceiptDetail, getReceiptsPage } from "@/modules/receipts/data/queries";
import { EMPTY_RECEIPT_FILTERS } from "@/modules/receipts/domain/filters";
import type { ReceiptDetail, ReceiptListItem } from "@/modules/receipts/domain/types";

/*
 * Reads for the redesigned Receipts screen (/receipts). Every number comes from
 * the ported receipt queries; this file only asks for a date window, finds a
 * receipt by its printed number, and reads the history the detail panel shows.
 * Nothing here writes.
 */

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
  let total = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await getReceiptsPage("", { page, pageSize: PAGE_SIZE }, sessionLabel, {
      ...base,
      datePreset: "custom",
      fromDate: from,
      toDate: to,
      sort: "newest",
    });
    total = res.totalCount;
    for (const r of res.receipts) rows.push({ ...r, isReversed: r.isReversed === true });
    if (rows.length >= total || res.receipts.length < PAGE_SIZE) break;
  }
  return { rows, truncated: rows.length < total };
}

/** The last day on or before `onOrBefore` that has any receipt, so an empty today can point somewhere. */
export async function lastReceiptDate(onOrBefore: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("receipts")
    .select("payment_date")
    .lte("payment_date", onOrBefore)
    .order("payment_date", { ascending: false })
    .limit(1);
  const row = (data ?? [])[0] as { payment_date?: string } | undefined;
  return row?.payment_date ?? null;
}

export async function findReceiptIdByNumber(receiptNumber: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("receipts").select("id").eq("receipt_number", receiptNumber).limit(1);
  const row = (data ?? [])[0] as { id?: string } | undefined;
  return row?.id ?? null;
}

export type ReceiptHistoryEvent = { at: string; kind: "posted" | "reversed" | "sent" | "read"; amount?: number; note?: string | null };

export type DeskReceiptDetail = {
  detail: ReceiptDetail;
  isReversed: boolean;
  share: { status: "not_sent" | "sent" | "delivered" | "read" | "failed"; at: string | null };
  history: ReceiptHistoryEvent[];
};

/** One receipt by its printed number, with its reversal and WhatsApp history. */
export async function getDeskReceipt(receiptNumber: string): Promise<DeskReceiptDetail | null> {
  const id = await findReceiptIdByNumber(receiptNumber);
  if (!id) return null;
  const detail = await getReceiptDetail(id);
  if (!detail) return null;

  const supabase = await createClient();
  const [paymentsRes, sendsRes] = await Promise.all([
    supabase.from("payments").select("id").eq("receipt_id", id),
    supabase
      .from("whatsapp_reminder_sends")
      .select("status, delivery_status, created_at, delivered_at, read_at")
      .eq("receipt_id", id)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const paymentIds = ((paymentsRes.data ?? []) as { id: string }[]).map((p) => p.id);
  let reversals: { amount_delta: number; reason: string | null; created_at: string }[] = [];
  if (paymentIds.length > 0) {
    // A receipt has a handful of payment lines, never near the URL limit.
    const { data } = await supabase
      .from("payment_adjustments")
      .select("amount_delta, reason, created_at")
      .eq("adjustment_type", "reversal")
      .in("payment_id", paymentIds.slice(0, 50))
      .order("created_at", { ascending: true });
    reversals = (data ?? []) as typeof reversals;
  }

  const history: ReceiptHistoryEvent[] = [{ at: detail.createdAt, kind: "posted", amount: detail.totalAmount, note: detail.receivedBy ?? detail.createdByName }];
  const byMoment = new Map<string, { amount: number; note: string | null }>();
  for (const r of reversals) {
    const key = r.created_at.slice(0, 16);
    const cur = byMoment.get(key) ?? { amount: 0, note: r.reason };
    cur.amount += Math.abs(Number(r.amount_delta) || 0);
    byMoment.set(key, cur);
  }
  for (const [at, v] of byMoment) history.push({ at, kind: "reversed", amount: v.amount, note: v.note });

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
  history.sort((a, b) => (a.at < b.at ? -1 : 1));

  const reversedAmount = detail.reversedAmount ?? 0;
  return { detail, isReversed: detail.totalAmount > 0 && reversedAmount >= detail.totalAmount, share, history };
}
