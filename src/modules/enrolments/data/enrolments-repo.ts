import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { assertActorEveryClass, type VerifiedActor } from "@/platform/auth/verified-actor";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import { schoolToday } from "@/platform/dates";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import {
  planRebuild,
  planStudentSync,
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
  return readEnrolments(await createClient(), sessionLabel);
}

/**
 * `listEnrolments` for a member of staff verified by the AI connection. RLS
 * on `enrolments` gives a school-wide reader every class and anyone else
 * their own; this service-role twin serves only a school-wide reader with
 * `attendance:view` (the board's need), so it asks for both.
 */
export async function listEnrolmentsAs(actor: VerifiedActor, sessionLabel: string): Promise<Enrolment[]> {
  assertActorEveryClass(actor, "attendance:view");
  return readEnrolments(createAdminClient(), sessionLabel);
}

async function readEnrolments(
  supabase: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>,
  sessionLabel: string,
): Promise<Enrolment[]> {
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

/**
 * Bring these children's enrolments in line with their fee row, after an
 * action that changed it: a withdrawal or its undo, a class move, a promotion.
 * Teachers' registers, marks and notes read enrolments, so without this a
 * child who left stays on the register and a moved child stays in the old
 * class. Callers have already checked their own permission.
 */
export async function syncStudentEnrolments(studentIds: string[], actorUserId: string | null, leftOn?: string): Promise<void> {
  const ids = [...new Set(studentIds.filter(Boolean))];
  if (ids.length === 0) return;
  const admin = createAdminClient();
  const students = await fetchInChunks<FeeStudentRow>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin.schema(FEE_SCHEMA).from("students").select("id, admission_no, full_name, class_id, roll_no, status").in("id", chunk).returns<FeeStudentRow[]>(),
  );
  if (students.error) throw new Error("Could not read the students to update the class lists.");
  const classIds = [...new Set(students.data.map((row) => row.class_id).filter((id): id is string => !!id))];
  const classes = await fetchInChunks<{ id: string; session_label: string }>(classIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    admin.schema(FEE_SCHEMA).from("classes").select("id, session_label").in("id", chunk).returns<{ id: string; session_label: string }[]>(),
  );
  if (classes.error) throw new Error("Could not read the classes to update the class lists.");
  const sessionOf = new Map(classes.data.map((row) => [row.id, row.session_label]));

  const plan = planStudentSync(
    students.data.map((row) => ({
      id: row.id,
      admissionNo: row.admission_no,
      fullName: row.full_name,
      classId: row.class_id,
      rollNo: row.roll_no,
      status: row.status,
      classSession: row.class_id ? (sessionOf.get(row.class_id) ?? null) : null,
    })),
  );

  if (plan.enrol.length > 0) {
    const { error } = await admin
      .from("enrolments")
      .upsert(plan.enrol.map((row) => ({ ...row, created_by: actorUserId })), { onConflict: "student_id,session_label" });
    if (error) throw new Error(`Could not update the class lists: ${error.message}`);
  }
  for (let index = 0; index < plan.left.length; index += IN_FILTER_CHUNK_SIZE) {
    const { error } = await admin
      .from("enrolments")
      .update({ status: "left", left_on: leftOn ?? schoolToday() })
      .eq("status", "enrolled")
      .in("student_id", plan.left.slice(index, index + IN_FILTER_CHUNK_SIZE));
    if (error) throw new Error(`Could not update the class lists: ${error.message}`);
  }
}

/**
 * Enrol every active child of a session who has no enrolment yet: the
 * children an import just added. Existing rows are left as they are, so a roll
 * number edited here survives.
 */
export async function enrolMissingStudents(sessionLabel: string, actorUserId: string | null): Promise<number> {
  const admin = createAdminClient();
  const { data: classRows, error: classError } = await admin.schema(FEE_SCHEMA).from("classes").select("id").eq("session_label", sessionLabel).returns<{ id: string }[]>();
  if (classError) throw new Error(`Could not read the fee app's classes: ${classError.message}`);
  const classIds = classRows.map((row) => row.id);
  if (classIds.length === 0) return 0;
  const students = await fetchAllRows<FeeStudentRow>(
    (from, to) =>
      admin.schema(FEE_SCHEMA).from("students").select("id, admission_no, full_name, class_id, roll_no, status").in("class_id", classIds).order("id").range(from, to).returns<FeeStudentRow[]>(),
    "the fee app's students",
  );
  const plan = planRebuild(
    students.map((row) => ({ id: row.id, admissionNo: row.admission_no, fullName: row.full_name, classId: row.class_id, rollNo: row.roll_no, status: row.status })),
    sessionLabel,
  );
  for (let index = 0; index < plan.rows.length; index += 500) {
    const { error } = await admin
      .from("enrolments")
      .upsert(plan.rows.slice(index, index + 500).map((row) => ({ ...row, created_by: actorUserId })), { onConflict: "student_id,session_label", ignoreDuplicates: true });
    if (error) throw new Error(`Could not enrol the new students: ${error.message}`);
  }
  return plan.rows.length;
}
