import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";

/*
 * The Dues screen's own records in `vppsone`: the promises taken on a call
 * (the amount and the day; the contact itself is in the fee app's log) and
 * write-off requests for an admin. Reads use the signed-in client and RLS;
 * writes the service-role client, from actions that checked first.
 */

export type PromiseRow = {
  id: string;
  studentId: string;
  kind: "pay" | "visit";
  promisedOn: string;
  amount: number;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
};

/** Promises made in this session since `since` (a date), newest first. */
export async function listPromises(sessionLabel: string, since: string): Promise<PromiseRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_call_promises")
    .select("id, student_id, kind, promised_on, amount, note, created_by_name, created_at")
    .eq("session_label", sessionLabel)
    .gte("promised_on", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return ((data ?? []) as { id: string; student_id: string; kind: "pay" | "visit"; promised_on: string; amount: number | string; note: string | null; created_by_name: string | null; created_at: string }[]).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    kind: r.kind,
    promisedOn: r.promised_on,
    amount: Number(r.amount) || 0,
    note: r.note,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
  }));
}

export async function insertPromise(p: {
  sessionLabel: string;
  studentId: string;
  kind: "pay" | "visit";
  promisedOn: string;
  amount: number;
  note: string | null;
  createdBy: string;
  createdByName: string;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("fee_call_promises")
    .insert({
      session_label: p.sessionLabel,
      student_id: p.studentId,
      kind: p.kind,
      promised_on: p.promisedOn,
      amount: p.amount,
      note: p.note,
      created_by: p.createdBy,
      created_by_name: p.createdByName,
    });
  if (error) throw new Error(error.message);
}

export type WriteOffRequest = { id: string; studentId: string; amount: number; reasonCode: string; status: string; createdAt: string; requestedByName: string | null };

export async function listWriteOffRequests(sessionLabel: string): Promise<WriteOffRequest[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_desk_requests")
    .select("id, student_id, amount, reason_code, status, created_at, requested_by_name")
    .eq("kind", "write_off")
    .eq("session_label", sessionLabel)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return ((data ?? []) as { id: string; student_id: string; amount: number | string; reason_code: string; status: string; created_at: string; requested_by_name: string | null }[]).map((r) => ({
    id: r.id,
    studentId: r.student_id,
    amount: Number(r.amount) || 0,
    reasonCode: r.reason_code,
    status: r.status,
    createdAt: r.created_at,
    requestedByName: r.requested_by_name,
  }));
}

export async function insertWriteOffRequest(r: {
  sessionLabel: string;
  studentId: string;
  amount: number;
  reasonCode: string;
  note: string | null;
  requestedBy: string;
  requestedByName: string;
}): Promise<"created" | "exists"> {
  const { error } = await createAdminClient()
    .from("fee_desk_requests")
    .insert({
      kind: "write_off",
      session_label: r.sessionLabel,
      student_id: r.studentId,
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
