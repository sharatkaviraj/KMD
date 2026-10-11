import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";

/*
 * The fee desk's own records on /receipts, in the `vppsone` schema: counted
 * day closes (insert-only, a reopen is a new row) and reversal requests for an
 * admin. Reads go through the signed-in client and its RLS; writes through
 * the service-role client, called only from actions that checked first.
 */

export type CloseEventRow = {
  id: string;
  paymentDate: string;
  action: "close" | "reopen";
  cashExpected: number;
  cashCounted: number;
  upiChecked: boolean;
  receiptCount: number;
  reversedCount: number;
  expected: Record<string, number>;
  note: string | null;
  actorName: string | null;
  createdAt: string;
};

type CloseEventDb = {
  id: string;
  payment_date: string;
  action: "close" | "reopen";
  cash_expected: number | string;
  cash_counted: number | string;
  upi_checked: boolean;
  receipt_count: number;
  reversed_count: number;
  expected: Record<string, number> | null;
  note: string | null;
  actor_name: string | null;
  created_at: string;
};

function toEvent(r: CloseEventDb): CloseEventRow {
  return {
    id: r.id,
    paymentDate: r.payment_date,
    action: r.action,
    cashExpected: Number(r.cash_expected) || 0,
    cashCounted: Number(r.cash_counted) || 0,
    upiChecked: r.upi_checked,
    receiptCount: r.receipt_count,
    reversedCount: r.reversed_count,
    expected: r.expected ?? {},
    note: r.note,
    actorName: r.actor_name,
    createdAt: r.created_at,
  };
}

/** Close and reopen events for the days from `from` to `to`, oldest first. */
export async function listCloseEvents(from: string, to: string, opts: { strict?: boolean; sessionLabel: string }): Promise<CloseEventRow[]> {
  const supabase = await createClient();
  const events: CloseEventRow[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("fee_day_close_events")
      .select("id, payment_date, action, cash_expected, cash_counted, upi_checked, receipt_count, reversed_count, expected, note, actor_name, created_at")
      .gte("payment_date", from)
      .lte("payment_date", to)
      .eq("session_label", opts.sessionLabel)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + pageSize - 1);
    // Never mistake a failed page for an open day or a complete history.
    if (error || !Array.isArray(data)) {
      if (opts.strict) throw new Error(`Could not read the day's close history: ${error?.message ?? "Invalid response"}`);
      return [];
    }
    events.push(...(data as CloseEventDb[]).map(toEvent));
    if (data.length < pageSize) return events;
  }
}

export type NewCloseEvent = {
  paymentDate: string;
  action: "close" | "reopen";
  sessionLabel: string;
  expected: Record<string, number>;
  denominations: Record<string, number>;
  cashExpected: number;
  cashCounted: number;
  upiChecked: boolean;
  receiptCount: number;
  reversedCount: number;
  note: string | null;
  actorId: string;
  actorName: string;
};

export async function insertCloseEvent(e: NewCloseEvent): Promise<void> {
  const { error } = await createAdminClient()
    .from("fee_day_close_events")
    .insert({
      payment_date: e.paymentDate,
      action: e.action,
      session_label: e.sessionLabel,
      expected: e.expected,
      denominations: e.denominations,
      cash_expected: e.cashExpected,
      cash_counted: e.cashCounted,
      upi_checked: e.upiChecked,
      receipt_count: e.receiptCount,
      reversed_count: e.reversedCount,
      note: e.note,
      actor_id: e.actorId,
      actor_name: e.actorName,
    });
  if (error) throw new Error(error.message);
}

export type PendingRequest = { id: string; createdAt: string; requestedByName: string | null; reasonCode: string };

export async function pendingReversalRequest(receiptId: string): Promise<PendingRequest | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_desk_requests")
    .select("id, created_at, requested_by_name, reason_code")
    .eq("kind", "reversal")
    .eq("status", "pending")
    .eq("receipt_id", receiptId)
    .limit(1);
  if (error) throw new Error(error.message);
  const r = (data ?? [])[0] as { id: string; created_at: string; requested_by_name: string | null; reason_code: string } | undefined;
  return r ? { id: r.id, createdAt: r.created_at, requestedByName: r.requested_by_name, reasonCode: r.reason_code } : null;
}

export async function insertReversalRequest(r: {
  sessionLabel: string;
  studentId: string;
  receiptId: string;
  receiptNumber: string;
  amount: number;
  reasonCode: string;
  note: string | null;
  requestedBy: string;
  requestedByName: string;
}): Promise<"created" | "exists"> {
  const { error } = await createAdminClient()
    .from("fee_desk_requests")
    .insert({
      kind: "reversal",
      session_label: r.sessionLabel,
      student_id: r.studentId,
      receipt_id: r.receiptId,
      receipt_number: r.receiptNumber,
      amount: r.amount,
      reason_code: r.reasonCode,
      note: r.note,
      requested_by: r.requestedBy,
      requested_by_name: r.requestedByName,
    });
  if (error) {
    if (error.code === "23505") return "exists";
    throw new Error(error.message);
  }
  return "created";
}

/**
 * The admin has reversed the receipt: any request for it is now decided.
 * Without this the request stayed "pending" in Needs you for good.
 */
export async function approveReversalRequests(receiptId: string, deciderId: string, note: string | null): Promise<void> {
  const { error } = await createAdminClient()
    .from("fee_desk_requests")
    .update({ status: "approved", decided_by: deciderId, decided_at: new Date().toISOString(), decision_note: note })
    .eq("kind", "reversal")
    .eq("status", "pending")
    .eq("receipt_id", receiptId);
  if (error) throw new Error(error.message);
}
