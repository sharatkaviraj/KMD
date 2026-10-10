import "server-only";

import { cache } from "react";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { classScopeFor } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes, type ClassScope } from "@/modules/attendance/domain/class-scope";
import { schoolToday } from "@/vx/format";

import {
  addDays,
  attentionWeight,
  average,
  daysFrom,
  enteredPct,
  isSunday,
  lateTeachers,
  mondayOf,
  presentPct,
  tally,
  type AttentionFacts,
  type AttentionReason,
  type AttStatus,
  type LateTeacher,
  type PaperProgress,
  type Tally,
} from "./domain";

/*
 * Server reads for the coordinator's screens. Every loader takes the context,
 * whose `scope` is the reader's classes (all of them for the office and the
 * coordinators, her own for a teacher), and filters to it before anything is
 * returned — the service-role client is used for the roll-up views and fee
 * names, so the scope is applied here, in code, every time.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type ClassRef = { id: string; label: string; roll: number };

export type Ctx = {
  staff: CurrentStaff;
  session: string;
  today: string;
  scope: ClassScope;
  /** Classes in school order, in the reader's scope, with children on the roll. */
  classes: ClassRef[];
  label: (classId: string | null | undefined) => string;
  everyClass: boolean;
};

const enrolledRows = cache(async (session: string) => {
  return fetchAllRows<{ student_id: string; class_id: string; roll_no: string | null }>(
    (from, to) =>
      createAdminClient()
        .from("enrolments")
        .select("student_id, class_id, roll_no")
        .eq("session_label", session)
        .eq("status", "enrolled")
        .order("id")
        .range(from, to),
    "the roll",
  );
});

export async function academicContext(staff: CurrentStaff): Promise<Ctx | null> {
  const session = await resolveSessionLabel();
  if (!session) return null;
  const [labels, scope, enrolled] = await Promise.all([classLabelMap(session), classScopeFor(staff, session), enrolledRows(session)]);
  const roll = new Map<string, number>();
  for (const row of enrolled) roll.set(row.class_id, (roll.get(row.class_id) ?? 0) + 1);
  const classes = [...labels.entries()]
    .filter(([id]) => scopeIncludes(scope, id) && (roll.get(id) ?? 0) > 0)
    .map(([id, label]) => ({ id, label, roll: roll.get(id) ?? 0 }));
  return {
    staff,
    session,
    today: schoolToday(),
    scope,
    classes,
    label: (id) => (id ? labels.get(id) ?? "—" : "—"),
    everyClass: readsEveryClass(staff),
  };
}

/* ---------------------------------------------------------------- names */

export async function studentInfo(ids: string[]): Promise<Map<string, { name: string; father: string | null; phone: string | null; dob: string | null }>> {
  const wanted = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (wanted.length === 0) return new Map();
  const { data, error } = await fetchInChunks<{ id: string; full_name: string; father_name: string | null; primary_phone: string | null; date_of_birth: string | null }>(
    wanted,
    IN_FILTER_CHUNK_SIZE,
    (chunk) => createAdminClient().schema(FEE_SCHEMA).from("students").select("id, full_name, father_name, primary_phone, date_of_birth").in("id", chunk),
  );
  if (error) throw new Error("Could not read the students.");
  return new Map(data.map((row) => [row.id, { name: row.full_name, father: row.father_name, phone: row.primary_phone, dob: row.date_of_birth }]));
}

export const staffDirectory = cache(async () => {
  const { data, error } = await createAdminClient()
    .from("staff_profiles")
    .select("id, display_name, short_name, role, is_active, is_teaching, phone, whatsapp_phone")
    .returns<{ id: string; display_name: string; short_name: string | null; role: string; is_active: boolean; is_teaching: boolean; phone: string | null; whatsapp_phone: string | null }[]>();
  if (error) throw new Error(`Could not read the staff: ${error.message}`);
  return new Map(data.map((row) => [row.id, row]));
});

export async function staffName(id: string | null | undefined): Promise<string> {
  if (!id) return "—";
  return (await staffDirectory()).get(id)?.display_name ?? "—";
}

/** Who answers for each class's register on a day: the class teacher in effect, else the assistant. */
export async function classTeachersOn(session: string, day: string): Promise<Map<string, string>> {
  const { data, error } = await createAdminClient()
    .from("class_teachers")
    .select("class_id, staff_profile_id, role, effective_from, effective_to")
    .eq("session_label", session)
    .returns<{ class_id: string; staff_profile_id: string; role: string; effective_from: string | null; effective_to: string | null }[]>();
  if (error) throw new Error(`Could not read the class teachers: ${error.message}`);
  const by = new Map<string, { staff: string; role: string }>();
  for (const row of data) {
    if (row.effective_from && row.effective_from > day) continue;
    if (row.effective_to && row.effective_to < day) continue;
    const held = by.get(row.class_id);
    if (!held || (held.role !== "class_teacher" && row.role === "class_teacher")) by.set(row.class_id, { staff: row.staff_profile_id, role: row.role });
  }
  return new Map([...by].map(([classId, held]) => [classId, held.staff]));
}

/* ----------------------------------------------------------- attendance */

type TallyRow = {
  register_id: string;
  class_id: string;
  day: string;
  status: "open" | "submitted";
  submitted_at: string | null;
  taken_by: string | null;
  on_behalf_of: string | null;
  marked: number;
  present: number;
  absent: number;
  late: number;
  on_leave: number;
  half_day: number;
};

const TALLY_COLUMNS = "register_id, class_id, day, status, submitted_at, taken_by, on_behalf_of, marked, present, absent, late, on_leave, half_day";

const halfDayCredit = cache(async (session: string) => {
  const { data } = await createAdminClient().from("attendance_rules").select("half_day_credit").eq("session_label", session).maybeSingle<{ half_day_credit: number | null }>();
  return Number(data?.half_day_credit ?? 0.5);
});

