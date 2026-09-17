import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import {
  normaliseQuery,
  pageWindow,
  queryKind,
  type DirectoryQuery,
  type PageWindow,
} from "@/modules/students/domain/directory";

/**
 * The student directory: search the fee app's roster, scoped to this session.
 *
 * **Filtered and counted in Postgres, not in the browser.** The staff list is
 * a few dozen and ships whole (D-29); the roster is a few hundred and will be
 * a few thousand, and PostgREST truncates a read at a thousand rows with no
 * error at all (D-62). A directory that fetched everything would work today
 * and start silently hiding children the year the school grew.
 *
 * Service-role, like every other fee read here: the fee app's RLS gates
 * `public.students` on its own `public.users.role`, so a cookie-client read
 * returns zero rows and no error (D-32). The permission check is therefore in
 * this function rather than left to the caller.
 */

export type DirectoryRow = {
  studentId: string;
  fullName: string;
  admissionNo: string | null;
  fatherName: string | null;
  guardianPhone: string | null;
  /** From VPPS One's own enrolment, not from the fee app's current class. */
  classId: string | null;
  rollNo: string | null;
};

export type DirectoryPage = {
  rows: DirectoryRow[];
  total: number;
  window: PageWindow;
};

type StudentRow = {
  id: string;
  full_name: string;
  admission_no: string | null;
  father_name: string | null;
  guardian_phone: string | null;
};

export async function searchStudents(
  query: DirectoryQuery,
  sessionLabel: string,
): Promise<DirectoryPage> {
  await assertPermission("students:view");

  /**
   * Scope first, from **VPPS One's own enrolments**.
   *
   * Not `public.students.class_id`: that column holds where a child is today
   * and the fee app overwrites it on promotion, so filtering on it would put
   * last year's Class 6 into this year's (task 1.6). The academic record is
   * the one that answers "who was in this class in this session".
   */
  const supabase = await createClient();
  let enrolmentQuery = supabase
    .from("enrolments")
    .select("student_id, class_id, roll_no")
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled");

  if (query.classId) enrolmentQuery = enrolmentQuery.eq("class_id", query.classId);

  const { data: enrolments, error: enrolmentError } = await enrolmentQuery.returns<
    { student_id: string; class_id: string; roll_no: string | null }[]
  >();

  if (enrolmentError) {
    throw new Error(`Could not read the roll: ${enrolmentError.message}`);
  }

  const inScope = new Map(
    (enrolments ?? []).map((row) => [row.student_id, row]),
  );

  if (inScope.size === 0) {
    return { rows: [], total: 0, window: pageWindow(query.page, 0) };
  }

  const text = normaliseQuery(query.text);
  const kind = queryKind(text);

  let search = createAdminClient()
    .schema(FEE_SCHEMA)
    .from("students")
    .select("id, full_name, admission_no, father_name, guardian_phone", {
      count: "exact",
    })
    .in("id", [...inScope.keys()]);

  if (kind === "admission") {
    // Exact, not a substring: typing "12" must not return every child whose
    // admission number happens to contain a 12.
    search = search.eq("admission_no", text);
  } else if (kind === "phone") {
    const digits = text.replace(/\D/g, "");
    search = search.or(`guardian_phone.eq.${digits},primary_phone.eq.${digits}`);
  } else if (kind === "name") {
    // Loose, and across three columns. The father's name, because the office is
    // as likely to be given "Sharma's daughter" as a child's own full name —
    // and the admission number, because this school issues alphanumeric ones
    // (`TEST-CL6-002`), which the bare-number branch above never sees. Without
    // it, pasting an SR from a spreadsheet searches only names and finds
    // nothing, which reads as "that child is not here".
    const escaped = text.replace(/[%,()]/g, " ");
    search = search.or(
      `full_name.ilike.%${escaped}%,father_name.ilike.%${escaped}%,admission_no.ilike.%${escaped}%`,
    );
  }

  // A count first, so the page window is right before the rows are asked for.
  const { count, error: countError } = await search.range(0, 0);
  if (countError) {
    throw new Error(`Could not search the students: ${countError.message}`);
  }

  const total = count ?? 0;
  const window = pageWindow(query.page, total);

  if (total === 0) return { rows: [], total, window };

  const { data, error } = await search
    .order("full_name")
    .range(window.from, window.to)
    .returns<StudentRow[]>();

  if (error) throw new Error(`Could not search the students: ${error.message}`);

  return {
    rows: (data ?? []).map((row) => {
      const enrolment = inScope.get(row.id);
      return {
        studentId: row.id,
        fullName: row.full_name,
        admissionNo: row.admission_no,
        fatherName: row.father_name,
        guardianPhone: row.guardian_phone,
        classId: enrolment?.class_id ?? null,
        rollNo: enrolment?.roll_no ?? null,
      };
    }),
    total,
    window,
  };
}
