import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import {
  planRebuild,
  type Enrolment,
  type EnrolmentStatus,
  type FeeStudent,
} from "@/modules/enrolments/domain/enrolments";

/**
 * The fee app's students. **SELECT only, forever** (rule 2, D-5).
 *
 * Service-role for the same reason as the classes read (D-32): the fee app's
 * RLS gates `public.students` on `has_any_permission()`, which reads
 * `public.users.role`. VPPS One staff have no row there by design, so through
 * the cookie client this returns zero rows *and no error* — which would render
 * as "the school has no students". The permission check is here rather than at
 * the call site so a future caller cannot forget it.
 */
type FeeStudentRow = {
  id: string;
  admission_no: string | null;
  full_name: string;
  class_id: string | null;
  roll_no: string | null;
  status: string | null;
};

export async function listFeeStudents(sessionLabel: string): Promise<FeeStudent[]> {
  await assertPermission("academics:view");

  // `public.students` has no session column — it holds today. The session is
  // applied by joining through the classes that belong to it, which is also
  // what stops a student from another year's class arriving in this list.
  const { data: classRows, error: classError } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("classes")
    .select("id")
    .eq("session_label", sessionLabel)
    .returns<{ id: string }[]>();

  if (classError) {
    throw new Error(`Could not read the fee app's classes: ${classError.message}`);
  }

  const classIds = classRows.map((row) => row.id);
  if (classIds.length === 0) return [];

  // Paged, for the same reason as `listEnrolments()`: this is every child in
  // the school, and the consistency check compares the two lists row by row.
  // A truncated fee-side list would report the children past the thousandth as
  // having left.
  const admin = createAdminClient();

  const data = await fetchAllRows<FeeStudentRow>(
    (from, to) =>
      admin
        .schema(FEE_SCHEMA)
        .from("students")
        .select("id, admission_no, full_name, class_id, roll_no, status")
        .in("class_id", classIds)
        .order("id")
        .range(from, to)
        .returns<FeeStudentRow[]>(),
    "the fee app's students",
  );

  return data.map((row) => ({
    id: row.id,
    admissionNo: row.admission_no,
    fullName: row.full_name,
    classId: row.class_id,
    rollNo: row.roll_no,
    status: row.status,
  }));
}

type EnrolmentRow = {
  id: string;
  student_id: string;
  class_id: string;
  session_label: string;
  roll_no: string | null;
  status: EnrolmentStatus;
};

/**
 * The whole school's enrolment record for a session.
 *
 * Paged: this is one row per child, and the consistency check compares it
 * against the fee app row by row. A school of a thousand is not far off, and a
 * check run on a silently truncated list would report every child past the
 * thousandth as missing from VPPS One.
 */
export async function listEnrolments(sessionLabel: string): Promise<Enrolment[]> {
  const supabase = await createClient();

  const data = await fetchAllRows<EnrolmentRow>(
    (from, to) =>
      supabase
        .from("enrolments")
        .select("id, student_id, class_id, session_label, roll_no, status")
        .eq("session_label", sessionLabel)
        .order("id")
        .range(from, to)
        .returns<EnrolmentRow[]>(),
    "the enrolments",
  );

  return data.map((row) => ({
    id: row.id,
    studentId: row.student_id,
    classId: row.class_id,
    sessionLabel: row.session_label,
    rollNo: row.roll_no,
    status: row.status,
  }));
}

/**
 * Build or rebuild this session's enrolments from the fee app.
 *
 * An upsert on `(student_id, session_label)`, so running it twice is an update
 * rather than a duplicate — and running it after a class change is how the
 * difference gets resolved.
 *
 * It deliberately does **not** delete rows whose student the fee app no longer
 * has. Those children still have attendance and marks here; dropping the row
 * would orphan that history, and the consistency check reports them instead so
 * somebody decides.
 */
export async function rebuildEnrolments(
  sessionLabel: string,
  createdByUserId: string,
): Promise<{ written: number; skippedNoClass: number; skippedInactive: number }> {
  const feeStudents = await listFeeStudents(sessionLabel);
  const plan = planRebuild(feeStudents, sessionLabel);

  if (plan.rows.length === 0) {
    return { written: 0, ...plan };
  }

  const admin = createAdminClient();

  // In batches: a school of a few hundred fits in one request, but a
  // multi-thousand upsert is a request body nobody has tested.
  const BATCH = 500;
  for (let index = 0; index < plan.rows.length; index += BATCH) {
    const { error } = await admin
      .from("enrolments")
      .upsert(
        plan.rows.slice(index, index + BATCH).map((row) => ({
          ...row,
          created_by: createdByUserId,
        })),
        { onConflict: "student_id,session_label" },
      );

    if (error) throw error;
  }

  return {
    written: plan.rows.length,
    skippedNoClass: plan.skippedNoClass,
    skippedInactive: plan.skippedInactive,
  };
}
