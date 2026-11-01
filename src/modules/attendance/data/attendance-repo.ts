import "server-only";
import { feesBridgeEnabled } from "@/platform/fees-bridge/policy";
import { retiredStudentLabels } from "@/platform/fees-bridge/history";

import { assertPermission, assertStaff } from "@/platform/auth/current-staff";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { CACHE_TAGS, sharedCache } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import type { CalendarDayKind } from "@/modules/academics/domain/calendar";
import {
  DEFAULT_ATTENDANCE_RULES,
  type AttendanceRules,
  type AttendanceStatus,
  type Register,
  type RollStudent,
  type SaveRegisterInput,
} from "@/modules/attendance/domain/attendance";
import type { CalendarNote } from "@/modules/attendance/domain/register-day";
import {
  toAttendanceReceipt,
  type AttendanceReceipt,
} from "@/modules/attendance/domain/attendance-receipt";

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

/**
 * Who was on a class's roll on one date — the roll a register is saved
 * against (P6).
 *
 * The rule is the database's (`vppsone.attendance_roster`), so the page and
 * the save cannot disagree about who belongs: a child admitted after the date
 * is not on it, one who left that day still is. Read through the service role
 * because the function is not exposed to staff; every caller has already
 * checked that this reader may see this class.
 */
export async function rosterOn(input: {
  classId: string;
  sessionLabel: string;
  day: string;
}): Promise<RollStudent[]> {
  await assertPermission("attendance:view");
  const admin = createAdminClient();

  const { data: ids, error } = await admin.rpc("attendance_roster", {
    p_session: input.sessionLabel,
    p_class: input.classId,
    p_day: input.day,
  });
  if (error) throw new Error(`Could not read the roll: ${error.message}`);

  const studentIds = ((ids ?? []) as string[]).filter(Boolean);
  if (studentIds.length === 0) return [];

  const [enrolments, students] = await Promise.all([
    fetchInChunks<{ student_id: string; roll_no: string | null }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin
        .from("enrolments")
        .select("student_id, roll_no")
        .eq("session_label", input.sessionLabel)
        .in("student_id", chunk),
    ),
    fetchInChunks<{ id: string; full_name: string; admission_no: string | null }>(
      studentIds,
      IN_FILTER_CHUNK_SIZE,
      (chunk) =>
        admin.schema(FEE_SCHEMA).from("students").select("id, full_name, admission_no").in("id", chunk),
    ),
  ]);
  if (enrolments.error) throw new Error("Could not read the roll numbers.");
  if (students.error) throw new Error("Could not read the students.");

  const rollNo = new Map(enrolments.data.map((row) => [row.student_id, row.roll_no]));
  const byId = new Map(students.data.map((row) => [row.id, row]));

  return studentIds.map((studentId) => ({
    studentId,
    fullName: byId.get(studentId)?.full_name ?? "—",
    admissionNo: byId.get(studentId)?.admission_no ?? null,
    rollNo: rollNo.get(studentId) ?? null,
  }));
}

/** Names for a handful of children, by id — for "who joined, who left". */
export async function studentNames(ids: string[]): Promise<Map<string, string>> {
  const wanted = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (wanted.length === 0) return new Map();
  const { data, error } = await fetchInChunks<{ id: string; full_name: string }>(
    wanted,
    IN_FILTER_CHUNK_SIZE,
    (chunk) => createAdminClient().schema(FEE_SCHEMA).from("students").select("id, full_name").in("id", chunk),
  );
  if (error) throw new Error("Could not read the students.");
  const names=new Map(data.map((row) => [row.id, row.full_name]));
  if(feesBridgeEnabled()){
    const retired=await retiredStudentLabels(wanted.filter(id=>!names.has(id)));
    for(const row of retired)names.set(row.id,row.full_name);
  }
  return names;
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
  revision: number;
};

const REGISTER_COLUMNS =
  "id, session_label, class_id, day, period, status, taken_by, on_behalf_of, submitted_at, revision";

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
  revision: row.revision,
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

/**
 * One register by id, under the reader's own RLS — so a register outside
 * their classes comes back as null, exactly as if it did not exist.
 */
export async function registerById(id: string): Promise<Register | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_registers")
    .select(REGISTER_COLUMNS)
    .eq("id", id)
    .maybeSingle<RegisterRow>();

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

/* ------------------------------------------------- saving, and receipts */

export type SaveOutcome =
  | { outcome: "saved"; receipt: AttendanceReceipt }
  | { outcome: "stale"; latest: AttendanceReceipt | null }
  | { outcome: "roster_changed"; missing: string[]; extra: string[] }
  | { outcome: "refused"; reason: string };

