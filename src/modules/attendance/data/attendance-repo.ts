import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import type { CalendarDayKind } from "@/modules/academics/domain/calendar";
import type {
  AttendanceStatus,
  Register,
  RollStudent,
} from "@/modules/attendance/domain/attendance";

/**
 * The register, its marks, and the roll it is taken against.
 */

/* ----------------------------------------------------------- the roll */

type RollRow = {
  student_id: string;
  roll_no: string | null;
};

/**
 * Who is on this class's roll today.
 *
 * From `vppsone.enrolments`, not `public.students`: the enrolment record is
 * the academic one, and it is what keeps a child on the register of the class
 * they were actually in (task 1.6). Names come from the fee app, which is
 * where they live.
 *
 * **Named arguments, because two strings in a row is an invitation.** It was
 * `(classId, sessionLabel)`, and a caller passing them the other way round
 * typechecks perfectly and fails at Postgres with `invalid input syntax for
 * type uuid: "TEST-2026-27"` — which is a clear message, arriving on a
 * teacher screen as an error card. One object costs a brace and removes the
 * class of mistake.
 */
export async function classRoll(input: {
  classId: string;
  sessionLabel: string;
}): Promise<RollStudent[]> {
  const { classId, sessionLabel } = input;

  await assertPermission("attendance:view");

  const supabase = await createClient();
  const { data: enrolments, error } = await supabase
    .from("enrolments")
    .select("student_id, roll_no")
    .eq("class_id", classId)
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled")
    .returns<RollRow[]>();

  if (error) throw new Error(`Could not read the roll: ${error.message}`);
  if (enrolments.length === 0) return [];

  // Service-role, because the fee app's RLS would return zero rows and no
  // error for a VPPS One user (D-32).
  const { data: students, error: studentError } = await createAdminClient()
    .schema(FEE_SCHEMA)
    .from("students")
    .select("id, full_name, admission_no")
    .in(
      "id",
      enrolments.map((row) => row.student_id),
    )
    .returns<{ id: string; full_name: string; admission_no: string | null }[]>();

  if (studentError) {
    throw new Error(`Could not read the students: ${studentError.message}`);
  }

  const byId = new Map(students.map((student) => [student.id, student]));

  return enrolments.map((row) => {
    const student = byId.get(row.student_id);
    return {
      studentId: row.student_id,
      // A child on the roll whose fee record has gone still appears, with a
      // placeholder: dropping them would silently shrink the register.
      fullName: student?.full_name ?? "—",
      admissionNo: student?.admission_no ?? null,
      rollNo: row.roll_no,
    };
  });
}

/* ------------------------------------------------------- the register */

type RegisterRow = {
  id: string;
  session_label: string;
  class_id: string;
  day: string;
  period: number | null;
  status: "open" | "submitted";
  taken_by: string | null;
  on_behalf_of: string | null;
  submitted_at: string | null;
};

const REGISTER_COLUMNS =
  "id, session_label, class_id, day, period, status, taken_by, on_behalf_of, submitted_at";

const toRegister = (row: RegisterRow): Register => ({
  id: row.id,
  sessionLabel: row.session_label,
  classId: row.class_id,
  day: row.day,
  period: row.period,
  status: row.status,
  takenBy: row.taken_by,
  onBehalfOf: row.on_behalf_of,
  submittedAt: row.submitted_at,
});

export async function findRegister(
  classId: string,
  sessionLabel: string,
  day: string,
  period: number | null,
): Promise<Register | null> {
  const supabase = await createClient();
  let query = supabase
    .from("attendance_registers")
    .select(REGISTER_COLUMNS)
    .eq("class_id", classId)
    .eq("session_label", sessionLabel)
    .eq("day", day);

  query = period === null ? query.is("period", null) : query.eq("period", period);

  const { data, error } = await query.maybeSingle<RegisterRow>();

  if (error) throw new Error(`Could not read the register: ${error.message}`);
  return data ? toRegister(data) : null;
}

export async function listMarks(
  registerId: string,
): Promise<Map<string, { status: AttendanceStatus; note: string | null }>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_marks")
    .select("student_id, status, note")
    .eq("register_id", registerId)
    .returns<{ student_id: string; status: AttendanceStatus; note: string | null }[]>();

  if (error) throw new Error(`Could not read the marks: ${error.message}`);

  return new Map(
    data.map((row) => [row.student_id, { status: row.status, note: row.note }]),
  );
}

/**
 * Write a register and its marks.
 *
 * **Idempotent by construction.** The register is upserted on its unique
 * (session, class, day, period), and the marks on (register, student), so a
 * teacher who taps submit twice on a bad connection ends up with exactly one
 * register and one mark per child — not two of each.
 *
 * That matters more than it sounds: the failure mode without it is a class
 * appearing twice in the monthly register, which nobody notices until a report
 * card is wrong.
 */