function rowTally(row: TallyRow, credit: number): Tally {
  const counted = row.present + row.late + row.absent + row.half_day;
  return {
    present: row.present,
    absent: row.absent,
    late: row.late,
    leave: row.on_leave,
    halfDay: row.half_day,
    counted,
    credit: row.present + row.late + row.half_day * credit,
  };
}

async function tallies(ctx: Ctx, from: string, to: string): Promise<TallyRow[]> {
  const rows = await fetchAllRows<TallyRow>(
    (a, b) =>
      createAdminClient()
        .from("v_register_tally")
        .select(TALLY_COLUMNS)
        .eq("session_label", ctx.session)
        .gte("day", from)
        .lte("day", to)
        .order("register_id")
        .range(a, b),
    "the registers",
  );
  return rows.filter((row) => scopeIncludes(ctx.scope, row.class_id));
}

export type ClassToday = {
  classId: string;
  label: string;
  roll: number;
  teacherId: string | null;
  teacherName: string;
  teacherAway: boolean;
  registerId: string | null;
  saved: boolean;
  savedAt: string | null;
  savedBy: string | null;
  onBehalf: boolean;
  tally: Tally;
  pct: number | null;
};

export type DayAttendance = {
  day: string;
  classes: ClassToday[];
  marked: number;
  total: Tally;
  pct: number | null;
  notMarked: ClassToday[];
  /** Children on the roll of classes not yet marked. */
  unmarkedChildren: number;
  activity: { at: string; text: { en: string; hi: string }; tone: "ok" | "info" | "warn" }[];
  closed: { kind: string; label: string | null } | null;
};

export async function attendanceOn(ctx: Ctx, day: string): Promise<DayAttendance> {
  const [rows, teachers, staff, credit, away, closed] = await Promise.all([
    tallies(ctx, day, day),
    classTeachersOn(ctx.session, day),
    staffDirectory(),
    halfDayCredit(ctx.session),
    teachersAway(ctx.session, day),
    calendarDay(ctx.session, day),
  ]);
  const byClass = new Map(rows.map((row) => [row.class_id, row]));
  const classes: ClassToday[] = ctx.classes.map((c) => {
    const row = byClass.get(c.id);
    const teacherId = teachers.get(c.id) ?? null;
    const saved = row?.status === "submitted";
    const t = saved && row ? rowTally(row, credit) : tally([]);
    return {
      classId: c.id,
      label: c.label,
      roll: c.roll,
      teacherId,
      teacherName: teacherId ? staff.get(teacherId)?.display_name ?? "—" : "—",
      teacherAway: teacherId ? away.has(teacherId) : false,
      registerId: row?.register_id ?? null,
      saved,
      savedAt: saved ? row?.submitted_at ?? null : null,
      savedBy: saved && row?.taken_by ? staff.get(row.taken_by)?.display_name ?? null : null,
      onBehalf: saved && !!row?.on_behalf_of,
      tally: t,
      pct: saved ? presentPct(t) : null,
    };
  });
  const savedClasses = classes.filter((c) => c.saved);
  const total = savedClasses.reduce<Tally>((sum, c) => ({
    present: sum.present + c.tally.present,
    absent: sum.absent + c.tally.absent,
    late: sum.late + c.tally.late,
    leave: sum.leave + c.tally.leave,
    halfDay: sum.halfDay + c.tally.halfDay,
    counted: sum.counted + c.tally.counted,
    credit: sum.credit + c.tally.credit,
  }), tally([]));
  const notMarked = classes.filter((c) => !c.saved);
  const activity = savedClasses
    .filter((c) => c.savedAt)
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""))
    .slice(0, 6)
    .map((c) => ({
      at: c.savedAt!,
      tone: "ok" as const,
      text: {
        en: `${c.savedBy ?? "Someone"} saved ${c.label} · ${c.tally.present + c.tally.late} of ${c.roll} present`,
        hi: `${c.savedBy ?? "किसी ने"} ने ${c.label} सहेजा · ${c.roll} में ${c.tally.present + c.tally.late} उपस्थित`,
      },
    }));
  return {
    day,
    classes,
    marked: savedClasses.length,
    total,
    pct: presentPct(total),
    notMarked,
    unmarkedChildren: notMarked.reduce((s, c) => s + c.roll, 0),
    activity,
    closed,
  };
}

async function teachersAway(session: string, day: string): Promise<Set<string>> {
  const { data } = await createAdminClient()
    .from("teacher_absences")
    .select("staff_profile_id")
    .eq("session_label", session)
    .eq("day", day)
    .returns<{ staff_profile_id: string }[]>();
  return new Set((data ?? []).map((row) => row.staff_profile_id));
}

export async function calendarDay(session: string, day: string): Promise<{ kind: string; label: string | null } | null> {
  const { data } = await createAdminClient()
    .from("academic_calendar_days")
    .select("kind, label_en")
    .eq("session_label", session)
    .eq("day", day)
    .maybeSingle<{ kind: string; label_en: string | null }>();
  if (!data || data.kind === "instructional") return null;
  return { kind: data.kind, label: data.label_en };
}

export type MonthAttendance = {
  month: string;
  days: string[];
  /** classId → day → percent present (null when not saved). */
  grid: Map<string, Map<string, number | null>>;
  byDay: { day: string; pct: number | null }[];
  byClass: { classId: string; label: string; pct: number | null; daysSaved: number; daysOpen: number }[];
  average: number | null;
  closedDays: Set<string>;
};

