import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import type { AttendanceFacts } from "@/vx/screens/admin/students-logic";

/**
 * This session's attendance for the children on one page of the Students
 * list, from `vppsone.v_student_attendance` (submitted daily registers, leave
 * not counted). One page is at most a hundred ids, chunked all the same so the
 * filter can never outgrow the URL.
 *
 * Service-role, like the coordinator's roll-ups that read the same view; the
 * permission check is here rather than left to the caller. A failed read
 * throws: the caller shows "—" for attendance, never "No attendance yet",
 * which would state something the read did not establish.
 */
export async function attendanceForStudents(studentIds: readonly string[], sessionLabel: string): Promise<Map<string, AttendanceFacts>> {
  await assertPermission("students:view");
  const ids = [...new Set(studentIds)];
  if (ids.length === 0 || !sessionLabel) return new Map();

  const admin = createAdminClient();
  const { data, error } = await fetchInChunks<{ student_id: string; days_counted: number; credit: number | string | null; attendance_pct: number | string | null }>(
    ids,
    IN_FILTER_CHUNK_SIZE,
    (chunk) =>
      admin
        .from("v_student_attendance")
        .select("student_id, days_counted, credit, attendance_pct")
        .eq("session_label", sessionLabel)
        .in("student_id", chunk),
  );
  if (error) throw new Error(`Could not read attendance: ${error instanceof Error ? error.message : String((error as { message?: string }).message ?? error)}`);
  return new Map(
    data.map((row) => [
      row.student_id,
      {
        counted: Number(row.days_counted || 0),
        credit: Number(row.credit || 0),
        pct: row.attendance_pct === null ? null : Number(row.attendance_pct),
      },
    ]),
  );
}
