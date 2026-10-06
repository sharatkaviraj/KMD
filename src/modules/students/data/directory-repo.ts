import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { CHUNK_CONCURRENCY, chunkArray, fetchAllPages, mapConcurrently } from "@/platform/helpers/chunk";
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
 * **Filtered in Postgres and paginated on the server, not in the browser.**
 * The staff list is a few dozen and ships whole (D-29); the roster is a few hundred and will be
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

type EnrolmentRow = { student_id: string; class_id: string; roll_no: string | null };

// A UUID filter must fit behind ordinary proxy URL limits, even after encoding.
const DIRECTORY_ID_CHUNK_SIZE = 100;
const nameOrder = new Intl.Collator("en", { sensitivity: "variant" });

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
  const { data: enrolments, error: enrolmentError } = await fetchAllPages<EnrolmentRow>(
    (from, to) => {
      let roll = supabase
        .from("enrolments")
        .select("student_id, class_id, roll_no")
        .eq("session_label", sessionLabel)
        .eq("status", "enrolled");
      if (query.classId) roll = roll.eq("class_id", query.classId);
      return roll.order("student_id").range(from, to).returns<EnrolmentRow[]>();
    },
    200,
  );

  if (enrolmentError) {
    throw new Error(`Could not read the roll: ${(enrolmentError as { message?: string }).message ?? "unknown error"}`);
  }

  const inScope = new Map(
    (enrolments ?? []).map((row) => [row.student_id, row]),
  );

  if (inScope.size === 0) {
    return { rows: [], total: 0, window: pageWindow(query.page, 0) };
  }

  const text = normaliseQuery(query.text);
  const kind = queryKind(text);

  const admin = createAdminClient();
  const buildSearch = (ids: string[], columns: string) => {
    let search = admin
      .schema(FEE_SCHEMA)
      .from("students")
      .select(columns)
      .in("id", ids);

    if (kind === "admission") {
      // Exact, not a substring: typing "12" must not return every child whose
      // admission number happens to contain a 12.
      search = search.eq("admission_no", text);
    } else if (kind === "phone") {
      const digits = text.replace(/\D/g, "");
      search = search.or(`guardian_phone.eq.${digits},primary_phone.eq.${digits}`);
    } else if (kind === "name") {
      // Office staff search a child's name, father's name or alphanumeric SR.
      // Keep all three columns; bare-number admissions stay exact above.
      const escaped = text.replace(/[%,()]/g, " ");
      search = search.or(
        `full_name.ilike.%${escaped}%,father_name.ilike.%${escaped}%,admission_no.ilike.%${escaped}%`,
      );
    }

    return search;
  };

  // Apply the same SQL search to disjoint, bounded ID chunks. Only names/IDs
  // are needed to form the global order and exact count; contact details for
  // the other pages never leave Postgres. Fetching a page per chunk would
  // scramble pagination; slicing happens only after the global merge.
  // The chunks are independent and the merge is sorted below, so they are
  // read side by side rather than one round trip after another — the whole
  // school was six sequential requests before the page could render.
  const chunkResults = await mapConcurrently(
    chunkArray([...inScope.keys()], DIRECTORY_ID_CHUNK_SIZE),
    CHUNK_CONCURRENCY,
    (ids) =>
      buildSearch(ids, "id, full_name")
        .order("full_name").order("id")
        .range(0, ids.length - 1)
        .returns<{ id: string; full_name: string }[]>(),
  );
  const matches: { id: string; full_name: string }[] = [];
  for (const { data, error } of chunkResults) {
    if (error) throw new Error(`Could not search the students: ${error.message}`);
    matches.push(...(data ?? []));
  }
  // Stable alphabetical ordering across chunks, including equal names. This
  // server-side collation is independent of the viewer's chosen UI language.
  matches.sort((a, b) => nameOrder.compare(a.full_name, b.full_name) || a.id.localeCompare(b.id));
  const total = matches.length;
  const window = pageWindow(query.page, total);
  if (total === 0) return { rows: [], total, window };

  const pageIds = matches.slice(window.from, window.to + 1).map((row) => row.id);
  const { data: pageRows, error } = await buildSearch(
    pageIds, "id, full_name, admission_no, father_name, guardian_phone",
  ).range(0, pageIds.length - 1).returns<StudentRow[]>();
  if (error) throw new Error(`Could not search the students: ${error.message}`);
  const byId = new Map((pageRows ?? []).map((row) => [row.id, row]));
  const data = pageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });

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