export async function attendanceMonth(ctx: Ctx, month: string): Promise<MonthAttendance> {
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const end = last < ctx.today ? last : ctx.today;
  const [rows, credit, closed] = await Promise.all([tallies(ctx, first, end), halfDayCredit(ctx.session), closedDays(ctx.session, first, last)]);
  const schoolDays = end >= first ? daysFrom(first, end).filter((d) => !isSunday(d) && !closed.has(d)) : [];
  const grid = new Map<string, Map<string, number | null>>();
  const dayTotals = new Map<string, Tally>();
  for (const row of rows) {
    if (row.status !== "submitted") continue;
    const t = rowTally(row, credit);
    const m = grid.get(row.class_id) ?? new Map<string, number | null>();
    m.set(row.day, presentPct(t));
    grid.set(row.class_id, m);
    const d = dayTotals.get(row.day) ?? tally([]);
    dayTotals.set(row.day, { ...d, counted: d.counted + t.counted, credit: d.credit + t.credit, present: d.present + t.present, absent: d.absent + t.absent, late: d.late + t.late, leave: d.leave + t.leave, halfDay: d.halfDay + t.halfDay });
  }
  const byDay = schoolDays.map((day) => ({ day, pct: dayTotals.has(day) ? presentPct(dayTotals.get(day)!) : null }));
  const byClass = ctx.classes.map((c) => {
    const m = grid.get(c.id) ?? new Map();
    const values = [...m.values()].filter((v): v is number => v !== null);
    return {
      classId: c.id,
      label: c.label,
      pct: values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null,
      daysSaved: values.length,
      daysOpen: schoolDays.filter((d) => !m.has(d)).length,
    };
  });
  const all = [...dayTotals.values()].reduce<Tally>((s, t) => ({ ...s, counted: s.counted + t.counted, credit: s.credit + t.credit }), tally([]));
  return { month, days: schoolDays, grid, byDay, byClass, average: presentPct(all), closedDays: closed };
}

export async function closedDays(session: string, from: string, to: string): Promise<Set<string>> {
  const { data } = await createAdminClient()
    .from("academic_calendar_days")
    .select("day, kind")
    .eq("session_label", session)
    .gte("day", from)
    .lte("day", to)
    .in("kind", ["holiday", "vacation"])
    .returns<{ day: string; kind: string }[]>();
  return new Set((data ?? []).map((row) => row.day));
}

export type ChronicChild = {
  studentId: string;
  name: string;
  classId: string;
  classLabel: string;
  pct: number;
  absentDays: number;
  absentLastWeek: number;
  phone: string | null;
  father: string | null;
  lastCall: { outcome: string | null; at: string; by: string } | null;
};

/** Children below 75% this session (5+ days counted), lowest first. */
export async function chronicAbsentees(ctx: Ctx): Promise<ChronicChild[]> {
  const rows = await fetchAllRows<{ student_id: string; days_counted: number; absent_days: number; absent_last_week: number; attendance_pct: number | null }>(
    (a, b) =>
      createAdminClient()
        .from("v_student_attendance")
        .select("student_id, days_counted, absent_days, absent_last_week, attendance_pct")
        .eq("session_label", ctx.session)
        .lt("attendance_pct", 75)
        .gte("days_counted", 5)
        .order("student_id")
        .range(a, b),
    "attendance",
  );
  const enrolled = new Map((await enrolledRows(ctx.session)).map((row) => [row.student_id, row.class_id]));
  const inScope = rows.filter((row) => scopeIncludes(ctx.scope, enrolled.get(row.student_id)));
  const ids = inScope.map((row) => row.student_id);
  const [info, calls] = await Promise.all([studentInfo(ids), latestFollowups(ctx, ids, "call")]);
  return inScope
    .map((row) => {
      const classId = enrolled.get(row.student_id)!;
      const i = info.get(row.student_id);
      return {
        studentId: row.student_id,
        name: i?.name ?? "—",
        classId,
        classLabel: ctx.label(classId),
        pct: Number(row.attendance_pct),
        absentDays: row.absent_days,
        absentLastWeek: row.absent_last_week,
        phone: ctx.everyClass ? i?.phone ?? null : null,
        father: i?.father ?? null,
        lastCall: calls.get(row.student_id) ?? null,
      };
    })
    .sort((a, b) => a.pct - b.pct);
}

export async function latestFollowups(ctx: Ctx, studentIds: string[], kind?: "call" | "improving" | "follow_up"): Promise<Map<string, { kind: string; outcome: string | null; at: string; by: string; note: string | null }>> {
  if (studentIds.length === 0) return new Map();
  const { data, error } = await fetchInChunks<{ student_id: string; kind: string; outcome: string | null; note: string | null; created_at: string; created_by: string }>(
    studentIds,
    IN_FILTER_CHUNK_SIZE,
    (chunk) => {
      let q = createAdminClient().from("student_followups").select("student_id, kind, outcome, note, created_at, created_by").eq("session_label", ctx.session).in("student_id", chunk);
      if (kind) q = q.eq("kind", kind);
      return q.order("created_at", { ascending: false });
    },
  );
  if (error) return new Map();
  const staff = await staffDirectory();
  const out = new Map<string, { kind: string; outcome: string | null; at: string; by: string; note: string | null }>();
  for (const row of data) {
    if (out.has(row.student_id)) continue;
    out.set(row.student_id, { kind: row.kind, outcome: row.outcome, at: row.created_at, by: staff.get(row.created_by)?.display_name ?? "—", note: row.note });
  }
  return out;
}

export type RegisterSheet = {
  classId: string;
  label: string;
  month: string;
  days: string[];
  students: { studentId: string; name: string; rollNo: string | null; marks: Map<string, AttStatus>; pct: number | null }[];
  savedDays: number;
};