export async function saveRegister(input: {
  sessionLabel: string;
  classId: string;
  day: string;
  period: number | null;
  marks: { studentId: string; status: AttendanceStatus; note: string | null }[];
  submit: boolean;
  takenByStaffId: string;
  onBehalfOfStaffId: string | null;
  createdByUserId: string;
}): Promise<{ registerId: string; written: number }> {
  const admin = createAdminClient();

  const existing = await findRegister(
    input.classId,
    input.sessionLabel,
    input.day,
    input.period,
  );

  let registerId: string;

  if (existing) {
    registerId = existing.id;

    const { error } = await admin
      .from("attendance_registers")
      .update({
        status: input.submit ? "submitted" : existing.status,
        taken_by: input.takenByStaffId,
        on_behalf_of: input.onBehalfOfStaffId,
        // Kept from the first submit: re-saving a submitted register should
        // not make it look like it was handed in later than it was.
        submitted_at:
          existing.submittedAt ??
          (input.submit ? new Date().toISOString() : null),
      })
      .eq("id", registerId);

    if (error) throw error;
  } else {
    const { data, error } = await admin
      .from("attendance_registers")
      .insert({
        session_label: input.sessionLabel,
        class_id: input.classId,
        day: input.day,
        period: input.period,
        status: input.submit ? "submitted" : "open",
        taken_by: input.takenByStaffId,
        on_behalf_of: input.onBehalfOfStaffId,
        submitted_at: input.submit ? new Date().toISOString() : null,
        created_by: input.createdByUserId,
      })
      .select("id")
      .single<{ id: string }>();

    if (error) throw error;
    registerId = data.id;
  }

  if (input.marks.length > 0) {
    const { error } = await admin.from("attendance_marks").upsert(
      input.marks.map((mark) => ({
        register_id: registerId,
        student_id: mark.studentId,
        status: mark.status,
        note: mark.note,
      })),
      { onConflict: "register_id,student_id" },
    );

    if (error) throw error;
  }

  return { registerId, written: input.marks.length };
}

/* ------------------------------------------- history, for percentages */

/**
 * Every mark for one student this session, with the day it belongs to.
 *
 * The basis of the attendance percentage on the student card (task 3.5) and
 * of the monthly register (task 3.6).
 */
export async function studentAttendance(
  studentId: string,
  sessionLabel: string,
): Promise<{ day: string; status: AttendanceStatus }[]> {
  await assertPermission("attendance:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_marks")
    .select("status, attendance_registers!inner(day, session_label, status)")
    .eq("student_id", studentId)
    .eq("attendance_registers.session_label", sessionLabel)
    // Only submitted registers count. A register somebody has open on their
    // phone is not yet a fact about the child.
    .eq("attendance_registers.status", "submitted")
    .returns<
      { status: AttendanceStatus; attendance_registers: { day: string } }[]
    >();

  if (error) throw new Error(`Could not read attendance: ${error.message}`);

  return data.map((row) => ({
    day: row.attendance_registers.day,
    status: row.status,
  }));
}

/**
 * Every submitted mark for a class over a date range — the monthly register.
 *
 * Paged: a month of one class is a few hundred rows, but the range is the
 * caller's to choose and a whole session is forty children times two hundred
 * days. PostgREST would answer the first thousand of that with no error, and a
 * register short by a fortnight is worse than one that will not load.
 */
export async function classAttendanceRange(
  classId: string,
  sessionLabel: string,
  from: string,
  to: string,
): Promise<{ studentId: string; day: string; status: AttendanceStatus }[]> {
  await assertPermission("attendance:view");

  const supabase = await createClient();

  type MarkRow = {
    id: string;
    student_id: string;
    status: AttendanceStatus;
    attendance_registers: { day: string };
  };

  const data = await fetchAllRows<MarkRow>(
    (pageFrom, pageTo) =>
      supabase
        .from("attendance_marks")
        .select(
          "id, student_id, status, attendance_registers!inner(day, class_id, session_label, status)",
        )
        .eq("attendance_registers.class_id", classId)
        .eq("attendance_registers.session_label", sessionLabel)
        .eq("attendance_registers.status", "submitted")
        .gte("attendance_registers.day", from)
        .lte("attendance_registers.day", to)
        // A stable order, so a row cannot be skipped between pages.
        .order("id")
        .range(pageFrom, pageTo)
        .returns<MarkRow[]>(),
    "attendance",
  );

  return data.map((row) => ({
    studentId: row.student_id,
    day: row.attendance_registers.day,
    status: row.status,
  }));
}

/**
 * The calendar, as attendance needs it: day → kind.
 *
 * `listCalendarDays()` in the academics module asks for `academics:view`,
 * which a teacher does not have — it guards the screen that *edits* the
 * calendar. Whether school is open today is a different question, and a
 * teacher has to be able to ask it before they can be told there is no
 * register to take. Same table, same RLS, honest gate (D-53).
 */
export async function attendanceCalendar(
  sessionLabel: string,
): Promise<Map<string, CalendarDayKind>> {
  await assertPermission("attendance:view");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("academic_calendar_days")
    .select("day, kind")
    .eq("session_label", sessionLabel)
    .returns<{ day: string; kind: CalendarDayKind }[]>();

  if (error) throw new Error(`Could not read the calendar: ${error.message}`);
  return new Map(data.map((row) => [row.day, row.kind]));
}

/** Which registers exist for a day — the office's "who has not taken it yet". */
export async function registersForDay(
  sessionLabel: string,
  day: string,
): Promise<Register[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_registers")
    .select(REGISTER_COLUMNS)
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .returns<RegisterRow[]>();

  if (error) throw new Error(`Could not read the registers: ${error.message}`);
  return data.map(toRegister);
}
