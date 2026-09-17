import "server-only";

import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import type { AttendanceStatus } from "@/modules/attendance/domain/attendance";
import type {
  Correction,
  CorrectionStatus,
} from "@/modules/attendance/domain/corrections";

type CorrectionRow = {
  id: string;
  register_id: string;
  student_id: string;
  from_status: AttendanceStatus | null;
  to_status: AttendanceStatus;
  reason: string;
  requested_by: string;
  requested_at: string;
  status: CorrectionStatus;
  decided_at: string | null;
  decision_note: string | null;
  attendance_registers: { day: string; class_id: string } | null;
  requester: { display_name: string } | null;
  decider: { display_name: string } | null;
};

const COLUMNS =
  "id, register_id, student_id, from_status, to_status, reason, requested_by, " +
  "requested_at, status, decided_at, decision_note, " +
  "attendance_registers!inner(day, class_id), " +
  "requester:staff_profiles!attendance_corrections_requested_by_fkey(display_name), " +
  "decider:staff_profiles!attendance_corrections_decided_by_fkey(display_name)";

/**
 * The correction queue, with the names a person needs to judge it.
 *
 * Student names come from the fee app in one extra read rather than a join,
 * because the join would cross schemas and the fee side needs the service-role
 * client anyway (D-32).
 */
export async function listCorrections(
  sessionLabel: string,
  classLabels: Map<string, string>,
): Promise<Correction[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_corrections")
    .select(COLUMNS)
    .order("requested_at", { ascending: false })
    .limit(200)
    .returns<CorrectionRow[]>();

  if (error) throw new Error(`Could not read the corrections: ${error.message}`);
  if (data.length === 0) return [];

  const studentIds = [...new Set(data.map((row) => row.student_id))];
  const { data: students } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("students")
    .select("id, full_name")
    .in("id", studentIds)
    .returns<{ id: string; full_name: string }[]>();

  const names = new Map((students ?? []).map((s) => [s.id, s.full_name]));

  return data.map((row) => ({
    id: row.id,
    registerId: row.register_id,
    studentId: row.student_id,
    studentName: names.get(row.student_id) ?? "—",
    classLabel: classLabels.get(row.attendance_registers?.class_id ?? "") ?? "—",
    day: row.attendance_registers?.day ?? "",
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    requestedById: row.requested_by,
    requestedByName: row.requester?.display_name ?? "—",
    requestedAt: row.requested_at,
    status: row.status,
    decidedByName: row.decider?.display_name ?? null,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
  }));
}

/**
 * How many requests are waiting — for the badge on the Today card.
 *
 * A count, not the list: the card only needs the number, and fetching two
 * hundred rows plus their student names to render "3" would be the kind of
 * query that is invisible until the school has a year of data.
 */
export async function countPendingCorrections(): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("attendance_corrections")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) throw new Error(`Could not count the requests: ${error.message}`);
  return count ?? 0;
}

export async function getCorrection(id: string): Promise<{
  id: string;
  registerId: string;
  studentId: string;
  toStatus: AttendanceStatus;
  requestedBy: string;
  status: CorrectionStatus;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_corrections")
    .select("id, register_id, student_id, to_status, requested_by, status")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      register_id: string;
      student_id: string;
      to_status: AttendanceStatus;
      requested_by: string;
      status: CorrectionStatus;
    }>();

  if (error) throw new Error(`Could not read that request: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    registerId: data.register_id,
    studentId: data.student_id,
    toStatus: data.to_status,
    requestedBy: data.requested_by,
    status: data.status,
  };
}

export async function hasPendingCorrection(
  registerId: string,
  studentId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_corrections")
    .select("id")
    .eq("register_id", registerId)
    .eq("student_id", studentId)
    .eq("status", "pending")
    .maybeSingle<{ id: string }>();

  if (error) throw new Error(`Could not check for a request: ${error.message}`);
  return data !== null;
}

export async function requestCorrection(input: {
  registerId: string;
  studentId: string;
  fromStatus: AttendanceStatus | null;
  toStatus: AttendanceStatus;
  reason: string;
  requestedByStaffId: string;
}): Promise<void> {
  const { error } = await createAdminClient()
    .from("attendance_corrections")
    .insert({
      register_id: input.registerId,
      student_id: input.studentId,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      reason: input.reason,
      requested_by: input.requestedByStaffId,
    });

  if (error) throw error;
}

/**
 * Decide a request.
 *
 * On approval the mark is rewritten **after** the request is marked approved,
 * so an interruption leaves an approved request whose mark still says the old
 * thing — visible in the queue and fixable — rather than a changed mark with
 * no record of who changed it.
 */
export async function decideCorrection(input: {
  correctionId: string;
  approve: boolean;
  decisionNote: string | null;
  deciderStaffId: string;
  registerId: string;
  studentId: string;
  toStatus: AttendanceStatus;
}): Promise<void> {
  const admin = createAdminClient();

  const { error } = await admin
    .from("attendance_corrections")
    .update({
      status: input.approve ? "approved" : "rejected",
      decided_by: input.deciderStaffId,
      decided_at: new Date().toISOString(),
      decision_note: input.decisionNote,
    })
    .eq("id", input.correctionId)
    // Only a pending one: two approvers pressing at once must not both win.
    .eq("status", "pending");

  if (error) throw error;

  if (!input.approve) return;

  const { error: markError } = await admin
    .from("attendance_marks")
    .update({ status: input.toStatus })
    .eq("register_id", input.registerId)
    .eq("student_id", input.studentId);

  if (markError) throw markError;
}