/** One class's month: a dot for every child, every day. */
export async function registerSheet(ctx: Ctx, classId: string, month: string): Promise<RegisterSheet | null> {
  if (!scopeIncludes(ctx.scope, classId)) return null;
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const end = last < ctx.today ? last : ctx.today;
  const admin = createAdminClient();
  const [registers, closed, credit] = await Promise.all([
    admin
      .from("attendance_registers")
      .select("id, day")
      .eq("session_label", ctx.session)
      .eq("class_id", classId)
      .is("period", null)
      .eq("status", "submitted")
      .gte("day", first)
      .lte("day", end)
      .returns<{ id: string; day: string }[]>(),
    closedDays(ctx.session, first, last),
    halfDayCredit(ctx.session),
  ]);
  const regs = registers.data ?? [];
  const dayOf = new Map(regs.map((r) => [r.id, r.day]));
  const marks = regs.length
    ? (
        await fetchInChunks<{ register_id: string; student_id: string; status: AttStatus }>(regs.map((r) => r.id), IN_FILTER_CHUNK_SIZE, (chunk) =>
          admin.from("attendance_marks").select("register_id, student_id, status").in("register_id", chunk),
        )
      ).data
    : [];
  const roll = (await enrolledRows(ctx.session)).filter((row) => row.class_id === classId);
  const info = await studentInfo(roll.map((r) => r.student_id));
  const byStudent = new Map<string, Map<string, AttStatus>>();
  for (const m of marks) {
    const day = dayOf.get(m.register_id);
    if (!day) continue;
    const s = byStudent.get(m.student_id) ?? new Map<string, AttStatus>();
    s.set(day, m.status);
    byStudent.set(m.student_id, s);
  }
  const days = end >= first ? daysFrom(first, end).filter((d) => !isSunday(d) && !closed.has(d)) : [];
  const students = roll
    .map((r) => {
      const ms = byStudent.get(r.student_id) ?? new Map<string, AttStatus>();
      return {
        studentId: r.student_id,
        name: info.get(r.student_id)?.name ?? "—",
        rollNo: r.roll_no,
        marks: ms,
        pct: presentPct(tally(ms.values(), credit)),
      };
    })
    .sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999) || a.name.localeCompare(b.name));
  return { classId, label: ctx.label(classId), month, days, students, savedDays: regs.length };
}

/** The roll a register is marked against, with today's marks if any. */
export async function markSheet(ctx: Ctx, classId: string, day: string) {
  if (!scopeIncludes(ctx.scope, classId)) return null;
  const admin = createAdminClient();
  const { data: register } = await admin
    .from("attendance_registers")
    .select("id, revision, status")
    .eq("session_label", ctx.session)
    .eq("class_id", classId)
    .eq("day", day)
    .is("period", null)
    .maybeSingle<{ id: string; revision: number; status: string }>();
  const { data: ids } = await admin.rpc("attendance_roster", { p_session: ctx.session, p_class: classId, p_day: day });
  const studentIds = ((ids ?? []) as string[]).filter(Boolean);
  const [info, marks] = await Promise.all([
    studentInfo(studentIds),
    register
      ? admin.from("attendance_marks").select("student_id, status").eq("register_id", register.id).returns<{ student_id: string; status: AttStatus }[]>()
      : Promise.resolve({ data: [] as { student_id: string; status: AttStatus }[] }),
  ]);
  const rollNo = new Map((await enrolledRows(ctx.session)).map((r) => [r.student_id, r.roll_no]));
  const current = new Map((marks.data ?? []).map((m) => [m.student_id, m.status]));
  return {
    classId,
    label: ctx.label(classId),
    day,
    revision: register?.revision ?? 0,
    saved: register?.status === "submitted",
    students: studentIds
      .map((id) => ({ studentId: id, name: info.get(id)?.name ?? "—", rollNo: rollNo.get(id) ?? null, status: current.get(id) ?? null }))
      .sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999) || a.name.localeCompare(b.name)),
  };
}

/* ---------------------------------------------------------------- marks */

export type Exam = { id: string; code: string; label: string; labelHi: string | null; startsOn: string; endsOn: string | null; status: string };

export const examsOf = cache(async (session: string): Promise<Exam[]> => {
  const { data, error } = await createAdminClient()
    .from("assessments")
    .select("id, code, label_en, label_hi, starts_on, ends_on, status")
    .eq("session_label", session)
    .not("starts_on", "is", null)
    .neq("status", "draft")
    .order("starts_on")
    .returns<{ id: string; code: string; label_en: string; label_hi: string | null; starts_on: string; ends_on: string | null; status: string }[]>();
  if (error) throw new Error(`Could not read the exams: ${error.message}`);
  return data.map((row) => ({ id: row.id, code: row.code, label: row.label_en, labelHi: row.label_hi, startsOn: row.starts_on, endsOn: row.ends_on, status: row.status }));
});

export type PaperStat = {
  paperId: string;
  examId: string;
  classId: string;
  subjectId: string;
  subject: string;
  maxMarks: number;
  entered: number;
  scored: number;
  avgPct: number | null;
  passed: number;
  submitted: boolean;
  sortOrder: number;
};

export async function paperStats(ctx: Ctx, examIds: string[]): Promise<PaperStat[]> {
  if (examIds.length === 0) return [];
  const rows = await fetchAllRows<{ paper_id: string; assessment_id: string; class_id: string; subject_id: string; subject_code: string; max_marks: number; entered: number; scored: number; avg_pct: number | null; passed: number; entry_status: string; sort_order: number }>(
    (a, b) =>
      createAdminClient()
        .from("v_paper_stats")
        .select("paper_id, assessment_id, class_id, subject_id, subject_code, max_marks, entered, scored, avg_pct, passed, entry_status, sort_order")
        .in("assessment_id", examIds)
        .order("paper_id")
        .range(a, b),
    "the papers",
  );
  return rows
    .filter((row) => scopeIncludes(ctx.scope, row.class_id))
    .map((row) => ({
      paperId: row.paper_id,
      examId: row.assessment_id,
      classId: row.class_id,
      subjectId: row.subject_id,
      subject: row.subject_code,
      maxMarks: Number(row.max_marks),
      entered: row.entered,
      scored: row.scored,
      avgPct: row.avg_pct === null ? null : Number(row.avg_pct),
      passed: row.passed,
      submitted: row.entry_status === "submitted",
      sortOrder: row.sort_order,
    }));
}

/** The exam whose marks are being entered now: the latest that has started. */
export function currentExam(exams: Exam[], today: string): { current: Exam | null; previous: Exam | null } {
  const started = exams.filter((e) => e.startsOn <= today);
  const current = started[started.length - 1] ?? exams[0] ?? null;
  const idx = current ? exams.indexOf(current) : -1;
  return { current, previous: idx > 0 ? exams[idx - 1] : null };
}

export type MarksEntry = {
  exam: Exam | null;
  pct: number;
  papers: PaperProgress[];
  late: (LateTeacher & { name: string })[];
  byClass: { classId: string; label: string; pct: number; done: number; total: number }[];
};