/**
 * Save or correct one daily register: one database command (P6).
 *
 * `save_attendance_register` checks the actor's authority again, the date,
 * the whole roll, the revision the page showed, and a correction's reason —
 * then writes the register, every mark, the revision with its before-and-after
 * and the receipt in one transaction. A repeated `commandId` returns the
 * first receipt. A fault anywhere leaves nothing written.
 */
export async function saveRegisterCommand(
  input: SaveRegisterInput & {
    sessionLabel: string;
    actorStaffId: string;
    payloadHash: string;
    correctionRequestId?: string | null;
    decisionNote?: string | null;
    fault?: "after_register" | "after_marks" | "before_receipt";
  },
): Promise<SaveOutcome> {
  const { data, error } = await createAdminClient().rpc("save_attendance_register", {
    p: {
      command_id: input.commandId,
      actor_staff_id: input.actorStaffId,
      session_label: input.sessionLabel,
      class_id: input.classId,
      day: input.day,
      kind: input.kind,
      expected_revision: input.expectedRevision,
      reason: input.reason,
      payload_hash: input.payloadHash,
      marks: input.marks.map((mark) => ({ student_id: mark.studentId, status: mark.status })),
      correction_request_id: input.correctionRequestId ?? null,
      decision_note: input.decisionNote ?? null,
      fault: input.fault ?? null,
    },
  });

  if (error) {
    const named = error.message.match(/attendance:([a-z_]+)/)?.[1];
    if (named === "request_not_pending") return { outcome: "refused", reason: named };
    throw new Error(`Could not save the register: ${error.message}`);
  }

  const row = data as Record<string, unknown>;
  if (row.ok === true) return { outcome: "saved", receipt: toAttendanceReceipt(row) };
  if (row.reason === "stale") {
    const latest = row.latest as Record<string, unknown> | null;
    return { outcome: "stale", latest: latest ? toAttendanceReceipt(latest) : null };
  }
  if (row.reason === "roster_changed") {
    return {
      outcome: "roster_changed",
      missing: (row.missing as string[]) ?? [],
      extra: (row.extra as string[]) ?? [],
    };
  }
  return { outcome: "refused", reason: String(row.reason ?? "failed") };
}

/**
 * Whether a save with this submission id landed, and its receipt if it did —
 * what the screen asks after an answer that never arrived. Only the actor's
 * own submissions are found.
 */
export async function findAttendanceCommand(
  commandId: string,
  actorStaffId: string,
): Promise<AttendanceReceipt | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attendance_register_revisions")
    .select("id")
    .eq("command_id", commandId)
    .eq("actor_staff_id", actorStaffId)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`Could not check the save: ${error.message}`);
  if (!data) return null;

  const { data: receipt, error: receiptError } = await admin.rpc("attendance_receipt", {
    p_revision: data.id,
  });
  if (receiptError) throw new Error(`Could not read the receipt: ${receiptError.message}`);
  return toAttendanceReceipt({ ...(receipt as Record<string, unknown>), replayed: true });
}

export type RegisterRevision = {
  revision: number;
  kind: "save" | "correction" | "imported";
  savedAt: string;
  actorName: string | null;
  reason: string | null;
  changes: { studentId: string; from: AttendanceStatus | null; to: AttendanceStatus }[];
};

/**
 * Every revision of a register, newest first, under the reader's own scope:
 * a register outside it has no history to show.
 */
export async function registerRevisions(registerId: string): Promise<RegisterRevision[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_register_revisions")
    .select("revision, kind, created_at, reason, changes, staff_profiles(display_name)")
    .eq("register_id", registerId)
    .order("revision", { ascending: false })
    .returns<
      {
        revision: number;
        kind: RegisterRevision["kind"];
        created_at: string;
        reason: string | null;
        changes: { student_id: string; from: AttendanceStatus | null; to: AttendanceStatus }[];
        staff_profiles: { display_name: string } | null;
      }[]
    >();

  if (error) throw new Error(`Could not read the register's history: ${error.message}`);
  return data.map((row) => ({
    revision: row.revision,
    kind: row.kind,
    savedAt: row.created_at,
    actorName: row.staff_profiles?.display_name ?? null,
    reason: row.reason,
    changes: (row.changes ?? []).map((change) => ({
      studentId: change.student_id,
      from: change.from,
      to: change.to,
    })),
  }));
}

