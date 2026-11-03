import "server-only";

import { cache } from "react";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { schoolNow } from "@/platform/auth/qa-clock";
import { FEE_SCHEMA } from "@/platform/env";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { classLabelMap, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { classScopeFor } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes, type ClassScope } from "@/modules/attendance/domain/class-scope";
import { schoolToday } from "@/vx/format";
import { noteViewer, visibleNotes } from "@/vx/screens/notes/data";
import { copiesNoteWords, noteAttention, isSensitiveNote, isTag, tagsFromKind } from "@/vx/screens/notes/domain/notes";
import { classesFor, listExams, staffList, trackerFor } from "@/vx/screens/exams/data";
import { pickCurrentExam } from "@/vx/screens/exams/domain/current";
import { classRows, expectedShare, overall, teacherLoads, type PaperFacts } from "@/vx/screens/exams/domain/tracker";

import {
  addDays,
  attentionWeight,
  average,
  childExams,
  daysFrom,
  isSunday,
  marksFlags,
  mondayOf,
  pooledPct,
  presentPct,
  repeatedNames,
  tally,
  type AttentionFacts,
  type AttentionReason,
  type AttStatus,
  type LateTeacher,
  type MarkRow,
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
  /** The school's day: the lab clock for a Smoke Lab or QA account (`schoolNow`), else the real one. */
  today: string;
  /** The school's "now" behind `today`, for the greeting and the "so far" lines. */
  now: Date;
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

/**
 * The reader's context. Screens read the school's day on the lab clock
 * (`schoolNow`: a Smoke Lab or QA account's pretend "now", else the real
 * one); an action that writes passes `{ writes: true }` and gets the real
 * clock, because the lab clock changes what is read, never what is saved.
 */
export async function academicContext(staff: CurrentStaff, opts: { writes?: boolean } = {}): Promise<Ctx | null> {
  const session = await resolveSessionLabel();
  if (!session) return null;
  const [labels, scope, enrolled, now] = await Promise.all([classLabelMap(session), classScopeFor(staff, session), enrolledRows(session), opts.writes ? Promise.resolve(new Date()) : schoolNow(staff)]);
  const roll = new Map<string, number>();
  for (const row of enrolled) roll.set(row.class_id, (roll.get(row.class_id) ?? 0) + 1);
  const classes = [...labels.entries()]
    .filter(([id]) => scopeIncludes(scope, id) && (roll.get(id) ?? 0) > 0)
    .map(([id, label]) => ({ id, label, roll: roll.get(id) ?? 0 }));
  return {
    staff,
    session,
    today: schoolToday(now),
    now,
    scope,
    classes,
    label: (id) => (id ? labels.get(id) ?? "—" : "—"),
    everyClass: readsEveryClass(staff),
  };
}

/* ---------------------------------------------------------------- names */

export async function studentInfo(ids: string[]): Promise<Map<string, { name: string; father: string | null; phone: string | null; dob: string | null; sr: string | null }>> {
  const wanted = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (wanted.length === 0) return new Map();
  const { data, error } = await fetchInChunks<{ id: string; full_name: string; father_name: string | null; primary_phone: string | null; date_of_birth: string | null; admission_no: string | null }>(
    wanted,
    IN_FILTER_CHUNK_SIZE,
    (chunk) => createAdminClient().schema(FEE_SCHEMA).from("students").select("id, full_name, father_name, primary_phone, date_of_birth, admission_no").in("id", chunk),
  );
  if (error) throw new Error("Could not read the students.");
  return new Map(data.map((row) => [row.id, { name: row.full_name, father: row.father_name, phone: row.primary_phone, dob: row.date_of_birth, sr: row.admission_no ?? null }]));
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
  /**
   * The school is closed this day: a holiday or vacation on the calendar, or
   * a Sunday. Nobody is asked to mark on a closed day, so `notMarked` is empty.
   */
  closed: { kind: string; label: string | null; labelHi?: string | null } | null;
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
  // A closed day has nothing to mark: no "19 not marked", no reminders (smoke 20 Oct, Dussehra).
  const notMarked = closed ? [] : classes.filter((c) => !c.saved);
  const activity = savedClasses
    .filter((c) => c.savedAt)
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""))
    .slice(0, 6)
    .map((c) => ({
      at: c.savedAt!,
      tone: "ok" as const,
      text: {
        en: `${c.savedBy ?? "Someone"} saved ${c.label} · ${c.tally.present + c.tally.late} of ${c.roll} present`,
        hi: `${c.savedBy ? `${c.savedBy} ने` : "किसी ने"} ${c.label} सहेजा · ${c.roll} में से ${c.tally.present + c.tally.late} उपस्थित`,
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

export async function teachersAway(session: string, day: string): Promise<Set<string>> {
  const { data } = await createAdminClient()
    .from("teacher_absences")
    .select("staff_profile_id")
    .eq("session_label", session)
    .eq("day", day)
    .returns<{ staff_profile_id: string }[]>();
  return new Set((data ?? []).map((row) => row.staff_profile_id));
}

export async function calendarDay(session: string, day: string): Promise<{ kind: string; label: string | null; labelHi: string | null } | null> {
  const { data } = await createAdminClient()
    .from("academic_calendar_days")
    .select("kind, label_en, label_hi")
    .eq("session_label", session)
    .eq("day", day)
    .maybeSingle<{ kind: string; label_en: string | null; label_hi: string | null }>();
  if (data && data.kind !== "instructional") return { kind: data.kind, label: data.label_en, labelHi: data.label_hi };
  // A Sunday is closed without a calendar row (the month view and the register skip it too).
  if (isSunday(day)) return { kind: "sunday", label: null, labelHi: null };
  return null;
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
  const classTallies = new Map<string, Tally[]>();
  for (const row of rows) {
    if (row.status !== "submitted") continue;
    const t = rowTally(row, credit);
    const m = grid.get(row.class_id) ?? new Map<string, number | null>();
    m.set(row.day, presentPct(t));
    grid.set(row.class_id, m);
    classTallies.set(row.class_id, [...(classTallies.get(row.class_id) ?? []), t]);
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
      // Every child-day pooled, as the register's class average is (`pooledPct`).
      pct: pooledPct(classTallies.get(c.id) ?? []),
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

/** Holidays and vacation days in a range, with their names, for the month chart and the register. */
export async function holidaysIn(session: string, from: string, to: string): Promise<{ day: string; label: string | null; labelHi: string | null }[]> {
  const { data } = await createAdminClient()
    .from("academic_calendar_days")
    .select("day, kind, label_en, label_hi")
    .eq("session_label", session)
    .gte("day", from)
    .lte("day", to)
    .in("kind", ["holiday", "vacation"])
    .order("day")
    .returns<{ day: string; kind: string; label_en: string | null; label_hi: string | null }[]>();
  return (data ?? []).map((row) => ({ day: row.day, label: row.label_en, labelHi: row.label_hi }));
}

export type DayDetail = {
  day: string;
  /** Every class in the reader's scope: saved or not, and how many were absent. */
  classes: { classId: string; label: string; saved: boolean; absent: number; roll: number }[];
  /** The children marked absent that day, class by class in school order. */
  absent: { studentId: string; name: string; classId: string; classLabel: string }[];
};

/**
 * One day of the month chart, opened: which classes saved, how many were
 * absent in each, and who — so the coordinator need not open eight registers
 * to find yesterday's absentees (smoke 20 Oct).
 */
export async function dayDetail(ctx: Ctx, day: string): Promise<DayDetail> {
  const rows = (await tallies(ctx, day, day)).filter((r) => r.status === "submitted");
  const byClass = new Map(rows.map((r) => [r.class_id, r]));
  const withAbsent = rows.filter((r) => r.absent > 0);
  const marks = withAbsent.length
    ? (
        await fetchInChunks<{ register_id: string; student_id: string }>(withAbsent.map((r) => r.register_id), IN_FILTER_CHUNK_SIZE, (chunk) =>
          createAdminClient().from("attendance_marks").select("register_id, student_id").eq("status", "absent").in("register_id", chunk),
        )
      ).data
    : [];
  const classOf = new Map(rows.map((r) => [r.register_id, r.class_id]));
  const info = await studentInfo(marks.map((m) => m.student_id));
  const order = new Map(ctx.classes.map((c, i) => [c.id, i]));
  return {
    day,
    classes: ctx.classes.map((c) => ({ classId: c.id, label: c.label, saved: byClass.has(c.id), absent: byClass.get(c.id)?.absent ?? 0, roll: c.roll })),
    absent: marks
      .map((m) => {
        const classId = classOf.get(m.register_id) ?? "";
        return { studentId: m.student_id, name: info.get(m.student_id)?.name ?? "—", classId, classLabel: ctx.label(classId) };
      })
      .sort((a, b) => (order.get(a.classId) ?? 999) - (order.get(b.classId) ?? 999) || a.name.localeCompare(b.name)),
  };
}

/** Each child's saved statuses on the last `n` days their class saved, oldest first (the "last 10 days" dots). */
export async function recentStatuses(ctx: Ctx, studentIds: string[], n = 10): Promise<Map<string, { day: string; status: AttStatus }[]>> {
  if (studentIds.length === 0) return new Map();
  const from = addDays(ctx.today, -28);
  const { data } = await fetchInChunks<{ student_id: string; status: AttStatus; attendance_registers: { day: string } }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    createAdminClient()
      .from("attendance_marks")
      .select("student_id, status, attendance_registers!inner(day, session_label, status, period)")
      .in("student_id", chunk)
      .eq("attendance_registers.session_label", ctx.session)
      .eq("attendance_registers.status", "submitted")
      .is("attendance_registers.period", null)
      .gte("attendance_registers.day", from)
      .returns<{ student_id: string; status: AttStatus; attendance_registers: { day: string } }[]>(),
  );
  const out = new Map<string, { day: string; status: AttStatus }[]>();
  for (const row of data) {
    const list = out.get(row.student_id) ?? [];
    list.push({ day: row.attendance_registers.day, status: row.status });
    out.set(row.student_id, list);
  }
  for (const [id, list] of out) out.set(id, list.sort((a, b) => a.day.localeCompare(b.day)).slice(-n));
  return out;
}

/** The latest note a reader may see on each child (body and who wrote it). */
export async function lastNotes(ctx: Ctx, studentIds: string[]): Promise<Map<string, { body: string; by: string; at: string }>> {
  if (studentIds.length === 0 || !can(ctx.staff, "notes:view")) return new Map();
  const { data } = await fetchInChunks<{ student_id: string; body: string; created_at: string; written_by: string; tags: string[] | null; follow_up_staff_id: string | null; note_kinds: { code: string } | null }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
    createAdminClient()
      .from("notes")
      .select("student_id, body, created_at, written_by, tags, follow_up_staff_id, note_kinds(code)")
      .eq("session_label", ctx.session)
      .neq("visibility", "private")
      .in("student_id", chunk)
      .order("created_at", { ascending: false })
      .returns<{ student_id: string; body: string; created_at: string; written_by: string; tags: string[] | null; follow_up_staff_id: string | null; note_kinds: { code: string } | null }[]>(),
  );
  const staff = await staffDirectory();
  const out = new Map<string, { body: string; by: string; at: string }>();
  for (const row of data) {
    if (out.has(row.student_id) || !readsSensitive(ctx.staff, row)) continue;
    out.set(row.student_id, { body: row.body, by: staff.get(row.written_by)?.display_name ?? "—", at: row.created_at });
  }
  return out;
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
  students: {
    studentId: string;
    name: string;
    rollNo: string | null;
    marks: Map<string, AttStatus>;
    pct: number | null;
    /** Set when another child in the class has the same name: the SR number, else the father's name, to tell them apart. */
    tellApart?: string | null;
  }[];
  savedDays: number;
  /** Holidays and vacation days in the month (school closed). */
  closed: string[];
  /** Every child-day of the month pooled — the same number as the month's "Classes ranked" (`pooledPct`). */
  classPct?: number | null;
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
  const named = roll.map((r) => ({ studentId: r.student_id, name: info.get(r.student_id)?.name ?? "—" }));
  const repeated = repeatedNames(named);
  const students = roll
    .map((r) => {
      const ms = byStudent.get(r.student_id) ?? new Map<string, AttStatus>();
      const i = info.get(r.student_id);
      return {
        studentId: r.student_id,
        name: i?.name ?? "—",
        rollNo: r.roll_no,
        marks: ms,
        pct: presentPct(tally(ms.values(), credit)),
        tellApart: repeated.has(r.student_id) ? (i?.sr ? `SR ${i.sr}` : i?.father ?? null) : null,
      };
    })
    .sort((a, b) => (Number(a.rollNo) || 999) - (Number(b.rollNo) || 999) || a.name.localeCompare(b.name));
  return {
    classId,
    label: ctx.label(classId),
    month,
    days,
    students,
    savedDays: regs.length,
    closed: [...closed],
    classPct: presentPct(tally(marks.map((m) => m.status), credit)),
  };
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

/**
 * Every mark of the school's exams this session (`examsOf`: dated, not a
 * draft), one row per child per paper, read once per request. A rehearsal
 * exam with no date is not one of them, so its marks never reach a child's
 * progress or the needs-attention list.
 */
const sessionMarks = cache(async (session: string): Promise<MarkRow[]> => {
  const exams = await examsOf(session);
  if (exams.length === 0) return [];
  const rows = await fetchAllRows<{
    student_id: string;
    value: number | null;
    absent: boolean;
    exempt: boolean;
    assessment_subjects: { assessment_id: string; class_id: string; subject_id: string; subject_code: string; max_marks: number; pass_marks: number | null };
  }>(
    (a, b) =>
      createAdminClient()
        .from("marks")
        .select("id, student_id, value, absent, exempt, assessment_subjects!inner(assessment_id, class_id, subject_id, subject_code, max_marks, pass_marks)")
        .in("assessment_subjects.assessment_id", exams.map((e) => e.id))
        .order("id")
        .range(a, b)
        // A many-to-one embed is one object at runtime; the generic types call it an array.
        .overrideTypes<{ student_id: string; value: number | null; absent: boolean; exempt: boolean; assessment_subjects: { assessment_id: string; class_id: string; subject_id: string; subject_code: string; max_marks: number; pass_marks: number | null } }[], { merge: false }>(),
    "the marks",
  );
  return rows.map((r) => ({
    studentId: r.student_id,
    examId: r.assessment_subjects.assessment_id,
    classId: r.assessment_subjects.class_id,
    subjectId: r.assessment_subjects.subject_id,
    subject: r.assessment_subjects.subject_code,
    value: r.value === null ? null : Number(r.value),
    absent: !!r.absent,
    exempt: !!r.exempt,
    maxMarks: Number(r.assessment_subjects.max_marks),
    passMarks: r.assessment_subjects.pass_marks === null ? null : Number(r.assessment_subjects.pass_marks),
  }));
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

/**
 * The exam whose marks are being entered now — the exam office's rule
 * (`pickCurrentExam`), so the coordinator's home and the exam office talk
 * about the same exam.
 */
export function currentExam(exams: Exam[], today: string): { current: Exam | null; previous: Exam | null } {
  const current = pickCurrentExam(exams, today);
  const idx = current ? exams.indexOf(current) : -1;
  return { current, previous: idx > 0 ? exams[idx - 1] : null };
}

export type MarksEntry = {
  exam: Exam | null;
  /** The exam office's "marks due" day for this exam, if set (`exam_plans.marks_due_on`). */
  dueOn: string | null;
  pct: number;
  papers: PaperProgress[];
  late: (LateTeacher & { name: string })[];
  byClass: { classId: string; label: string; pct: number; done: number; total: number }[];
};

/**
 * The marks-entry tracker for the current exam, with the teachers who are
 * late. Counted by the exam office's tracker (`trackerFor`, `overall`,
 * `teacherLoads`), so this home, Student progress, the marks tracker and the
 * results pipeline give one percentage and one late count (coordinators B4).
 */
export async function marksEntry(ctx: Ctx, examId?: string): Promise<MarksEntry> {
  const [exams, officeExams, classes, people] = await Promise.all([examsOf(ctx.session), listExams(ctx.session), classesFor(ctx.session), staffList()]);
  const exam = (examId && exams.find((e) => e.id === examId)) || currentExam(exams, ctx.today).current;
  const full = exam ? officeExams.find((e) => e.id === exam.id) : undefined;
  if (!exam || !full) return { exam: exam ?? null, dueOn: null, pct: 0, papers: [], late: [], byClass: [] };
  const tracked = await trackerFor({ exam: full, classes, staff: people, today: ctx.today, onlyPapers: (row) => scopeIncludes(ctx.scope, row.class_id) });
  const expected = expectedShare(full.endsOn, full.plan?.marksDueOn ?? null, ctx.today);
  const toProgress = (f: PaperFacts): PaperProgress => ({
    paperId: f.paperId,
    classId: f.classId,
    classLabel: ctx.label(f.classId),
    subject: f.subjectCode,
    entered: Math.min(f.entered, f.total),
    roll: f.total,
    submitted: f.entryStatus === "submitted",
    teacherId: f.teacherId,
  });
  const late = teacherLoads(tracked.papers, expected)
    .filter((load) => load.late)
    .map((load) => ({ teacherId: load.teacherId, name: load.teacherName, papers: load.papers.map(toProgress), entered: load.entered, roll: load.total }));
  const rows = new Map(classRows(tracked.papers, expected).map((row) => [row.classId, row]));
  const byClass = ctx.classes
    .map((c) => {
      const row = rows.get(c.id);
      return { classId: c.id, label: c.label, pct: row?.percent ?? 0, done: row ? row.papers.filter((x) => x.entryStatus === "submitted").length : 0, total: row?.papers.length ?? 0 };
    })
    .filter((c) => c.total > 0);
  return { exam, dueOn: full.plan?.marksDueOn ?? null, pct: overall(tracked.papers).percent, papers: tracked.papers.map(toProgress), late, byClass };
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

/**
 * Each child's result in the given exams, by the report card's rule
 * (`childExams`): an absent paper is 0 out of its full marks, a blank and an
 * exempt are left out. A child with nothing entered yet is not listed.
 */
export async function studentExams(ctx: Ctx, examIds: string[]): Promise<{ studentId: string; examId: string; classId: string; avg: number; papers: number; failed: number; absent: number }[]> {
  if (examIds.length === 0) return [];
  const wanted = new Set(examIds);
  const marks = (await sessionMarks(ctx.session)).filter((m) => wanted.has(m.examId) && scopeIncludes(ctx.scope, m.classId));
  return childExams(marks)
    .filter((c) => c.pct !== null)
    .map((c) => ({ studentId: c.studentId, examId: c.examId, classId: c.classId, avg: c.pct ?? 0, papers: c.counted + c.absent, failed: c.failed, absent: c.absent }));
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

/**
 * The last school day with a saved register, on or before the school's
 * today: what "attendance this term · till …" is up to. Never a day that has
 * not come (smoke 20 Oct: "till 21 Oct" on the 20th).
 */
export async function lastRegisterDay(ctx: Ctx): Promise<string | null> {
  const { data } = await createAdminClient()
    .from("attendance_registers")
    .select("day")
    .eq("session_label", ctx.session)
    .eq("status", "submitted")
    .is("period", null)
    .lte("day", ctx.today)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle<{ day: string }>();
  return data?.day ?? null;
}

/* ------------------------------------------------------ needs attention */

export type AttentionChild = AttentionFacts & {
  studentId: string;
  name: string;
  classId: string;
  classLabel: string;
  followup: { kind: string; outcome: string | null; at: string; by: string; note: string | null } | null;
  plan: string | null;
};

/**
 * Who is on the needs-attention list and why, for every child in the reader's
 * scope. Attendance and open notes are read from `v_needs_attention`; the two
 * marks rules are worked out here (`marksFlags`) from the school's dated
 * exams only, with a blank, an absent or an exempt never read as 0%. The view
 * counted an undated rehearsal exam as the newest paper and put all of Class 1
 * on the list (smoke 20 Oct). One function, so Home, Student progress, a class
 * and the weekly summary give one count.
 */
const attentionFacts = cache(async (ctx: Ctx): Promise<Map<string, AttentionFacts & { classId: string }>> => {
  const [view, exams, marks, enrolled] = await Promise.all([
    createAdminClient()
      .from("v_needs_attention")
      .select("student_id, class_id, attendance_pct, open_notes, reasons")
      .eq("session_label", ctx.session)
      .limit(2000)
      .returns<{ student_id: string; class_id: string; attendance_pct: number | null; open_notes: number; reasons: AttentionReason[] }[]>(),
    examsOf(ctx.session),
    sessionMarks(ctx.session),
    enrolledRows(ctx.session),
  ]);
  if (view.error) throw new Error(`Could not read the attention list: ${view.error.message}`);
  const classOf = new Map(enrolled.map((r) => [r.student_id, r.class_id]));
  const flags = marksFlags(marks, exams.map((e) => e.id));
  const out = new Map<string, AttentionFacts & { classId: string }>();
  const ids = new Set([...view.data.map((r) => r.student_id), ...flags.keys()]);
  const viewRow = new Map(view.data.map((r) => [r.student_id, r]));
  for (const id of ids) {
    const classId = viewRow.get(id)?.class_id ?? classOf.get(id);
    if (!classId || !scopeIncludes(ctx.scope, classId)) continue;
    const row = viewRow.get(id);
    const f = flags.get(id);
    const reasons: AttentionReason[] = [];
    if (row?.reasons.includes("attendance")) reasons.push("attendance");
    if (f && f.below33Subjects.length) reasons.push("below_33");
    if (f && f.dropPoints !== null) reasons.push("dropped");
    if (row?.reasons.includes("notes")) reasons.push("notes");
    if (reasons.length === 0) continue;
    out.set(id, {
      classId,
      reasons,
      attendancePct: row && row.attendance_pct !== null ? Number(row.attendance_pct) : null,
      below33Subjects: f?.below33Subjects ?? [],
      dropPoints: f?.dropPoints ?? null,
      dropSubject: f?.dropSubject ?? null,
      openNotes: row?.open_notes ?? 0,
    });
  }
  return out;
});

export async function needsAttention(ctx: Ctx): Promise<AttentionChild[]> {
  const facts = await attentionFacts(ctx);
  const ids = [...facts.keys()];
  const [info, follow, plans] = await Promise.all([studentInfo(ids), latestFollowups(ctx, ids), planStatus(ctx, ids)]);
  return [...facts.entries()]
    .map(([studentId, f]) => ({
      ...f,
      studentId,
      name: info.get(studentId)?.name ?? "—",
      classLabel: ctx.label(f.classId),
      followup: follow.get(studentId) ?? null,
      plan: plans.get(studentId) ?? null,
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

/**
 * The coordinators read every class but not health or family notes; the
 * admin does (D-264, `canSeeNote()`). Their author and the person asked to
 * follow one up still read it.
 */
function readsSensitive(staff: CurrentStaff, row: { tags: string[] | null; written_by: string; follow_up_staff_id: string | null; note_kinds: { code: string } | null }): boolean {
  if (staff.role === "admin" || row.written_by === staff.id || row.follow_up_staff_id === staff.id) return true;
  const own = (row.tags ?? []).filter(isTag);
  return !isSensitiveNote({ tags: own.length ? own : tagsFromKind(row.note_kinds?.code) });
}

/**
 * Whether a support plan is kept from this reader because of the note it was
 * made from (D-264, R01), as on the notes board (`visiblePlans`): a plan from
 * a health or family note is read by who reads that note, an Only me health
 * or family note's plan is its author's alone, and a plan whose goal still
 * repeats an Only me note's words (made before R01) is its author's alone.
 * Its maker always reads it. Used to show a plan and to refuse writing over
 * one the reader cannot see.
 */
export async function planHiddenFrom(staff: CurrentStaff, plan: { note_id: string | null; created_by: string | null; goal: string | null }): Promise<boolean> {
  if (!plan.note_id || plan.created_by === staff.id) return false;
  const { data: source } = await createAdminClient()
    .from("notes")
    .select("tags, written_by, follow_up_staff_id, visibility, body, note_kinds(code)")
    .eq("id", plan.note_id)
    .maybeSingle<{ tags: string[] | null; written_by: string; follow_up_staff_id: string | null; visibility: string; body: string; note_kinds: { code: string } | null }>();
  if (!source) return false;
  const own = (source.tags ?? []).filter(isTag);
  const sensitive = isSensitiveNote({ tags: own.length ? own : tagsFromKind(source.note_kinds?.code) });
  if (source.visibility === "private" && source.written_by !== staff.id) {
    if (sensitive || copiesNoteWords(plan.goal ?? "", source.body)) return true;
  }
  return !readsSensitive(staff, source);
}

/**
 * "Notes needing action", counted exactly as the Notes board counts its
 * "Needs action" tile: the notes this reader may see (`visibleNotes`, the
 * board's own read and `canSeeNote` rule) through `noteAttention` —
 * a follow-up due today or earlier, or an open health or family note nobody
 * has picked up. Before, Today said 7 where the board said 4
 * (smoke 20 Oct).
 *
 * Counted with the notes board's own `noteAttention`: `due` is the
 * follow-ups due today or earlier, `dueOn` the oldest of them. The weekly
 * report (`notesOpen`) reads this function, so it follows.
 */
export async function notesNeedingAction(ctx: Ctx): Promise<{ open: number; due: number; dueOn: string | null }> {
  if (!can(ctx.staff, "notes:view")) return { open: 0, due: 0, dueOn: null };
  const viewer = await noteViewer(ctx.staff, ctx.session);
  const notes = await visibleNotes(viewer, ctx.session);
  const { needsAction, due, oldestDue } = noteAttention(notes, ctx.today);
  return { open: needsAction, due, dueOn: oldestDue };
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
  /** `absent`: the exams whose paper in this subject the child missed. */
  subjects: { subject: string; byExam: Map<string, number | null>; absent?: Set<string> }[];
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
          .select("id, body, created_at, written_by, status, visibility, tags, follow_up_staff_id, class_id, note_kinds!inner(code, label_en, tone)")
          .eq("student_id", studentId)
          .neq("visibility", "private")
          .order("created_at", { ascending: false })
          .limit(20)
          .returns<{ id: string; body: string; created_at: string; written_by: string; status: string; visibility: string; tags: string[] | null; follow_up_staff_id: string | null; class_id: string | null; note_kinds: { code: string; label_en: string; tone: string } }[]>()
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
    attentionFacts(ctx),
  ]);
  const examIds = new Set(exams.map((e) => e.id));
  const subjects = new Map<string, Map<string, number | null>>();
  // The exams a subject's paper was missed in: shown as "Absent", never as "waiting" (smoke 20 Oct).
  const absentIn = new Map<string, Set<string>>();
  for (const m of marks.data ?? []) {
    const p = m.assessment_subjects;
    if (!examIds.has(p.assessment_id)) continue;
    const byExam = subjects.get(p.subject_code) ?? new Map<string, number | null>();
    byExam.set(p.assessment_id, m.value === null || m.absent || m.exempt || !(Number(p.max_marks) > 0) ? null : Math.round((Number(m.value) / Number(p.max_marks)) * 100));
    subjects.set(p.subject_code, byExam);
    if (m.absent && !m.exempt) absentIn.set(p.subject_code, (absentIn.get(p.subject_code) ?? new Set<string>()).add(p.assessment_id));
  }
  const att = (await studentAttendance(ctx)).get(studentId) ?? { pct: null, absent: 0, counted: 0 };
  const i = info.get(studentId);
  const a = attention.get(studentId);
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
    subjects: [...subjects.entries()].map(([subject, byExam]) => ({ subject, byExam, absent: absentIn.get(subject) ?? new Set<string>() })),
    exams,
    notes: (notes.data ?? []).filter((n) => readsSensitive(ctx.staff, n)).map((n) => ({ id: n.id, body: n.body, kind: n.note_kinds.label_en, tone: n.note_kinds.tone, at: n.created_at, by: staff.get(n.written_by)?.display_name ?? "—", status: n.status })),
    plan,
    followups: (follow.data ?? []).map((f) => ({ kind: f.kind, outcome: f.outcome, note: f.note, at: f.created_at, by: staff.get(f.created_by)?.display_name ?? "—" })),
    facts: a ? { reasons: a.reasons, attendancePct: a.attendancePct, below33Subjects: a.below33Subjects, dropPoints: a.dropPoints, dropSubject: a.dropSubject, openNotes: a.openNotes } : null,
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
    .select("id, goal, status, started_at, note_id, created_by")
    .eq("session_label", ctx.session)
    .eq("student_id", studentId)
    .in("status", ["draft", "active"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; goal: string | null; status: string; started_at: string | null; note_id: string | null; created_by: string | null }>();
  if (!plan) return null;
  if (await planHiddenFrom(ctx.staff, plan)) return null;
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
  const enrolled = await enrolledRows(ctx.session);
  const roll = enrolled.filter((r) => r.class_id === classId);
  // The exam cohort can outlive today's roll. Names and rankings must cover
  // those results without granting access to a former pupil's current details.
  const classResults = results.filter((r) => r.classId === classId);
  const cohort = new Map(roll.map(r => [r.student_id, r]));
  for (const r of classResults) if (!cohort.has(r.studentId)) cohort.set(r.studentId, { student_id: r.studentId, class_id: classId, roll_no: null });
  const currentClass = new Map<string, string>();
  for (const r of enrolled) if (!currentClass.has(r.student_id)) currentClass.set(r.student_id, r.class_id);
  const currentIds = new Set(roll.map(r => r.student_id));
  const info = await studentInfo([...cohort.keys()]);
  const flagged = new Map(attention.filter((a) => a.classId === classId).map((a) => [a.studentId, a]));
  const students = [...cohort.values()]
    .map((r) => {
      const now = classResults.find((x) => x.studentId === r.student_id && x.examId === exam.id);
      const before = previous ? classResults.find((x) => x.studentId === r.student_id && x.examId === previous.id) : undefined;
      return {
        studentId: r.student_id,
        name: info.get(r.student_id)?.name ?? "—",
        rollNo: r.roll_no,
        // Exactly studentDetail's current-enrolment and class-scope guard.
        canOpen: scopeIncludes(ctx.scope, currentClass.get(r.student_id)),
        historical: !currentIds.has(r.student_id),
        avg: now ? Math.round(now.avg) : null,
        before: before ? Math.round(before.avg) : null,
        failed: now?.failed ?? 0,
        // Papers missed in this exam: each counts 0 in the average, and the ranking says so.
        ...(now?.absent ? { absent: now.absent } : {}),
        attendance: currentIds.has(r.student_id) ? att.get(r.student_id)?.pct ?? null : null,
        attention: currentIds.has(r.student_id) ? flagged.get(r.student_id) ?? null : null,
      };
    })
    .sort((a, b) => (a.avg ?? 999) - (b.avg ?? 999));
  const subjects = stats
    .filter((s) => s.classId === classId && s.examId === exam.id)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((s) => {
      const prev = stats.find((p) => p.classId === classId && p.examId === previous?.id && p.subjectId === s.subjectId);
      return { subjectId: s.subjectId, subject: s.subject, avg: s.avgPct === null ? null : Math.round(s.avgPct), before: prev?.avgPct == null ? null : Math.round(prev.avgPct), pass: s.scored ? Math.round((s.passed / s.scored) * 100) : null, entered: s.entered, submitted: s.submitted };
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

export type ClassDetail = NonNullable<Awaited<ReturnType<typeof classDetail>>>;

/** One class's marks in one exam as percentages: a row per child per subject (absent, exempt and blank left out). */
export async function classMarks(ctx: Ctx, classId: string, examId: string): Promise<{ studentId: string; subject: string; pct: number }[]> {
  if (!scopeIncludes(ctx.scope, classId)) return [];
  const { data } = await createAdminClient()
    .from("marks")
    .select("student_id, value, absent, exempt, assessment_subjects!inner(assessment_id, class_id, subject_code, max_marks)")
    .eq("assessment_subjects.assessment_id", examId)
    .eq("assessment_subjects.class_id", classId)
    .limit(5000)
    .returns<{ student_id: string; value: number | null; absent: boolean; exempt: boolean; assessment_subjects: { assessment_id: string; class_id: string; subject_code: string; max_marks: number } }[]>();
  return (data ?? [])
    .filter((m) => m.value !== null && !m.absent && !m.exempt && Number(m.assessment_subjects.max_marks) > 0)
    .map((m) => ({ studentId: m.student_id, subject: m.assessment_subjects.subject_code, pct: Math.round((Number(m.value) / Number(m.assessment_subjects.max_marks)) * 1000) / 10 }));
}

/** Who teaches one class (class teacher, each subject's teacher), whether its results are locked, and its notes this session. */
export async function classPeople(ctx: Ctx, classId: string, examId: string): Promise<{ classTeacher: string | null; bySubject: Map<string, string>; locked: boolean; notes: { total: number; followUp: number } }> {
  if (!scopeIncludes(ctx.scope, classId)) return { classTeacher: null, bySubject: new Map(), locked: false, notes: { total: 0, followUp: 0 } };
  const admin = createAdminClient();
  const [teachers, staff, assignments, lock, notes] = await Promise.all([
    classTeachersOn(ctx.session, ctx.today),
    staffDirectory(),
    admin.from("teaching_assignments").select("subject_id, staff_profile_id").eq("session_label", ctx.session).eq("class_id", classId).returns<{ subject_id: string; staff_profile_id: string }[]>(),
    admin.from("exam_class_locks").select("class_id").eq("assessment_id", examId).eq("class_id", classId).maybeSingle<{ class_id: string }>(),
    admin
      .from("notes")
      .select("id, status, needs_follow_up, written_by, tags, follow_up_staff_id, note_kinds(code)")
      .eq("session_label", ctx.session)
      .eq("class_id", classId)
      .neq("visibility", "private")
      .limit(500)
      .returns<{ id: string; status: string; needs_follow_up: boolean; written_by: string; tags: string[] | null; follow_up_staff_id: string | null; note_kinds: { code: string } | null }[]>(),
  ]);
  const ct = teachers.get(classId);
  const visible = (notes.data ?? []).filter((n) => readsSensitive(ctx.staff, n));
  return {
    classTeacher: ct ? staff.get(ct)?.display_name ?? null : null,
    bySubject: new Map((assignments.data ?? []).map((a) => [a.subject_id, staff.get(a.staff_profile_id)?.display_name ?? "—"])),
    locked: !!lock.data,
    notes: { total: visible.length, followUp: visible.filter((n) => n.needs_follow_up && (n.status === "open" || n.status === "working")).length },
  };
}

/** A child's class teacher, for "Talk to …" (name and the phone their WhatsApp is on). */
export async function classTeacherOf(ctx: Ctx, classId: string): Promise<{ name: string; phone: string | null } | null> {
  const [teachers, staff] = await Promise.all([classTeachersOn(ctx.session, ctx.today), staffDirectory()]);
  const id = teachers.get(classId);
  const person = id ? staff.get(id) : undefined;
  return person ? { name: person.display_name, phone: person.whatsapp_phone ?? person.phone ?? null } : null;
}

/* ------------------------------------------------------- the week */

/**
 * When the weekly summary last went, for the bar's "last sent": the staff
 * outbox since go-live Phase F (a `weekly_summary` notice not taken back),
 * and the hand-sent `message_sends` rows from before it, whichever is later.
 */
export async function weeklySummaryLastSent(session: string): Promise<string | null> {
  const admin = createAdminClient();
  const [outbox, template] = await Promise.all([
    admin
      .from("staff_notices")
      .select("created_at")
      .eq("kind", "weekly_summary")
      .eq("session_label", session)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string }>(),
    admin.from("message_templates").select("id").eq("code", "vppsone_weekly_summary").maybeSingle<{ id: string }>(),
  ]);
  const { data: handSent } = template.data
    ? await admin
        .from("message_sends")
        .select("created_at")
        .eq("template_id", template.data.id)
        .eq("session_label", session)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ created_at: string }>()
    : { data: null };
  const times = [outbox.data?.created_at, handSent?.created_at].filter((at): at is string => Boolean(at));
  return times.length ? times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
}

export async function weekFacts(ctx: Ctx) {
  const monday = mondayOf(ctx.today);
  const prevMonday = addDays(monday, -7);
  // Eight weeks back for the trend line; the facts below still read only this week and last.
  const trendFrom = addDays(monday, -49);
  const [rows, credit, entry, attention, notes, corrections, holidays] = await Promise.all([
    tallies(ctx, trendFrom, ctx.today),
    halfDayCredit(ctx.session),
    marksEntry(ctx),
    needsAttention(ctx),
    notesNeedingAction(ctx),
    // Corrections made to saved registers this week, by whoever made them.
    createAdminClient()
      .from("attendance_register_revisions")
      .select("id", { count: "exact", head: true })
      .eq("kind", "correction")
      .gte("created_at", `${monday}T00:00:00+05:30`),
    holidaysIn(ctx.session, monday, ctx.today),
  ]);
  const holidayOn = new Map(holidays.map((h) => [h.day, h]));
  const sum = (from: string, to: string) =>
    rows.filter((r) => r.status === "submitted" && r.day >= from && r.day <= to).reduce<Tally>((s, r) => {
      const t = rowTally(r, credit);
      return { ...s, counted: s.counted + t.counted, credit: s.credit + t.credit };
    }, tally([]));
  const thisWeek = sum(monday, ctx.today);
  const lastWeek = sum(prevMonday, addDays(monday, -1));
  const days = new Set(rows.filter((r) => r.day >= monday).map((r) => r.day));
  const always = ctx.classes.filter((c) => [...days].every((d) => rows.some((r) => r.class_id === c.id && r.day === d && r.status === "submitted"))).length;
  // A holiday is named on its day ("Holiday · Dussehra"), never a bare "—" that reads as "nobody marked".
  const daily = daysFrom(monday, ctx.today)
    .filter((d) => !isSunday(d))
    .map((d) => {
      const h = holidayOn.get(d);
      return { day: d, pct: presentPct(sum(d, d)), ...(h ? { holiday: { label: h.label, labelHi: h.labelHi } } : {}) };
    });
  const weekStart = `${monday}T00:00:00+05:30`;
  const fresh = attention.filter((a) => a.followup === null || a.followup.at >= weekStart).length;
  // Weekly averages, oldest first: the eight weeks that end with this one.
  const trend = Array.from({ length: 8 }, (_, i) => {
    const from = addDays(monday, (i - 7) * 7);
    const to = i === 7 ? ctx.today : addDays(from, 6);
    return { monday: from, pct: presentPct(sum(from, to)) };
  });
  // Children someone marked "improving" this week (student_followups, kind improving).
  const { data: improving } = await createAdminClient()
    .from("student_followups")
    .select("student_id, created_at, created_by")
    .eq("session_label", ctx.session)
    .eq("kind", "improving")
    .gte("created_at", weekStart)
    .order("created_at", { ascending: false })
    .limit(50)
    .returns<{ student_id: string; created_at: string; created_by: string }[]>();
  const enrolled = new Map((await enrolledRows(ctx.session)).map((row) => [row.student_id, row.class_id]));
  const improvedRows = [...new Map((improving ?? []).filter((r) => scopeIncludes(ctx.scope, enrolled.get(r.student_id))).map((r) => [r.student_id, r])).values()].slice(0, 5);
  const [improvedInfo, staff] = await Promise.all([studentInfo(improvedRows.map((r) => r.student_id)), staffDirectory()]);
  const improved = improvedRows.map((r) => ({
    studentId: r.student_id,
    name: improvedInfo.get(r.student_id)?.name ?? "—",
    classLabel: ctx.label(enrolled.get(r.student_id)),
    by: staff.get(r.created_by)?.display_name ?? "—",
    at: r.created_at,
  }));
  // Classes whose results the exam office has locked (exam_class_locks): their submitted papers count as "Locked".
  const { data: locks } = entry.exam
    ? await createAdminClient().from("exam_class_locks").select("class_id").eq("assessment_id", entry.exam.id).returns<{ class_id: string }[]>()
    : { data: [] as { class_id: string }[] };
  const locked = new Set((locks ?? []).map((l) => l.class_id));
  const papers = {
    locked: entry.papers.filter((p) => p.submitted && locked.has(p.classId)).length,
    done: entry.papers.filter((p) => p.submitted && !locked.has(p.classId)).length,
    inProgress: entry.papers.filter((p) => !p.submitted && p.entered > 0).length,
    notStarted: entry.papers.filter((p) => !p.submitted && p.entered === 0).length,
  };
  const principals = [...staff.values()].filter((s) => s.role === "admin" && s.is_active && (s.whatsapp_phone ?? s.phone)).map((s) => s.display_name);
  const lastSent = await weeklySummaryLastSent(ctx.session);
  return {
    monday,
    trend,
    improved,
    papers,
    principals,
    lastSent,
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
      correctionsMade: corrections.count ?? 0,
    },
    entry,
    attention,
  };
}

/** A staff template's two bodies, for the preview a send sheet shows before anything goes. */
export async function staffTemplateBodies(code: string): Promise<{ hi: string; en: string } | null> {
  const { data } = await createAdminClient()
    .from("message_templates")
    .select("body_hi, body_en, audience, is_active")
    .eq("code", code)
    .maybeSingle<{ body_hi: string; body_en: string; audience: string; is_active: boolean }>();
  if (!data || data.audience !== "staff" || data.is_active === false) return null;
  return { hi: data.body_hi, en: data.body_en };
}

/* ------------------------------------------------------- coming up */

export type UpcomingEvent = { id: string; kind: string; title: string; titleHi: string | null; startsOn: string; endsOn: string; startsAt: string | null; place: string | null };

export async function upcomingEvents(session: string, from: string, days: number, admin: Admin = createAdminClient(), now: Date = new Date()): Promise<UpcomingEvent[]> {
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
  // A one-day event today whose time passed more than an hour ago is over, not coming up.
  const nowIst = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  const [h, m] = nowIst.split(":").map(Number);
  const cutoff = `${String(Math.max(0, h - 1)).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  const over = (e: UpcomingEvent) => e.endsOn === from && e.startsOn === from && from === schoolToday(now) && !!e.startsAt && e.startsAt.slice(0, 5) < cutoff;
  return list.filter((e) => !over(e)).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || (a.startsAt ?? "").localeCompare(b.startsAt ?? ""));
}