/** The marks-entry tracker for the current exam, with the teachers behind. */
export async function marksEntry(ctx: Ctx, examId?: string): Promise<MarksEntry> {
  const exams = await examsOf(ctx.session);
  const exam = (examId && exams.find((e) => e.id === examId)) || currentExam(exams, ctx.today).current;
  if (!exam) return { exam: null, pct: 0, papers: [], late: [], byClass: [] };
  const [stats, assignments, staff, teachers] = await Promise.all([
    paperStats(ctx, [exam.id]),
    createAdminClient()
      .from("teaching_assignments")
      .select("class_id, subject_id, staff_profile_id")
      .eq("session_label", ctx.session)
      .returns<{ class_id: string; subject_id: string; staff_profile_id: string }[]>(),
    staffDirectory(),
    classTeachersOn(ctx.session, ctx.today),
  ]);
  const subjectTeacher = new Map((assignments.data ?? []).map((row) => [`${row.class_id}|${row.subject_id}`, row.staff_profile_id]));
  const rollOf = new Map(ctx.classes.map((c) => [c.id, c.roll]));
  const papers: PaperProgress[] = stats.map((s) => ({
    paperId: s.paperId,
    classId: s.classId,
    classLabel: ctx.label(s.classId),
    subject: s.subject,
    entered: s.entered,
    roll: rollOf.get(s.classId) ?? 0,
    submitted: s.submitted,
    teacherId: subjectTeacher.get(`${s.classId}|${s.subjectId}`) ?? teachers.get(s.classId) ?? null,
  }));
  const late = lateTeachers(papers).map((t) => ({ ...t, name: staff.get(t.teacherId)?.display_name ?? "—" }));
  const byClass = ctx.classes
    .map((c) => {
      const mine = papers.filter((p) => p.classId === c.id);
      return { classId: c.id, label: c.label, pct: enteredPct(mine), done: mine.filter((p) => p.submitted).length, total: mine.length };
    })
    .filter((c) => c.total > 0);
  return { exam, pct: enteredPct(papers), papers, late, byClass };
}

export type ClassResult = { classId: string; label: string; avg: number | null; before: number | null; pass: number | null; attendance: number | null };

/** Every class's average, pass rate and attendance for one exam, with the previous exam's average. */
export async function classResults(ctx: Ctx, exam: Exam, previous: Exam | null): Promise<{ classes: ClassResult[]; stats: PaperStat[]; prevStats: PaperStat[]; studentPass: number | null; lowest: ClassResult | null }> {
  const [stats, students, att] = await Promise.all([
    paperStats(ctx, previous ? [exam.id, previous.id] : [exam.id]),
    studentExams(ctx, [exam.id]),
    studentAttendance(ctx),
  ]);
  const now = stats.filter((s) => s.examId === exam.id);
  const before = previous ? stats.filter((s) => s.examId === previous.id) : [];
  const enrolled = await enrolledRows(ctx.session);
  const classes = ctx.classes.map((c) => {
    const mine = now.filter((s) => s.classId === c.id && s.scored > 0);
    const prev = before.filter((s) => s.classId === c.id && s.scored > 0);
    const kids = students.filter((s) => s.classId === c.id);
    const roll = enrolled.filter((e) => e.class_id === c.id).map((e) => e.student_id);
    const attVals = roll.map((id) => att.get(id)?.pct).filter((v): v is number => typeof v === "number");
    return {
      classId: c.id,
      label: c.label,
      avg: weightedAvg(mine),
      before: weightedAvg(prev),
      pass: kids.length ? Math.round((kids.filter((k) => k.failed === 0).length / kids.length) * 100) : null,
      attendance: attVals.length ? Math.round(attVals.reduce((s, v) => s + v, 0) / attVals.length) : null,
    };
  });
  const passVals = students.length ? Math.round((students.filter((k) => k.failed === 0).length / students.length) * 100) : null;
  const withPass = classes.filter((c) => c.pass !== null);
  const lowest = withPass.length ? withPass.reduce((a, b) => ((a.pass ?? 101) <= (b.pass ?? 101) ? a : b)) : null;
  return { classes, stats: now, prevStats: before, studentPass: passVals, lowest };
}

export function weightedAvg(stats: Pick<PaperStat, "avgPct" | "scored">[]): number | null {
  let n = 0;
  let sum = 0;
  for (const s of stats) {
    if (s.avgPct === null || !s.scored) continue;
    n += s.scored;
    sum += s.avgPct * s.scored;
  }
  return n ? Math.round(sum / n) : null;
}

export async function studentExams(ctx: Ctx, examIds: string[]): Promise<{ studentId: string; examId: string; classId: string; avg: number; papers: number; failed: number }[]> {
  if (examIds.length === 0) return [];
  const rows = await fetchAllRows<{ student_id: string; assessment_id: string; class_id: string; avg_pct: number; papers: number; failed: number }>(
    (a, b) =>
      createAdminClient()
        .from("v_student_exam")
        .select("student_id, assessment_id, class_id, avg_pct, papers, failed")
        .in("assessment_id", examIds)
        .order("student_id")
        .order("assessment_id")
        .range(a, b),
    "the results",
  );
  return rows
    .filter((row) => scopeIncludes(ctx.scope, row.class_id))
    .map((row) => ({ studentId: row.student_id, examId: row.assessment_id, classId: row.class_id, avg: Number(row.avg_pct), papers: row.papers, failed: row.failed }));
}

export const studentAttendance = cache(async (ctx: Ctx): Promise<Map<string, { pct: number | null; absent: number; counted: number }>> => {
  const rows = await fetchAllRows<{ student_id: string; attendance_pct: number | null; absent_days: number; days_counted: number }>(
    (a, b) =>
      createAdminClient()
        .from("v_student_attendance")
        .select("student_id, attendance_pct, absent_days, days_counted")
        .eq("session_label", ctx.session)
        .order("student_id")
        .range(a, b),
    "attendance",
  );
  return new Map(rows.map((row) => [row.student_id, { pct: row.attendance_pct === null ? null : Number(row.attendance_pct), absent: row.absent_days, counted: row.days_counted }]));
});