/** The latest receipt of a register, for "Already saved by … at …". */
export async function latestReceipt(registerId: string): Promise<AttendanceReceipt | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attendance_register_revisions")
    .select("id")
    .eq("register_id", registerId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();
  if (error) throw new Error(`Could not read the receipt: ${error.message}`);
  if (!data) return null;
  const { data: receipt, error: receiptError } = await admin.rpc("attendance_receipt", {
    p_revision: data.id,
  });
  if (receiptError) throw new Error(`Could not read the receipt: ${receiptError.message}`);
  return toAttendanceReceipt(receipt as Record<string, unknown>);
}

/* ---------------------------------------------------------- the rules */

/** How this session counts a half day: the school's row, or the default. */
export async function attendanceRules(sessionLabel: string): Promise<AttendanceRules> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_rules")
    .select("half_day_credit")
    .eq("session_label", sessionLabel)
    .maybeSingle<{ half_day_credit: number | string }>();
  if (error) throw new Error(`Could not read the attendance rules: ${error.message}`);
  return data ? { halfDayCredit: Number(data.half_day_credit) } : DEFAULT_ATTENDANCE_RULES;
}

/** Change it. The caller has checked `academics:manage`. */
export async function saveAttendanceRules(input: {
  sessionLabel: string;
  halfDayCredit: number;
  actorStaffId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { data: current } = await admin
    .from("attendance_rules")
    .select("revision")
    .eq("session_label", input.sessionLabel)
    .maybeSingle<{ revision: number }>();
  const { error } = await admin.from("attendance_rules").upsert({
    session_label: input.sessionLabel,
    half_day_credit: input.halfDayCredit,
    revision: (current?.revision ?? 0) + 1,
    updated_by: input.actorStaffId,
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(`Could not save the attendance rules: ${error.message}`);
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
  return new Map(await cachedCalendarDays(sessionLabel));
}

/**
 * The same calendar for any active staff member — which days the school is
 * open — as RLS on `academic_calendar_days` always allowed. For the view-only
 * Today, whose reader has no `attendance:view` but still sees the bells and
 * who teaches now (admin B6).
 */
export async function schoolCalendar(
  sessionLabel: string,
): Promise<Map<string, CalendarDayKind>> {
  await assertStaff();
  return new Map(await cachedCalendarDays(sessionLabel));
}

/**
 * The read behind `attendanceCalendar`, shared across requests for five
 * minutes (perf fix 5). Every teacher's Today, register and Class screen and
 * the admin board read it, and the calendar changes a few times a term.
 * Service role inside the cache, the permission check outside it on every
 * request; every calendar-day write expires the tag (`class-teachers-repo`).
 * Entries, not a Map: the cache serialises to JSON.
 */
const cachedCalendarDays = sharedCache(
  async (sessionLabel: string): Promise<[string, CalendarDayKind][]> => {
    const { data, error } = await createAdminClient()
      .from("academic_calendar_days")
      .select("day, kind")
      .eq("session_label", sessionLabel)
      .returns<{ day: string; kind: CalendarDayKind }[]>();

    if (error) throw new Error(`Could not read the calendar: ${error.message}`);
    return data.map((row): [string, CalendarDayKind] => [row.day, row.kind]);
  },
  ["vx-attendance-calendar"],
  { tags: [CACHE_TAGS.calendar], revalidate: 300 },
);

/**
 * The calendar with each day's name ("Dussehra" / "दशहरा"), so a closed
 * register can say why it is closed instead of "closed or not come yet"
 * (20 Oct smoke run). Same table, gate and cache tag as `attendanceCalendar`.
 */
export async function attendanceCalendarNotes(
  sessionLabel: string,
): Promise<Map<string, CalendarNote>> {
  await assertPermission("attendance:view");
  return new Map(await cachedCalendarNotes(sessionLabel));
}

const cachedCalendarNotes = sharedCache(
  async (sessionLabel: string): Promise<[string, CalendarNote][]> => {
    const { data, error } = await createAdminClient()
      .from("academic_calendar_days")
      .select("day, kind, label_en, label_hi")
      .eq("session_label", sessionLabel)
      .returns<{ day: string; kind: CalendarDayKind; label_en: string | null; label_hi: string | null }[]>();

    if (error) throw new Error(`Could not read the calendar: ${error.message}`);
    return data.map((row): [string, CalendarNote] => [row.day, { kind: row.kind, en: row.label_en, hi: row.label_hi }]);
  },
  ["vx-attendance-calendar-notes"],
  { tags: [CACHE_TAGS.calendar], revalidate: 300 },
);

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
