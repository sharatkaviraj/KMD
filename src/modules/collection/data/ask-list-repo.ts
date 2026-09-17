import "server-only";

import { FEE_SCHEMA } from "@/platform/env";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createAdminClient } from "@/platform/supabase/admin";
import type { MatchableStudent } from "@/modules/collection/domain/ask-list";

/**
 * Every child an uploaded sheet could be naming.
 *
 * **On the roll and not.** A child who has left is loaded on purpose, so the
 * matcher can say "this child is not on this session's roll" against the row
 * that named them. Loading only the enrolled would make that row read as "no
 * such SR number", which sends the office looking for a typo that is not
 * there (S-06).
 *
 * Service-role: `public.students` is gated by the fee app's own RLS on
 * `public.users.role`, which VPPS One's staff do not hold, so a cookie client
 * reads zero rows and no error at all (D-32).
 */
export async function matchableRoll(sessionLabel: string): Promise<MatchableStudent[]> {
  const admin = createAdminClient();

  // The whole school, paged: the roster is a few hundred today and PostgREST
  // truncates at a thousand with no error (D-62). A matcher that silently
  // stopped at a thousand would report the rest as "no such child".
  const students = await fetchAllRows<{
    id: string;
    full_name: string | null;
    admission_no: string | null;
  }>(
    (from, to) =>
      admin
        .schema(FEE_SCHEMA)
        .from("students")
        .select("id, full_name, admission_no")
        .order("id")
        .range(from, to)
        .returns<{ id: string; full_name: string | null; admission_no: string | null }[]>(),
    "the students",
  );

  const enrolments = await fetchAllRows<{ student_id: string; class_id: string }>(
    (from, to) =>
      admin
        .from("enrolments")
        .select("student_id, class_id")
        .eq("session_label", sessionLabel)
        .eq("status", "enrolled")
        .order("student_id")
        .range(from, to)
        .returns<{ student_id: string; class_id: string }[]>(),
    "the roll",
  );

  const classOf = new Map(enrolments.map((row) => [row.student_id, row.class_id]));

  return students.map((student) => ({
    id: student.id,
    fullName: student.full_name ?? "—",
    admissionNo: student.admission_no,
    classId: classOf.get(student.id) ?? null,
    isEnrolled: classOf.has(student.id),
  }));
}