/* ------------------------------------------------------ needs attention */

export type AttentionChild = AttentionFacts & {
  studentId: string;
  name: string;
  classId: string;
  classLabel: string;
  followup: { kind: string; outcome: string | null; at: string; by: string; note: string | null } | null;
  plan: string | null;
};

export async function needsAttention(ctx: Ctx): Promise<AttentionChild[]> {
  const { data, error } = await createAdminClient()
    .from("v_needs_attention")
    .select("student_id, class_id, attendance_pct, below_33_subjects, drop_points, drop_subject, open_notes, reasons")
    .eq("session_label", ctx.session)
    .limit(2000)
    .returns<{ student_id: string; class_id: string; attendance_pct: number | null; below_33_subjects: string[]; drop_points: number | null; drop_subject: string | null; open_notes: number; reasons: AttentionReason[] }[]>();
  if (error) throw new Error(`Could not read the attention list: ${error.message}`);
  const rows = data.filter((row) => scopeIncludes(ctx.scope, row.class_id));
  const ids = rows.map((row) => row.student_id);
  const [info, follow, plans] = await Promise.all([studentInfo(ids), latestFollowups(ctx, ids), planStatus(ctx, ids)]);
  return rows
    .map((row) => ({
      studentId: row.student_id,
      name: info.get(row.student_id)?.name ?? "—",
      classId: row.class_id,
      classLabel: ctx.label(row.class_id),
      reasons: row.reasons,
      attendancePct: row.attendance_pct === null ? null : Number(row.attendance_pct),
      below33Subjects: row.below_33_subjects ?? [],
      dropPoints: row.drop_points === null ? null : Number(row.drop_points),
      dropSubject: row.drop_subject,
      openNotes: row.open_notes,
      followup: follow.get(row.student_id) ?? null,
      plan: plans.get(row.student_id) ?? null,
    }))
    .sort((a, b) => attentionWeight(b) - attentionWeight(a) || a.name.localeCompare(b.name));
}

async function planStatus(ctx: Ctx, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await fetchInChunks<{ student_id: string; status: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
    createAdminClient().from("support_plans").select("student_id, status").eq("session_label", ctx.session).in("student_id", chunk).in("status", ["draft", "active"]),
  );
  return new Map(data.map((row) => [row.student_id, row.status]));
}

/* ---------------------------------------------------------------- notes */

export async function notesNeedingAction(ctx: Ctx): Promise<{ open: number; due: number; dueOn: string | null; recent: { id: string; studentId: string | null; body: string; at: string; by: string }[] }> {
  const { data } = await createAdminClient()
    .from("notes")
    .select("id, student_id, class_id, body, created_at, written_by, needs_follow_up, follow_up_on, status, visibility")
    .eq("session_label", ctx.session)
    .in("status", ["open", "working"])
    .eq("needs_follow_up", true)
    .neq("visibility", "private")
    .order("follow_up_on", { ascending: true })
    .limit(200)
    .returns<{ id: string; student_id: string | null; class_id: string | null; body: string; created_at: string; written_by: string; needs_follow_up: boolean; follow_up_on: string | null; status: string; visibility: string }[]>();
  const rows = (data ?? []).filter((row) => !row.class_id || scopeIncludes(ctx.scope, row.class_id));
  const nextWeek = addDays(ctx.today, 7);
  const due = rows.filter((row) => row.follow_up_on && row.follow_up_on <= nextWeek);
  const staff = await staffDirectory();
  return {
    open: rows.length,
    due: due.length,
    dueOn: due[0]?.follow_up_on ?? null,
    recent: rows.slice(0, 5).map((row) => ({ id: row.id, studentId: row.student_id, body: row.body, at: row.created_at, by: staff.get(row.written_by)?.display_name ?? "—" })),
  };
}

/* ---------------------------------------------------------- one child */

export type StudentDetail = {
  studentId: string;
  name: string;
  father: string | null;
  phone: string | null;
  classId: string;
  classLabel: string;
  rollNo: string | null;
  attendance: { pct: number | null; absent: number; counted: number };
  months: { month: string; pct: number | null }[];
  subjects: { subject: string; byExam: Map<string, number | null> }[];
  exams: Exam[];
  notes: { id: string; body: string; kind: string; tone: string; at: string; by: string; status: string }[];
  plan: Plan | null;
  followups: { kind: string; outcome: string | null; note: string | null; at: string; by: string }[];
  facts: AttentionFacts | null;
};

export type Plan = { id: string; goal: string | null; status: string; startedAt: string | null; steps: { id: string; text: string; owner: string | null; ownerId: string | null; due: string | null; done: boolean }[] };

