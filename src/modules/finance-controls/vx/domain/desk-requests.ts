/**
 * The Receipts desk's own requests (`vppsone.fee_desk_requests`: receipt
 * reversals, write-offs) as rows of "My requests" (B08). Pure.
 *
 * "My requests" read only `acc_requests`, so a reversal asked for on a receipt
 * was visible while pending (Needs you, the receipt's own pill) and vanished
 * from every list the moment an admin decided it. These rows are mapped into
 * the same shape and merged by date; they are history only — withdraw, remind
 * and decide act on `acc_requests` and are not offered for them (`source`).
 */

import type { RequestKind, RequestStatus } from "./books";
import type { AccRequestRow } from "../types";

export type DeskRequestDbRow = {
  id: string;
  kind: string;
  status: string;
  amount: number | string | null;
  reason_code: string | null;
  note: string | null;
  receipt_id: string | null;
  receipt_number: string | null;
  student_id: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

const REASON: Record<string, string> = {
  wrong_amount: "Wrong amount typed",
  wrong_student: "Wrong student",
  cheque_bounced: "Cheque bounced",
  duplicate: "Entered twice",
};

export function deskRequestStatus(status: string): RequestStatus {
  if (status === "approved") return "approved";
  if (status === "declined") return "declined";
  if (status === "withdrawn") return "withdrawn";
  return "waiting";
}

export function deskRequestToRow(
  r: DeskRequestDbRow,
  ctx: { staffId: string; names: ReadonlyMap<string, string>; studentName: (id: string) => string | null },
): AccRequestRow {
  const status = deskRequestStatus(r.status);
  const kind: RequestKind = r.kind === "reversal" ? "reversal" : "other";
  const title = r.kind === "reversal" ? `Reverse receipt ${r.receipt_number ?? ""}`.trim() : r.kind === "write_off" ? "Write off dues" : "Request";
  const reason = [r.reason_code ? (REASON[r.reason_code] ?? r.reason_code) : null, r.note].filter(Boolean).join(" · ");
  return {
    id: r.id,
    kind,
    title,
    reason,
    amount: r.amount == null ? null : Number(r.amount) || 0,
    studentId: r.student_id,
    studentName: r.student_id ? ctx.studentName(r.student_id) : null,
    receiptId: r.receipt_id,
    requestedAt: r.created_at,
    requestedByName: r.requested_by_name ?? (r.requested_by ? (ctx.names.get(r.requested_by) ?? "") : ""),
    mine: r.requested_by === ctx.staffId,
    status,
    remindedAt: null,
    decidedAt: status === "approved" || status === "declined" ? r.decided_at : null,
    decidedByName: r.decided_by ? (ctx.names.get(r.decided_by) ?? null) : null,
    decisionNote: r.decision_note,
    withdrawnAt: status === "withdrawn" ? (r.decided_at ?? r.created_at) : null,
    canRemind: false,
    source: "desk",
  };
}

/** Both lists, newest request first, at most `limit`. */
export function mergeRequestRows(a: readonly AccRequestRow[], b: readonly AccRequestRow[], limit: number): AccRequestRow[] {
  return [...a, ...b].sort((x, y) => Date.parse(y.requestedAt) - Date.parse(x.requestedAt)).slice(0, Math.max(0, limit));
}
