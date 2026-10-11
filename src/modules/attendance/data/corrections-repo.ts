import "server-only";

import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { fetchAllPages, fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
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
  // Never let recent decisions push an older waiting request out of the queue.
  const [waiting, history] = await Promise.all([
    fetchAllPages<CorrectionRow>((from, to) => supabase
      .from("attendance_corrections").select(COLUMNS)
      .eq("attendance_registers.session_label", sessionLabel).eq("status", "pending")
      .order("requested_at", { ascending: false }).order("id")
      .range(from, to).returns<CorrectionRow[]>(), 200),
    supabase
      .from("attendance_corrections")
      .select(COLUMNS)
      .eq("attendance_registers.session_label", sessionLabel)
      .neq("status", "pending")
      .order("requested_at", { ascending: false })
      .order("id")
      .limit(200)
      .returns<CorrectionRow[]>(),
  ]);
  const error = waiting.error ?? history.error;
  const data = [...waiting.data, ...(history.data ?? [])];

  if (error) throw new Error(`Could not read the corrections: ${(error as { message?: string }).message ?? "unavailable"}`);
  if (data.length === 0) return [];

  const studentIds = [...new Set(data.map((row) => row.student_id))];
  const admin = createAdminClient();
  const { data: students, error: namesError } = await fetchInChunks<{ id: string; full_name: string }>(studentIds, IN_FILTER_CHUNK_SIZE, ids => admin
    .schema(FEE_SCHEMA)
    .from("students")
    .select("id, full_name")
    .in("id", ids)
    .returns<{ id: string; full_name: string }[]>());
  if (namesError) throw new Error(`Could not read correction student names: ${namesError instanceof Error ? namesError.message : (namesError as { message?: string }).message ?? "unavailable"}`);

  const names = new Map((students ?? []).map((s) => [s.id, s.full_name]));

  return data.map((row) => ({
    id: row.id,
    registerId: row.register_id,
    studentId: row.student_id,
    studentName: names.get(row.student_id) ?? "—",
    classId: row.attendance_registers?.class_id ?? null,
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
export async function countPendingCorrections(sessionLabel: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("attendance_corrections")
    .select("id, attendance_registers!inner(session_label)", { count: "exact", head: true })
    .eq("attendance_registers.session_label", sessionLabel)
    .eq("status", "pending");

  if (error) throw new Error(`Could not count the requests: ${error.message}`);
  return count ?? 0;
}

export async function getCorrection(id: string): Promise<{
  id: string;
  registerId: string;
  studentId: string;
  fromStatus: AttendanceStatus | null;
  toStatus: AttendanceStatus;
  reason: string;
  requestedBy: string;
  status: CorrectionStatus;
} | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_corrections")
    .select("id, register_id, student_id, from_status, to_status, reason, requested_by, status")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      register_id: string;
      student_id: string;
      from_status: AttendanceStatus | null;
      to_status: AttendanceStatus;
      reason: string;
      requested_by: string;
      status: CorrectionStatus;
    }>();

  if (error) throw new Error(`Could not read that request: ${error.message}`);
  if (!data) return null;

  return {
    id: data.id,
    registerId: data.register_id,
    studentId: data.student_id,
    fromStatus: data.from_status,
    toStatus: data.to_status,
    reason: data.reason,
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
 * Turn a request down.
 *
 * Approving is not here: an approved request is a correction of the register,
 * and `save_attendance_register` writes it — the new revision, its reason and
 * the request's approval — in one transaction (P6).
 */
export async function rejectCorrection(input: {
  correctionId: string;
  decisionNote: string | null;
  deciderStaffId: string;
}): Promise<void> {
  const { data, error } = await createAdminClient()
    .from("attendance_corrections")
    .update({
      status: "rejected",
      decided_by: input.deciderStaffId,
      decided_at: new Date().toISOString(),
      decision_note: input.decisionNote,
    })
    .eq("id", input.correctionId)
    // Only a pending one: two people pressing at once must not both decide.
    .eq("status", "pending")
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error) throw error;
  if (!data) throw new Error("This request has already been decided. Reload the waiting list.");
}