export async function studentDetail(ctx: Ctx, studentId: string): Promise<StudentDetail | null> {
  const enrolled = (await enrolledRows(ctx.session)).find((row) => row.student_id === studentId);
  if (!enrolled || !scopeIncludes(ctx.scope, enrolled.class_id)) return null;
  const admin = createAdminClient();
  const exams = await examsOf(ctx.session);
  const [info, marks, attendance, notes, plan, follow, staff, attention] = await Promise.all([
    studentInfo([studentId]),
    admin
      .from("marks")
      .select("value, absent, exempt, assessment_subjects!inner(assessment_id, subject_code, max_marks, class_id)")
      .eq("student_id", studentId)
      .returns<{ value: number | null; absent: boolean; exempt: boolean; assessment_subjects: { assessment_id: string; subject_code: string; max_marks: number; class_id: string } }[]>(),
    studentMonths(ctx, studentId),
    can(ctx.staff, "notes:view")
      ? admin
          .from("notes")
          .select("id, body, created_at, written_by, status, visibility, note_kinds!inner(label_en, tone)")
          .eq("student_id", studentId)
          .neq("visibility", "private")
          .order("created_at", { ascending: false })
          .limit(20)
          .returns<{ id: string; body: string; created_at: string; written_by: string; status: string; visibility: string; note_kinds: { label_en: string; tone: string } }[]>()
      : Promise.resolve({ data: [] }),
    planFor(ctx, studentId),
    admin
      .from("student_followups")
      .select("kind, outcome, note, created_at, created_by")
      .eq("session_label", ctx.session)
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(10)
      .returns<{ kind: string; outcome: string | null; note: string | null; created_at: string; created_by: string }[]>(),
    staffDirectory(),
    admin
      .from("v_needs_attention")
      .select("attendance_pct, below_33_subjects, drop_points, drop_subject, open_notes, reasons")
      .eq("session_label", ctx.session)
      .eq("student_id", studentId)
      .maybeSingle<{ attendance_pct: number | null; below_33_subjects: string[]; drop_points: number | null; drop_subject: string | null; open_notes: number; reasons: AttentionReason[] }>(),
  ]);
  const examIds = new Set(exams.map((e) => e.id));
  const subjects = new Map<string, Map<string, number | null>>();
  for (const m of marks.data ?? []) {
    const p = m.assessment_subjects;
    if (!examIds.has(p.assessment_id)) continue;
    const byExam = subjects.get(p.subject_code) ?? new Map<string, number | null>();
    byExam.set(p.assessment_id, m.value === null ? null : Math.round((Number(m.value) / Number(p.max_marks)) * 100));
    subjects.set(p.subject_code, byExam);
  }
  const att = (await studentAttendance(ctx)).get(studentId) ?? { pct: null, absent: 0, counted: 0 };
  const i = info.get(studentId);
  const a = attention.data;
  return {
    studentId,
    name: i?.name ?? "—",
    father: i?.father ?? null,
    phone: ctx.everyClass ? i?.phone ?? null : null,
    classId: enrolled.class_id,
    classLabel: ctx.label(enrolled.class_id),
    rollNo: enrolled.roll_no,
    attendance: att,
    months: attendance,
    subjects: [...subjects.entries()].map(([subject, byExam]) => ({ subject, byExam })),
    exams,
    notes: (notes.data ?? []).map((n) => ({ id: n.id, body: n.body, kind: n.note_kinds.label_en, tone: n.note_kinds.tone, at: n.created_at, by: staff.get(n.written_by)?.display_name ?? "—", status: n.status })),
    plan,
    followups: (follow.data ?? []).map((f) => ({ kind: f.kind, outcome: f.outcome, note: f.note, at: f.created_at, by: staff.get(f.created_by)?.display_name ?? "—" })),
    facts: a
      ? {
          reasons: a.reasons,
          attendancePct: a.attendance_pct === null ? null : Number(a.attendance_pct),
          below33Subjects: a.below_33_subjects ?? [],
          dropPoints: a.drop_points === null ? null : Number(a.drop_points),
          dropSubject: a.drop_subject,
          openNotes: a.open_notes,
        }
      : null,
  };
}

async function studentMonths(ctx: Ctx, studentId: string): Promise<{ month: string; pct: number | null }[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("attendance_marks")
    .select("status, attendance_registers!inner(day, session_label, status, period)")
    .eq("student_id", studentId)
    .eq("attendance_registers.session_label", ctx.session)
    .eq("attendance_registers.status", "submitted")
    .is("attendance_registers.period", null)
    .limit(400)
    .returns<{ status: AttStatus; attendance_registers: { day: string } }[]>();
  const credit = await halfDayCredit(ctx.session);
  const by = new Map<string, AttStatus[]>();
  for (const row of data ?? []) {
    const month = row.attendance_registers.day.slice(0, 7);
    const list = by.get(month) ?? [];
    list.push(row.status);
    by.set(month, list);
  }
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, list]) => ({ month, pct: presentPct(tally(list, credit)) }));
}

export async function planFor(ctx: Ctx, studentId: string): Promise<Plan | null> {
  const admin = createAdminClient();
  const { data: plan } = await admin
    .from("support_plans")
    .select("id, goal, status, started_at")
    .eq("session_label", ctx.session)
    .eq("student_id", studentId)
    .in("status", ["draft", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; goal: string | null; status: string; started_at: string | null }>();
  if (!plan) return null;
  const [{ data: steps }, staff] = await Promise.all([
    admin
      .from("support_plan_steps")
      .select("id, text, owner_staff_id, due_label, done_at, sort_order")
      .eq("plan_id", plan.id)
      .is("removed_at", null)
      .order("sort_order")
      .returns<{ id: string; text: string; owner_staff_id: string | null; due_label: string | null; done_at: string | null; sort_order: number }[]>(),
    staffDirectory(),
  ]);
  return {
    id: plan.id,
    goal: plan.goal,
    status: plan.status,
    startedAt: plan.started_at,
    steps: (steps ?? []).map((s) => ({ id: s.id, text: s.text, ownerId: s.owner_staff_id, owner: s.owner_staff_id ? staff.get(s.owner_staff_id)?.display_name ?? null : null, due: s.due_label, done: !!s.done_at })),
  };
}

/** One class in depth: each child's average, the previous exam's, attendance and whether they are on the list. */
export async function classDetail(ctx: Ctx, classId: string, exam: Exam, previous: Exam | null) {
  if (!scopeIncludes(ctx.scope, classId)) return null;
  const [results, stats, att, attention] = await Promise.all([
    studentExams(ctx, previous ? [exam.id, previous.id] : [exam.id]),
    paperStats(ctx, previous ? [exam.id, previous.id] : [exam.id]),
    studentAttendance(ctx),
    needsAttention(ctx),
  ]);
  const roll = (await enrolledRows(ctx.session)).filter((r) => r.class_id === classId);
  const info = await studentInfo(roll.map((r) => r.student_id));
  const flagged = new Map(attention.filter((a) => a.classId === classId).map((a) => [a.studentId, a]));
  const students = roll
    .map((r) => {
      const now = results.find((x) => x.studentId === r.student_id && x.examId === exam.id);
      const before = previous ? results.find((x) => x.studentId === r.student_id && x.examId === previous.id) : undefined;
      return {
        studentId: r.student_id,
        name: info.get(r.student_id)?.name ?? "—",
        rollNo: r.roll_no,
        avg: now ? Math.round(now.avg) : null,
        before: before ? Math.round(before.avg) : null,
        failed: now?.failed ?? 0,
        attendance: att.get(r.student_id)?.pct ?? null,
        attention: flagged.get(r.student_id) ?? null,
      };
    })
    .sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));
  const subjects = stats
    .filter((s) => s.classId === classId && s.examId === exam.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => {
      const prev = stats.find((p) => p.classId === classId && p.examId === previous?.id && p.subjectId === s.subjectId);
      return { subject: s.subject, avg: s.avgPct === null ? null : Math.round(s.avgPct), before: prev?.avgPct == null ? null : Math.round(prev.avgPct), pass: s.scored ? Math.round((s.passed / s.scored) * 100) : null, entered: s.entered, submitted: s.submitted };
    });
  const avgs = students.map((s) => s.avg).filter((v): v is number => v !== null);
  return {
    classId,
    label: ctx.label(classId),
    roll: roll.length,
    average: average(avgs),
    pass: students.filter((s) => s.avg !== null).length ? Math.round((students.filter((s) => s.avg !== null && s.failed === 0).length / students.filter((s) => s.avg !== null).length) * 100) : null,
    attendance: average(students.map((s) => s.attendance).filter((v): v is number => v !== null)),
    students,
    subjects,
  };
}

/* ------------------------------------------------------- the week */

export async function weekFacts(ctx: Ctx) {
  const monday = mondayOf(ctx.today);
  const prevMonday = addDays(monday, -7);
  const [rows, credit, entry, attention, notes, corrections] = await Promise.all([
    tallies(ctx, prevMonday, ctx.today),
    halfDayCredit(ctx.session),
    marksEntry(ctx),
    needsAttention(ctx),
    notesNeedingAction(ctx),
    createAdminClient()
      .from("attendance_corrections")
      .select("id", { count: "exact", head: true })
      .gte("decided_at", `${monday}T00:00:00+05:30`),
  ]);
  const sum = (from: string, to: string) =>
    rows.filter((r) => r.status === "submitted" && r.day >= from && r.day <= to).reduce<Tally>((s, r) => {
      const t = rowTally(r, credit);
      return { ...s, counted: s.counted + t.counted, credit: s.credit + t.credit };
    }, tally([]));
  const thisWeek = sum(monday, ctx.today);
  const lastWeek = sum(prevMonday, addDays(monday, -1));
  const days = new Set(rows.filter((r) => r.day >= monday).map((r) => r.day));
  const always = ctx.classes.filter((c) => [...days].every((d) => rows.some((r) => r.class_id === c.id && r.day === d && r.status === "submitted"))).length;
  const daily = daysFrom(monday, ctx.today)
    .filter((d) => !isSunday(d))
    .map((d) => ({ day: d, pct: presentPct(sum(d, d)) }));
  const weekStart = `${monday}T00:00:00+05:30`;
  const fresh = attention.filter((a) => a.followup === null || a.followup.at >= weekStart).length;
  return {
    monday,
    daily,
    facts: {
      coordinator: ctx.staff.displayName,
      weekLabel: monday,
      attendancePct: presentPct(thisWeek),
      attendanceBefore: presentPct(lastWeek),
      classesAlwaysMarked: always,
      classes: ctx.classes.length,
      marksPct: entry.pct,
      lateTeachers: entry.late.length,
      attention: attention.length,
      attentionNew: Math.min(fresh, attention.length),
      notesOpen: notes.open,
      correctionsDecided: corrections.count ?? 0,
    },
    entry,
    attention,
  };
}

/* ------------------------------------------------------- coming up */

export type UpcomingEvent = { id: string; kind: string; title: string; titleHi: string | null; startsOn: string; endsOn: string; startsAt: string | null; place: string | null };

export async function upcomingEvents(session: string, from: string, days: number, admin: Admin = createAdminClient()): Promise<UpcomingEvent[]> {
  const to = addDays(from, days);
  const [{ data: events }, { data: holidays }] = await Promise.all([
    admin
      .from("calendar_events")
      .select("id, kind, title, title_hi, starts_on, ends_on, starts_at, place")
      .eq("session_label", session)
      .is("cancelled_at", null)
      .lte("starts_on", to)
      .gte("ends_on", from)
      .order("starts_on")
      .returns<{ id: string; kind: string; title: string; title_hi: string | null; starts_on: string; ends_on: string; starts_at: string | null; place: string | null }[]>(),
    admin
      .from("academic_calendar_days")
      .select("id, day, kind, label_en, label_hi")
      .eq("session_label", session)
      .gte("day", from)
      .lte("day", to)
      .in("kind", ["holiday", "vacation"])
      .order("day")
      .returns<{ id: string; day: string; kind: string; label_en: string | null; label_hi: string | null }[]>(),
  ]);
  const list: UpcomingEvent[] = [
    ...(events ?? []).map((e) => ({ id: e.id, kind: e.kind, title: e.title, titleHi: e.title_hi, startsOn: e.starts_on, endsOn: e.ends_on, startsAt: e.starts_at, place: e.place })),
    ...(holidays ?? []).map((h) => ({ id: `day:${h.day}`, kind: "holiday", title: h.label_en ?? "Holiday", titleHi: h.label_hi, startsOn: h.day, endsOn: h.day, startsAt: null, place: null })),
  ];
  return list.sort((a, b) => a.startsOn.localeCompare(b.startsOn) || (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
}

/** Pending attendance change requests for the badge. */
export async function pendingCorrections(ctx: Ctx): Promise<number> {
  const { data } = await createAdminClient()
    .from("attendance_corrections")
    .select("id, attendance_registers!inner(session_label, class_id)")
    .eq("status", "pending")
    .eq("attendance_registers.session_label", ctx.session)
    .returns<{ id: string; attendance_registers: { class_id: string } }[]>();
  return (data ?? []).filter((row) => scopeIncludes(ctx.scope, row.attendance_registers.class_id)).length;
}
