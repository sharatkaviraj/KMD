import "server-only";

import { randomUUID } from "node:crypto";
import { cache } from "react";

import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { assertActorEveryClass, assertActorPermission, assertActorSession, type VerifiedActor } from "@/platform/auth/verified-actor";
import { addDays, dayLabel, weekdayLabel, weekdayName } from "@/platform/dates";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { PartialReadError } from "@/platform/helpers/partial-read";
import { feesBridgeOfficeReads, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { pendingCanonicalMoneyRequests, pendingMoneyRequests, pendingOneMoneyRequests, type FeesRefundRef } from "@/modules/dashboard/vx/admin-today";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { createClient } from "@/platform/supabase/server";
import { classLabelMap, classLabelMapAs } from "@/modules/academics/data/academics-repo";
import { isSchoolOpen, timetableRuns } from "@/modules/academics/domain/calendar";
import { rankOf } from "@/modules/academics/domain/class-order";
import { termSummaries, type TermSummary } from "@/modules/assessments/data/reports-repo";
import {
  attendanceCalendar,
  attendanceCalendarAs,
  attendanceRules,
  attendanceRulesAs,
  findRegister,
  latestReceipt,
  listMarks,
  markStatusesAs,
  registersForDay,
  registersForDayAs,
  rosterOn,
  schoolCalendar,
  studentAttendance,
} from "@/modules/attendance/data/attendance-repo";
import { compareRoll, type AttendanceStatus } from "@/modules/attendance/domain/attendance";
import { classScopeFor } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { documentsForStudent, historyForStudent, type RecordChange } from "@/modules/collection/data/documents-repo";
import { listSubmissions } from "@/modules/collection/data/submissions-repo";
import { splitByChange, type StudentDocument } from "@/modules/collection/domain/review";
import { listEnrolments, listEnrolmentsAs } from "@/modules/enrolments/data/enrolments-repo";
import { jobsBoard } from "@/modules/jobs/data/jobs-repo";
import { enrolmentForStudent, getStudentCard, type StudentCard } from "@/modules/students/data/student-repo";
import { listStaff, listStaffAs } from "@/modules/staff/data/staff-repo";
import { parentNoteViews, parentReaderFor } from "@/modules/whatsapp/data/parent-suggestion-views";
import { waitingSuggestions } from "@/modules/whatsapp/data/parent-suggestions";
import { inNeedsYou, SUGGESTION_FOOTNOTES, SUGGESTION_WORDS } from "@/modules/whatsapp/domain/parent-suggestions";
import { absencesOn, absencesOnAs } from "@/modules/substitutions/data/absences-repo";
import { candidatesFor, profilesFor, readCoverDay } from "@/modules/substitutions/data/arrange-day";
import { currentBells, dutiesOn, liveOnly } from "@/modules/substitutions/data/cover-repo";
import { coverEligibleIds, distinctNames } from "@/modules/substitutions/domain/cover-view";
import { getPublishedVersion } from "@/modules/timetable/data/timetable-repo";
import { toiletGaps } from "@/modules/toilets/data/read";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import type { CalendarDayKind } from "@/modules/academics/domain/calendar";

import { p, type Pair } from "@/vx/text";
import { boardSummary, remindable, sortBoard, registerLate, schoolMinutes, supportAttention, type ClassBoardRow, type MarkStatus } from "@/vx/screens/admin/logic";
import { scheduleNow, coverToday, type CoverException, type ScheduleSlot, type ScheduleView } from "@/vx/screens/admin/schedule";
import { T } from "@/vx/screens/admin/text";
import { schoolWeek } from "@/vx/screens/admin/today-logic";
import type { BoardData, InboxItem, SheetData, TimelineItem } from "@/vx/screens/admin/types";
import { isSensitiveNote, isTag, tagsFromKind } from "@/vx/screens/notes/domain/notes";
import { inboxBadgeCount, SUBMISSION_ITEMS_MAX } from "@/vx/shell/badge-count";

/**
 * Reads behind the admin core (P5). Every function here reads through the
 * existing repositories, which keep their own permission checks; the few
 * direct reads are of this app's own tables (`vppsone`), never of fee data.
 */

/*
 * Per-request dedupe (perf fix 1). One admin Today used to run the board three
 * times and the queue twice — the page, `loadToday` and the shell's badge each
 * asked for their own — about 70 PostgREST calls for one load. React `cache()`
 * is scoped to a single server render, so these never carry one person's
 * answer into another request; each read keeps its own permission check
 * inside, against this request's cookies. Keys are strings or a module-level
 * function, so equal calls really are the same entry.
 */
const absencesFor = cache((sessionLabel: string, day: string) => absencesOn(sessionLabel, day));
const staffList = cache(() => listStaff());
const dutiesFor = cache((sessionLabel: string, day: string) => dutiesOn(sessionLabel, day));
const pendingSubmissions = cache(() => listSubmissions("pending"));
const jobsNow = cache(() => jobsBoard());
/** A parent's suggestions still waiting this session (D-598), read once for the page and the badge. */
const waitingParents = cache((sessionLabel: string) => waitingSuggestions(sessionLabel));

type AskedLeave = { id: string; staffName: string; fromDay: string; toDay: string; span: string; note: string | null; askedAt: string };

/**
 * Leave a teacher asked and nobody has decided (Needs you, brief 02): it was
 * only on the timetable's leave tab, so an admin who did not open that tab
 * never saw it. Read only; it is decided on the timetable screen.
 */
const askedLeave = cache(async (sessionLabel: string): Promise<AskedLeave[]> => {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("teacher_leave")
    .select("id, staff_profile_id, from_day, to_day, span, note, created_at")
    .eq("session_label", sessionLabel)
    .eq("status", "asked")
    .order("from_day")
    .limit(20)
    .returns<{ id: string; staff_profile_id: string; from_day: string; to_day: string; span: string; note: string | null; created_at: string }[]>();
  if (error) throw new Error("Could not read leave requests.");
  if (!data.length) return [];
  const { data: people } = await admin.from("staff_profiles").select("id, display_name").in("id", [...new Set(data.map((r) => r.staff_profile_id))]).returns<{ id: string; display_name: string }[]>();
  const name = new Map((people ?? []).map((s) => [s.id, s.display_name]));
  return data.map((r) => ({ id: r.id, staffName: name.get(r.staff_profile_id) ?? "—", fromDay: r.from_day, toDay: r.to_day, span: r.span, note: r.note, askedAt: r.created_at }));
});

/**
 * Leave asked and not decided, for a member of staff verified by the AI
 * connection (`pending_leave`). Needs you loads it only for
 * `substitutions:manage`; the same check, against the actor. The note stays
 * behind: the tool's projection never names it.
 */
export async function askedLeaveForActor(actor: VerifiedActor, sessionLabel: string): Promise<AskedLeave[]> {
  assertActorPermission(actor, "substitutions:manage");
  assertActorSession(actor, sessionLabel);
  return askedLeave(sessionLabel);
}

const LEAVE_SPAN: Record<string, Pair> = { full: p("Full day", "पूरा दिन"), first_half: p("First half", "पहली पाली"), second_half: p("Second half", "दूसरी पाली") };
// The school's own words for the days, never a bare "2026-10-16" (B13).
const leaveDays = (r: AskedLeave): Pair => {
  const from = dayLabel(r.fromDay);
  if (r.fromDay === r.toDay) return p(`${weekdayLabel(r.fromDay).en.slice(0, 3)} ${from.en}`, `${weekdayLabel(r.fromDay).hi} ${from.hi}`);
  const to = dayLabel(r.toDay);
  return p(`${from.en} – ${to.en}`, `${from.hi} – ${to.hi}`);
};

type MoneyRequest = { id: string; studentId: string; studentName: string; amount: number; reason: string | null; reasonText?: Pair; title?: Pair; requestedAt: string; href?: string; deskKind?: "reversal" | "write_off"; receiptNumber?: string | null; feesRefund?: FeesRefundRef };
type MoneyRequests = () => Promise<MoneyRequest[]>;
const moneyRequests = cache((read: MoneyRequests) => read());

/**
 * Run a read; a failure becomes null and is recorded rather than shown as
 * nought (D-93). A partial read keeps what arrived and is still recorded, so
 * the queue shows those items and says the rest could not be read (T03).
 */
async function guard<T>(missing: string[], key: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    missing.push(key);
    return error instanceof PartialReadError ? (error.partial as T) : null;
  }
}

/**
 * Who may see money requests, and where they come from: the full local queue,
 * or under the live Fees connection One's own desk and accounts requests
 * (Fees' refund queue is not readable from here). One stable function per
 * case, so the request cache shares one read between the page and the badge.
 */
export function moneyRequestsFor(staff: CurrentStaff, sessionLabel: string): MoneyRequests | undefined {
  if (!can(staff, "fees:view")) return undefined;
  if (!usesCanonicalFees(staff, sessionLabel)) return pendingMoneyRequests;
  return feesBridgeOfficeReads() ? pendingCanonicalMoneyRequests(sessionLabel) : pendingOneMoneyRequests;
}

/* ------------------------------------------------------- class teachers */

/** Who answers for each class's register on a day: the class teacher, else the assistant. */
async function responsibleFor(sessionLabel: string, day: string): Promise<Map<string, string>> {
  const { data, error } = await createAdminClient()
    .from("class_teachers")
    .select("class_id, staff_profile_id, role, effective_from, effective_to")
    .eq("session_label", sessionLabel)
    .returns<{ class_id: string; staff_profile_id: string; role: string; effective_from: string | null; effective_to: string | null }[]>();
  if (error) throw new Error(`Could not read the class teachers: ${error.message}`);
  const byClass = new Map<string, { staff: string; role: string }>();
  for (const row of data) {
    if (row.effective_from && row.effective_from > day) continue;
    if (row.effective_to && row.effective_to < day) continue;
    const held = byClass.get(row.class_id);
    if (!held || (held.role !== "class_teacher" && row.role === "class_teacher")) {
      byClass.set(row.class_id, { staff: row.staff_profile_id, role: row.role });
    }
  }
  return new Map([...byClass].map(([classId, held]) => [classId, held.staff]));
}

/** Attendance reminders already queued today, by class. */
async function remindersOn(day: string): Promise<Map<string, string>> {
  const { data, error } = await createAdminClient()
    .from("staff_notices")
    .select("class_id, created_at")
    .eq("kind", "attendance_reminder")
    .eq("day", day)
    .returns<{ class_id: string | null; created_at: string }[]>();
  if (error) throw new Error(`Could not read the reminders: ${error.message}`);
  const out = new Map<string, string>();
  for (const row of data) {
    if (!row.class_id) continue;
    const seen = out.get(row.class_id);
    if (!seen || row.created_at > seen) out.set(row.class_id, row.created_at);
  }
  return out;
}

/* ------------------------------------------------------------ the board */

type Board = BoardData & { unavailable: string[]; timetableRuns: boolean };

/** The day's class board, once per request however many parts of the page ask (perf fix 1). */
export const loadBoard: (sessionLabel: string, day: string) => Promise<Board> = cache(readBoard);

/**
 * Where the board's rows come from. The screen's source is the signed-in
 * readers (cookie, RLS, each with its own check); `actorBoardSource` is the
 * same readers' verified-actor twins, for the AI connection. The board itself
 * — the tally, the rows, the order — is one function over either.
 */
type BoardSource = {
  labels: (sessionLabel: string) => Promise<Map<string, string>>;
  registers: (sessionLabel: string, day: string) => Promise<Awaited<ReturnType<typeof registersForDay>>>;
  enrolments: (sessionLabel: string) => Promise<Awaited<ReturnType<typeof listEnrolments>>>;
  staff: () => Promise<{ id: string; displayName: string }[]>;
  absences: (sessionLabel: string, day: string) => Promise<{ staffProfileId: string }[]>;
  calendar: (sessionLabel: string) => Promise<Map<string, CalendarDayKind>>;
  rules: (sessionLabel: string) => Promise<Awaited<ReturnType<typeof attendanceRules>>>;
  marks: (sessionLabel: string, registerIds: string[]) => Promise<{ data: { register_id: string; status: AttendanceStatus }[] | null; error: unknown }>;
};

// Wrappers, not references: the readers are looked up when the board is read,
// as they were before this seam existed, never at module load.
const screenBoardSource: BoardSource = {
  labels: (sessionLabel) => classLabelMap(sessionLabel),
  registers: (sessionLabel, day) => registersForDay(sessionLabel, day),
  enrolments: (sessionLabel) => listEnrolments(sessionLabel),
  staff: () => staffList(),
  absences: (sessionLabel, day) => absencesFor(sessionLabel, day),
  calendar: (sessionLabel) => attendanceCalendar(sessionLabel),
  rules: (sessionLabel) => attendanceRules(sessionLabel),
  marks: async (_sessionLabel, registerIds) => {
    const supabase = await createClient();
    return fetchInChunks<{ register_id: string; status: AttendanceStatus }>(registerIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      supabase.from("attendance_marks").select("register_id, status").in("register_id", chunk),
    );
  },
};

function actorBoardSource(actor: VerifiedActor): BoardSource {
  return {
    labels: (sessionLabel) => classLabelMapAs(actor, sessionLabel),
    registers: (sessionLabel, day) => registersForDayAs(actor, sessionLabel, day),
    enrolments: (sessionLabel) => listEnrolmentsAs(actor, sessionLabel),
    staff: () => listStaffAs(actor),
    absences: (sessionLabel, day) => absencesOnAs(actor, sessionLabel, day, { withReason: false }),
    calendar: (sessionLabel) => attendanceCalendarAs(actor, sessionLabel),
    rules: (sessionLabel) => attendanceRulesAs(actor, sessionLabel),
    marks: (sessionLabel, registerIds) => markStatusesAs(actor, sessionLabel, registerIds),
  };
}

/**
 * The day's class board for a member of staff verified by the AI connection
 * (`school_day_summary`). The admin Today's own guard — `dashboard:view` —
 * and its scope, every class (`readsEveryClass`), checked against the actor;
 * every reader inside repeats its own check.
 */
export async function boardForActor(actor: VerifiedActor, sessionLabel: string, day: string): Promise<Board> {
  assertActorEveryClass(actor, "dashboard:view");
  assertActorSession(actor, sessionLabel);
  return readBoardFrom(actorBoardSource(actor), sessionLabel, day);
}

async function readBoard(sessionLabel: string, day: string): Promise<Board> {
  return readBoardFrom(screenBoardSource, sessionLabel, day);
}

async function readBoardFrom(source: BoardSource, sessionLabel: string, day: string): Promise<Board> {
  const missing: string[] = [];
  const [labels, registers, enrolments, responsible, staff, absences, reminders, calendar, rules, bells] = await Promise.all([
    source.labels(sessionLabel),
    source.registers(sessionLabel, day),
    source.enrolments(sessionLabel),
    guard(missing, "teachers", () => responsibleFor(sessionLabel, day)),
    guard(missing, "staff", () => source.staff()),
    guard(missing, "absences", () => source.absences(sessionLabel, day)),
    guard(missing, "reminders", () => remindersOn(day)),
    guard<Map<string, CalendarDayKind>>(missing, "calendar", () => source.calendar(sessionLabel)),
    guard(missing, "rules", () => source.rules(sessionLabel)),
    guard(missing, "bells", () => currentBells(sessionLabel)),
  ]);

  const rank = rankOf(labels);
  const daily = registers.filter((register) => register.period === null);
  const registerOf = new Map(daily.map((register) => [register.classId, register]));
  const recordedIds = daily.filter((register) => register.revision >= 1).map((register) => register.id);

  const tally = new Map<string, { present: number; absent: number; halfDay: number; other: number }>();
  if (recordedIds.length > 0) {
    const { data, error } = await source.marks(sessionLabel, recordedIds);
    if (error) missing.push("marks");
    for (const row of data ?? []) {
      const t = tally.get(row.register_id) ?? { present: 0, absent: 0, halfDay: 0, other: 0 };
      // Late is counted present, as on the register sheet and the coordinator's board.
      if (row.status === "present" || row.status === "late") t.present += 1;
      else if (row.status === "absent") t.absent += 1;
      else if (row.status === "half_day") t.halfDay += 1;
      else t.other += 1;
      tally.set(row.register_id, t);
    }
  }

  const rollOf = new Map<string, number>();
  for (const row of enrolments) if (row.status === "enrolled") rollOf.set(row.classId, (rollOf.get(row.classId) ?? 0) + 1);
  const nameOf = new Map((staff ?? []).map((person) => [person.id, person.displayName]));
  const away = new Set((absences ?? []).map((row) => row.staffProfileId));

  const rows: ClassBoardRow[] = [...labels.entries()].map(([classId, label]) => {
    const register = registerOf.get(classId) ?? null;
    const recorded = register !== null && register.revision >= 1;
    const marks = register ? tally.get(register.id) : undefined;
    const teacherId = responsible?.get(classId) ?? null;
    return {
      classId,
      label,
      rank: rank.get(classId) ?? 999,
      teacherId,
      teacherName: teacherId ? (nameOf.get(teacherId) ?? null) : null,
      roll: rollOf.get(classId) ?? 0,
      recorded,
      savedAt: recorded ? register.submittedAt : null,
      present: marks?.present ?? 0,
      absent: marks?.absent ?? 0,
      halfDay: marks?.halfDay ?? 0,
      other: marks?.other ?? 0,
      teacherAway: teacherId ? away.has(teacherId) : false,
      remindedAt: reminders?.get(classId) ?? null,
    };
  });

  return {
    day,
    rows: sortBoard(rows),
    halfDayCredit: rules?.halfDayCredit ?? 0.5,
    schoolOpen: calendar === null ? true : isSchoolOpen(day, calendar),
    // Open is not the same as teaching: an exam or event day is open and runs no timetable.
    timetableRuns: calendar === null ? true : timetableRuns(day, calendar),
    bells: (bells?.periods ?? []).map((period) => ({ index: period.index, starts: period.starts, ends: period.ends })),
    unavailable: missing,
  };
}

/* ------------------------------------------------------- the mark sheet */

export async function loadSheet(sessionLabel: string, day: string, classId: string, board: BoardData): Promise<SheetData | null> {
  const row = board.rows.find((entry) => entry.classId === classId);
  if (!row) return null;
  const [roll, register] = await Promise.all([rosterOn({ classId, sessionLabel, day }), findRegister(classId, sessionLabel, day, null)]);
  const [marks, receipt] = register && register.revision >= 1 ? await Promise.all([listMarks(register.id), latestReceipt(register.id).catch(() => null)]) : [null, null];
  const saved: Record<string, MarkStatus> = {};
  for (const [studentId, mark] of marks ?? []) saved[studentId] = mark.status;
  return {
    classId,
    label: row.label,
    day,
    roll: [...roll].sort(compareRoll).map((student) => ({ studentId: student.studentId, fullName: student.fullName, rollNo: student.rollNo })),
    saved,
    revision: register?.revision ?? 0,
    teacherName: row.teacherName,
    teacherAway: row.teacherAway,
    savedBy: receipt?.actorName ?? null,
    savedAt: receipt?.savedAt ?? null,
  };
}

/* ------------------------------------------------------------ reminders */

const IST_OFFSET_MINUTES = 330;

/**
 * Queue a WhatsApp reminder to the class teacher of each class still not
 * marked, the same notice the 10 a.m. job sends (P6). The notice key makes a
 * second tap a no-op rather than a second message.
 */
export async function queueAttendanceReminders(sessionLabel: string, day: string, classIds: readonly string[], requestId?: string): Promise<number> {
  const board = await loadBoard(sessionLabel, day);
  const wanted = new Set(classIds);
  const targets = remindable(board.rows).filter((row) => wanted.size === 0 || wanted.has(row.classId));
  if (targets.length === 0) return 0;

  const lastEnds = Math.max(
    ...board.bells.map((bell) => {
      const [h, m] = bell.ends.split(":").map(Number);
      return h * 60 + m;
    }),
    15 * 60,
  );
  const [y, mo, d] = day.split("-").map(Number);
  const notAfter = new Date(Date.UTC(y, mo - 1, d) + (lastEnds - IST_OFFSET_MINUTES) * 60_000).toISOString();
  const commandId = requestId ?? randomUUID();

  const rows = targets.map((row) => ({
    notice_key: `attendance:${row.classId}:${day}:${row.teacherId}`,
    kind: "attendance_reminder",
    class_id: row.classId,
    class_label: row.label,
    staff_profile_id: row.teacherId,
    session_label: sessionLabel,
    day,
    not_after: notAfter,
    command_id: commandId,
  }));
  const { data, error } = await createAdminClient()
    .from("staff_notices")
    .upsert(rows, { onConflict: "notice_key", ignoreDuplicates: true })
    .select("id");
  if (error) throw new Error(`Could not queue the reminders: ${error.message}`);
  return data?.length ?? 0;
}

/* ------------------------------------------------------------- Today */

export type TodayFacts = {
  board: BoardData | null;
  staffAway: number | null;
  /** Cover today: lessons needing a teacher (begun ones with none included), how many have one, how many had begun with none. */
  cover: { needed: number; arranged: number; missed: number } | null;
  timeline: TimelineItem[];
  /** Who is scheduled to teach now and next; null when this reader has no `timetable:view` or it could not be read. */
  schedule: ScheduleView | null;
  scheduleFailed: boolean;
  /** Today's teaching exceptions. `notMarked` is null when the school is closed or the board could not be read. */
  exceptions: { notMarked: string[] | null; cover: CoverException[] | null };
  /** Notes on children needing action; null for a reader without the school-wide notes board. */
  support: { needsAction: number; due: number } | null;
  unavailable: string[];
};

type DaySlotRow = {
  day: string;
  period: number;
  class_id: string;
  class_label: string;
  subject_code: string;
  staff_profile_id: string;
  teacher_short_name: string;
  shared: boolean;
  parallel: boolean;
};

/**
 * Today's day block of the published timetable, every class: one read,
 * bounded to the rows whose header could name this weekday (about a sixth of
 * the version), then narrowed by `matchDayHeader()` — "Mon", "MONDAY" and
 * "Monday " all count, "Monthly test" does not. Paged anyway: a sixth of a
 * timetable is far under PostgREST's thousand-row cap, but "far under" is
 * not a reason to read a truncated answer.
 */
async function slotsForDay(sessionLabel: string, day: string): Promise<ScheduleSlot[]> {
  const version = await getPublishedVersion(sessionLabel);
  if (!version) return [];
  const stem = weekdayName(day).slice(0, 3).toLowerCase();
  const supabase = await createClient();
  const rows = await fetchAllRows<DaySlotRow>(
    (from, to) =>
      supabase
        .from("timetable_slots")
        .select("day, period, class_id, class_label, subject_code, staff_profile_id, teacher_short_name, shared, parallel")
        .eq("version_id", version.id)
        .ilike("day", `%${stem}%`)
        .order("day")
        .order("period")
        .order("class_label")
        .order("teacher_short_name")
        .range(from, to)
        .returns<DaySlotRow[]>(),
    "the timetable",
  );
  const header = matchDayHeader([...new Set(rows.map((row) => row.day))], day);
  if (!header) return [];
  return rows
    .filter((row) => row.day === header)
    .map((row) => ({
      period: row.period,
      classId: row.class_id,
      classLabel: row.class_label,
      subjectCode: row.subject_code,
      staffProfileId: row.staff_profile_id,
      teacherShortName: row.teacher_short_name,
      shared: row.shared,
      parallel: row.parallel,
    }));
}

type SupportRow = {
  status: string;
  needs_follow_up: boolean | null;
  follow_up_on: string | null;
  tags: string[] | null;
  visibility: string | null;
  written_by: string;
  follow_up_staff_id: string | null;
  note_kinds: { code: string } | null;
};

/**
 * The notes board's "Need action" figure for a school-wide reader: open and
 * working notes this session, minus other people's private ones (the same
 * rule as `canSeeNote()`). A count only — no child is named on Today.
 */
async function supportFor(staff: CurrentStaff, sessionLabel: string, today: string): Promise<{ needsAction: number; due: number }> {
  const admin = createAdminClient();
  const rows = await fetchAllRows<SupportRow>(
    (from, to) =>
      admin
        .from("notes")
        .select("status, needs_follow_up, follow_up_on, tags, visibility, written_by, follow_up_staff_id, note_kinds(code)")
        .eq("session_label", sessionLabel)
        .neq("status", "done")
        .order("created_at")
        .order("id")
        .range(from, to)
        .returns<SupportRow[]>(),
    "the notes",
  );
  return supportAttention(
    rows
      .map((row) => {
        const own = (row.tags ?? []).filter(isTag);
        return { row, tags: own.length ? own : tagsFromKind(row.note_kinds?.code) };
      })
      // `canSeeNote()` for a school-wide reader: other people's private notes
      // never, and health or family notes only for the admin (D-264).
      .filter(({ row, tags }) => {
        if (row.written_by === staff.id) return true;
        if (row.visibility === "private") return false;
        if (row.follow_up_staff_id === staff.id) return true;
        return staff.role === "admin" || !isSensitiveNote({ tags });
      })
      .map(({ row, tags }) => {
        return {
          status: row.status === "working" || row.status === "done" ? row.status : "open",
          needsFollowUp: Boolean(row.needs_follow_up),
          followUpOn: row.follow_up_on,
          tags,
        };
      }),
    today,
  );
}

/**
 * The school calendar's timed events today (an assembly, a PTM), for Today's
 * timeline beside the bells. Cancelled events are left out; all-day ones have
 * no place on a timeline and stay on the calendar.
 */
async function timedEventsOn(sessionLabel: string, day: string): Promise<{ time: string; title: Pair; sub: Pair | null }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .select("title, title_hi, starts_at, place, all_day, cancelled_at")
    .eq("session_label", sessionLabel)
    .lte("starts_on", day)
    .gte("ends_on", day)
    .is("cancelled_at", null)
    .eq("all_day", false)
    .order("starts_at")
    .returns<{ title: string; title_hi: string | null; starts_at: string | null; place: string | null }[]>();
  if (error) throw new Error(`Could not read the calendar events: ${error.message}`);
  return data
    .filter((row) => row.starts_at)
    .map((row) => ({ time: row.starts_at!.slice(0, 5), title: p(row.title, row.title_hi ?? row.title), sub: row.place ? p(row.place) : null }));
}

/** What a Today without the register board still needs: the bells, and whether the school teaches today. */
type DayFrame = {
  bells: BoardData["bells"];
  schoolOpen: boolean;
  timetableRuns: boolean;
  classRank: Map<string, number>;
};

async function dayFrame(sessionLabel: string, day: string): Promise<DayFrame> {
  const [labels, calendar, bells] = await Promise.all([classLabelMap(sessionLabel), schoolCalendar(sessionLabel), currentBells(sessionLabel)]);
  return {
    bells: bells.periods.map((period) => ({ index: period.index, starts: period.starts, ends: period.ends })),
    schoolOpen: isSchoolOpen(day, calendar),
    timetableRuns: timetableRuns(day, calendar),
    classRank: rankOf(labels),
  };
}

export async function loadToday(staff: CurrentStaff, sessionLabel: string, day: string, nowMinutes: number): Promise<TodayFacts> {
  const missing: string[] = [];
  const seesTimetable = can(staff, "timetable:view");
  // The support count is the school-wide board's; a narrower reader's board is her own classes.
  const seesSupport = can(staff, "notes:view") && (readsEveryClass(staff) || can(staff, "attendance:correct"));
  const seesCover = can(staff, "substitutions:view");
  // The register board is attendance. A reader without `attendance:view` (the
  // view-only account) used to get one anyway: the calendar read was refused
  // ("could not be read" on Today) and RLS hid every register, so the board
  // said all 19 classes were unmarked (admin B6). That reader gets the day's
  // frame — bells, open or closed — for the timeline and "who teaches now".
  const seesBoard = can(staff, "attendance:view");
  const [board, bare, absences, duties, slots, support, people, events] = await Promise.all([
    seesBoard ? guard(missing, "board", () => loadBoard(sessionLabel, day)) : Promise.resolve(null),
    seesBoard ? Promise.resolve(null) : guard(missing, "calendar", () => dayFrame(sessionLabel, day)),
    guard(missing, "absences", () => absencesFor(sessionLabel, day)),
    seesCover ? guard(missing, "cover", async () => liveOnly(await dutiesFor(sessionLabel, day))) : Promise.resolve(null),
    seesTimetable ? guard(missing, "timetable", () => slotsForDay(sessionLabel, day)) : Promise.resolve(null),
    seesSupport ? guard(missing, "notes", () => supportFor(staff, sessionLabel, day)) : Promise.resolve(null),
    // Names for the scheduled teachers and whoever covers, read beside the rest rather than after it.
    seesTimetable || seesCover ? guard(missing, "staff", () => staffList()) : Promise.resolve(null),
    can(staff, "academics:view") ? guard(missing, "events", () => timedEventsOn(sessionLabel, day)) : Promise.resolve(null),
  ]);
  if (board) missing.push(...board.unavailable);
  const frame: DayFrame | null = board
    ? { bells: board.bells, schoolOpen: board.schoolOpen, timetableRuns: board.timetableRuns, classRank: new Map(board.rows.map((row) => [row.classId, row.rank])) }
    : bare;

  const nameOf = new Map((people ?? []).map((person) => [person.id, person.displayName]));
  const awayName = new Map((absences ?? []).map((row) => [row.staffProfileId, row.staffName]));

  const schedule =
    seesTimetable && frame && slots
      ? scheduleNow({
          bells: frame.bells,
          nowMinutes,
          schoolOpen: frame.schoolOpen,
          timetableRuns: frame.timetableRuns,
          slots,
          duties: duties ?? [],
          absences: absences ?? [],
          names: nameOf,
          classRank: frame.classRank,
        })
      : null;

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const stateAt = (minutes: number): TimelineItem["state"] => (minutes <= nowMinutes ? "done" : "next");

  const timeline: TimelineItem[] = [];
  const bells = [...(frame?.bells ?? [])].sort((a, b) => toMin(a.starts) - toMin(b.starts));
  if (frame?.schoolOpen && bells.length > 0) {
    const first = bells[0];
    timeline.push({ time: first.starts, title: T.firstBell, sub: T.periodStarts(1), state: stateAt(toMin(first.starts)) });
    if (board) {
      const notMarked = board.rows.filter((row) => !row.recorded).length;
      timeline.push({
        time: first.ends,
        title: T.attendanceCloses,
        sub: T.notMarkedYet(notMarked),
        state: notMarked > 0 && toMin(first.ends) <= nowMinutes ? "alert" : stateAt(toMin(first.ends)),
      });
    }
    for (const duty of duties ?? []) {
      const bell = bells.find((b) => b.index === duty.period);
      if (!bell) continue;
      const title = p(`Period ${duty.period + 1} · ${duty.classLabels.join(", ")} ${duty.subjectCode}`, `पीरियड ${duty.period + 1} · ${duty.classLabels.join(", ")} ${duty.subjectCode}`);
      timeline.push({
        time: bell.starts,
        title,
        sub: duty.status === "needs_help" ? T.needsSubstitute : T.coveredBy(duty.coveringStaffId ? (nameOf.get(duty.coveringStaffId) ?? "—") : "—"),
        state: duty.status === "needs_help" ? "alert" : toMin(bell.starts) <= nowMinutes ? "done" : "next",
      });
    }
    for (const event of events ?? []) {
      timeline.push({ time: event.time, title: event.title, sub: event.sub ?? undefined, state: stateAt(toMin(event.time)) });
    }
    const last = bells[bells.length - 1];
    timeline.push({ time: last.ends, title: T.lastBell, state: stateAt(toMin(last.ends)) });
    timeline.sort((a, b) => toMin(a.time) - toMin(b.time));
    // "Now" is the first item still ahead.
    const nextIndex = timeline.findIndex((item) => item.state === "next");
    if (nextIndex >= 0) timeline[nextIndex] = { ...timeline[nextIndex], state: "now" };
  }

  const coverExceptions: CoverException[] | null =
    duties === null
      ? null
      : [...duties]
          .sort((a, b) => a.period - b.period || (a.status === b.status ? 0 : a.status === "needs_help" ? -1 : 1))
          .map((duty) => ({
            period: duty.period,
            time: bells.find((b) => b.index === duty.period)?.starts ?? null,
            classes: duty.classLabels.join(", "),
            subject: duty.subjectCode,
            away: duty.absentStaffIds.map((id) => awayName.get(id) ?? nameOf.get(id) ?? "—").join(", "),
            state: duty.status === "needs_help" ? "needed" : "covered",
            by: duty.coveringStaffId ? (nameOf.get(duty.coveringStaffId) ?? "—") : null,
          }));

  return {
    board,
    staffAway: absences === null ? null : new Set(absences.map((row) => row.staffProfileId)).size,
    cover: duties === null ? null : coverToday(duties, slots ?? [], absences ?? []),
    timeline,
    schedule,
    scheduleFailed: seesTimetable && schedule === null,
    exceptions: {
      // An unsaved register is "Not marked", never present (RULES C).
      notMarked: board && board.schoolOpen ? board.rows.filter((row) => !row.recorded).map((row) => row.label) : null,
      cover: coverExceptions,
    },
    support,
    unavailable: [...new Set(missing)],
  };
}

/**
 * "Attendance this week" (F01): each school day before today with its
 * whole-school tally, counted as the board counts today — saved daily
 * registers only, late as present. A day with nothing saved has no tally
 * (null), never a nought (RULES C). Read beside the board, so the half-day
 * credit is applied by the caller with `dayPercent()`.
 */
export async function weekAttendance(sessionLabel: string, today: string): Promise<{ day: string; tally: { present: number; absent: number; halfDay: number } | null }[]> {
  const days = schoolWeek(today).filter((day) => day < today);
  if (days.length === 0) return [];
  const supabase = await createClient();
  const { data: registers, error } = await supabase
    .from("attendance_registers")
    .select("id, day")
    .eq("session_label", sessionLabel)
    .gte("day", days[0])
    .lte("day", days[days.length - 1])
    .is("period", null)
    .gte("revision", 1)
    .returns<{ id: string; day: string }[]>();
  if (error) throw new Error(`Could not read this week's registers: ${error.message}`);
  // A day at a time: a day's ids fit the URL, and its marks are paged in full.
  return Promise.all(
    days.map(async (day) => {
      const ids = registers.filter((row) => row.day === day).map((row) => row.id);
      if (ids.length === 0) return { day, tally: null };
      const marks = await fetchAllRows<{ status: AttendanceStatus }>(
        (from, to) =>
          supabase
            .from("attendance_marks")
            .select("status, register_id, student_id")
            .in("register_id", ids)
            .order("register_id")
            .order("student_id")
            .range(from, to)
            .returns<{ status: AttendanceStatus }[]>(),
        "this week's marks",
      );
      const t = { present: 0, absent: 0, halfDay: 0 };
      for (const mark of marks) {
        if (mark.status === "present" || mark.status === "late") t.present += 1;
        else if (mark.status === "absent") t.absent += 1;
        else if (mark.status === "half_day") t.halfDay += 1;
      }
      return { day, tally: t };
    }),
  );
}

/**
 * Families who promised on a call to pay today (`vppsone.fee_call_promises`,
 * kind "pay"), counted once per child. For `fees:view` only; RLS holds the
 * same line. Kept or broken is the Dues screen's business, not Today's.
 */
export async function promisedToday(sessionLabel: string, today: string): Promise<number> {
  await assertPermission("fees:view");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fee_call_promises")
    .select("student_id")
    .eq("session_label", sessionLabel)
    .eq("kind", "pay")
    .eq("promised_on", today)
    .returns<{ student_id: string }[]>();
  if (error) throw new Error(`Could not read the promises: ${error.message}`);
  return new Set(data.map((row) => row.student_id)).size;
}

/* ------------------------------------------------------------ Needs you */

const FIELD_CHANGE = (from: string | null, to: string | null) => `${from ?? "—"} → ${to ?? "—"}`;

/**
 * The queue's sources, each started at once (perf fix 2a). They are
 * independent, and the queue used to wait on them one after another — five
 * sequential stages, on every full load of every admin page because the shell
 * counts it for the badge. Each keeps its permission gate here and its own
 * check inside the read.
 */
function inboxSources(staff: CurrentStaff, sessionLabel: string, day: string, refunds: MoneyRequests | undefined, missing: string[]) {
  const parents = parentReaderFor(staff, sessionLabel);
  return Promise.all([
    can(staff, "attendance:mark_on_behalf") ? guard(missing, "board", () => loadBoard(sessionLabel, day)) : Promise.resolve(null),
    // Only the live duties: the whole cover day (the timetable, every slot) is
    // read below, and only when a duty actually needs somebody.
    can(staff, "substitutions:manage")
      ? guard(missing, "cover", async () => liveOnly(await dutiesFor(sessionLabel, day)).filter((duty) => duty.status === "needs_help"))
      : Promise.resolve(null),
    can(staff, "collection:manage") ? guard(missing, "submissions", () => pendingSubmissions()) : Promise.resolve(null),
    refunds ? guard(missing, "refunds", () => moneyRequests(refunds)) : Promise.resolve(null),
    can(staff, "jobs:view") ? guard(missing, "jobs", () => jobsNow()) : Promise.resolve(null),
    can(staff, "substitutions:manage") ? guard(missing, "leave", () => askedLeave(sessionLabel)) : Promise.resolve(null),
    parents ? guard(missing, "parents", async () => (await waitingParents(sessionLabel)).filter((row) => inNeedsYou(row, parents))) : Promise.resolve(null),
    // Toilet charts not uploaded, or checks missed last week (D-652): one item for all of them.
    can(staff, "toilets:view") ? guard(missing, "toilets", () => toiletGaps(sessionLabel, day)) : Promise.resolve(null),
  ] as const);
}

/**
 * How many items Needs you holds, for the sidebar and bottom-bar badge.
 *
 * The same sources as `loadInbox`, counted as it builds them, without the
 * cover candidates (the whole timetable and a month of cover history) that
 * only the list itself shows. On Today and Needs you the page reads the same
 * sources in the same request, so the badge costs nothing there.
 */
export const inboxCount: (staff: CurrentStaff, sessionLabel: string, day: string, refunds?: MoneyRequests, nowMinutes?: number) => Promise<number> = cache(
  async (staff: CurrentStaff, sessionLabel: string, day: string, refunds?: MoneyRequests, nowMinutes?: number): Promise<number> => {
    const [board, needing, pending, money, jobs, leave, parents, toilets] = await inboxSources(staff, sessionLabel, day, refunds, []);
    const { changes, confirmations } = pending && pending.length > 0 ? splitByChange(pending.filter(s=>s.fieldKey!=="student_photo"&&(staff.role==="admin"||!s.requiresAdmin))) : { changes: [], confirmations: [] };
    return inboxBadgeCount({
      notMarked: Boolean(board && board.schoolOpen && board.rows.some((row) => !row.recorded) && registerLate(board.bells, nowMinutes ?? schoolMinutes(new Date()))),
      coverNeeded: needing?.length ?? 0,
      changes: changes.length,
      confirmations: confirmations.length,
      refunds: money?.length ?? 0,
      failedJobs: [...(jobs?.latest.values() ?? [])].filter((entry) => entry.status === "failed").length,
      leave: leave?.length ?? 0,
      parents: parents?.length ?? 0,
      toilets: Boolean(toilets),
    });
  },
);

export function loadInbox(
  staff: CurrentStaff,
  sessionLabel: string,
  day: string,
  extra: { refunds?: MoneyRequests; nowMinutes?: number } = {},
): Promise<{ items: InboxItem[]; unavailable: string[] }> {
  return inboxFor(staff, sessionLabel, day, extra.refunds, extra.nowMinutes ?? schoolMinutes(new Date()));
}

/** Once per request: Today's page and the shell both ask (perf fix 1). */
const inboxFor = cache(readInbox);

async function readInbox(
  staff: CurrentStaff,
  sessionLabel: string,
  day: string,
  refundsReader: MoneyRequests | undefined,
  nowMinutes: number,
): Promise<{ items: InboxItem[]; unavailable: string[] }> {
  const missing: string[] = [];
  const items: InboxItem[] = [];
  const nowIso = new Date().toISOString();

  const [board, needing, pending, refunds, jobs, leave, parents, toilets] = await inboxSources(staff, sessionLabel, day, refundsReader, missing);

  /* attendance not marked */
  if (board && board.schoolOpen) {
    const open = board.rows.filter((row) => !row.recorded);
    const first = [...board.bells].sort((a, b) => a.starts.localeCompare(b.starts))[0];
    // Late only once the first period is over, and never after the school day:
    // "19 classes not marked" at 0:02 invited a WhatsApp to 19 teachers at midnight (smoke run, 20 Oct).
    if (open.length > 0 && registerLate(board.bells, nowMinutes)) {
      const sendable = remindable(board.rows);
      items.push({
        id: `not-marked:${day}`,
        type: "attendance",
        kind: "not_marked",
        at: nowIso,
        urgent: true,
        badge: T.bAttendance,
        title: T.notMarkedTitle(open.length),
        sub: first ? p(`Period 1 ends ${first.ends}`, `पीरियड 1 ${first.ends} पर ख़त्म`) : p(open.map((row) => row.label).join(", ")),
        body: T.notMarkedBody,
        facts: [
          { label: T.classes, value: open.map((row) => row.label).join(", ") },
          ...open
            .filter((row) => row.teacherAway)
            .slice(0, 3)
            .map((row) => ({ label: T.teacherOnLeave, value: `${row.label} · ${row.teacherName ?? "—"}` })),
        ],
        href: "/attendance?f=pending",
        classIds: open.map((row) => row.classId),
        remindable: sendable.length,
        day,
      });
    }
  }

  /* cover that needs help */
  if (needing && needing.length > 0) {
    const cover = await guard(missing, "cover", async () => {
      const coverDay = await readCoverDay(sessionLabel, day);
      const helpWanted = coverDay.live.filter((duty) => duty.status === "needs_help");
      if (helpWanted.length === 0) return [];
      const profiles = await profilesFor(coverDay);
      // Teaching staff only, and two people with one name told apart (Dev 4, school-day run B13/B14).
      const nameOf = distinctNames(coverDay.staff);
      for (const absence of coverDay.absences) if (!nameOf.has(absence.staffProfileId)) nameOf.set(absence.staffProfileId, absence.staffName);
      const eligible = coverEligibleIds(coverDay.staff, coverDay.slots);
      return helpWanted.map((duty) => {
        const candidates = candidatesFor(coverDay, profiles.everyone, profiles.history, duty).filter((candidate) => eligible.has(candidate.teacher)).map((candidate) => ({
          id: candidate.teacher,
          name: nameOf.get(candidate.teacher) ?? "—",
          detail: `${candidate.load.regular} periods today${candidate.recentCovers ? ` · ${candidate.recentCovers} covers this month` : ""}`,
          free: candidate.blocked.length === 0,
        }));
        const bell = coverDay.bells.periods.find((b) => b.index === duty.period);
        const away = duty.absentStaffIds.map((id) => nameOf.get(id) ?? "—").join(", ");
        const free = candidates.filter((c) => c.free);
        const item: InboxItem = {
          id: `cover:${duty.needKey}`,
          type: "timetable",
          kind: "cover",
          at: duty.createdAt,
          urgent: true,
          badge: T.bCover,
          title: T.coverTitle(duty.period + 1, duty.classLabels.join(", "), duty.subjectCode),
          sub: T.coverSub(away, free.length),
          body: T.coverBody(away, free.length),
          facts: [
            { label: T.period, value: bell ? `${duty.period + 1} · ${bell.starts} – ${bell.ends}` : String(duty.period + 1) },
            { label: T.onLeave, value: away },
            { label: T.freeThen, value: free.slice(0, 3).map((c) => c.name).join(", ") || "—" },
            { label: T.onAssign, value: T.onAssignValue.en },
          ],
          footnote: T.coverFootnote,
          href: `/substitutions?day=${day}`,
          needKey: duty.needKey,
          day,
          dayRevision: coverDay.dayRevision,
          candidates,
        };
        return item;
      });
    });
    items.push(...(cover ?? []));
  }

  /* answers waiting to be checked */
  if (pending && pending.length > 0) {
    const { changes, confirmations } = splitByChange(pending.filter(s=>s.fieldKey!=="student_photo"&&(staff.role==="admin"||!s.requiresAdmin)));
    for (const s of changes.slice(0, SUBMISSION_ITEMS_MAX)) {
      items.push({
        id: `submission:${s.id}`,
        type: "students",
        kind: "submission",
        at: s.submittedAt,
        urgent: false,
        badge: T.bSubmission,
        title: p(`${s.fieldLabelEn} · ${s.studentName}`, `${s.fieldLabelHi || s.fieldLabelEn} · ${s.studentName}`),
        sub: T.submissionSub(s.classLabel, s.submittedByName ?? "—"),
        facts: [
          { label: T.was, value: s.previousValue ?? "—" },
          { label: T.becomes, value: s.value ?? "—" },
          { label: T.change, value: FIELD_CHANGE(s.previousValue, s.value) },
        ],
        href: "/collection/review",
        submissionIds: [s.id],
      });
    }
    if (confirmations.length > 0) {
      items.push({
        id: "confirmations",
        type: "students",
        kind: "confirmations",
        at: confirmations[0]?.submittedAt ?? null,
        urgent: false,
        badge: T.bSubmission,
        title: T.confirmationsTitle(confirmations.length),
        sub: T.confirmationsSub,
        facts: confirmations.slice(0, 6).map((s) => ({ label: p(s.studentName), value: `${s.fieldLabelEn}: ${s.value ?? "—"}` })),
        href: "/collection/review",
        submissionIds: confirmations.map((s) => s.id),
      });
    }
  }

  /* refunds (fee screen decides them) */
  for (const r of refunds ?? []) {
    const amount = `₹${new Intl.NumberFormat("en-IN").format(Math.round(r.amount))}`;
    items.push({
      id: `refund:${r.id}`,
      type: "money",
      kind: "refund",
      at: r.requestedAt,
      // Money that has waited more than two days on the admin is marked urgent.
      urgent: Date.now() - Date.parse(r.requestedAt) > 2 * 86_400_000,
      badge: r.deskKind === "reversal" ? p("Reversal", "रसीद रद्द") : r.deskKind === "write_off" ? p("Write-off", "माफ़ी") : r.title && !r.id.startsWith("fees:") ? p("Accounts", "हिसाब") : T.bRefund,
      title:
        r.deskKind === "reversal"
          ? p(`Reverse receipt ${r.receiptNumber ?? ""} · ${amount} · ${r.studentName}`.replace("  ", " "), `रसीद ${r.receiptNumber ?? ""} रद्द · ${amount} · ${r.studentName}`.replace("  ", " "))
          : r.deskKind === "write_off"
            ? p(`Write off ${amount} · ${r.studentName}`, `${amount} माफ़ · ${r.studentName}`)
            : r.title
              ? p(`${r.title.en}${r.amount ? ` · ${amount}` : ""} · ${r.studentName}`, `${r.title.hi ?? r.title.en}${r.amount ? ` · ${amount}` : ""} · ${r.studentName}`)
              : T.refundTitle(amount, r.studentName),
      sub: r.reasonText ?? p(r.reason ?? "—"),
      facts: [
        { label: p("Amount", "राशि"), value: amount },
        { label: T.reason, value: r.reasonText?.en ?? r.reason ?? "—" },
      ],
      footnote: r.deskKind || r.title ? p("Decided on the receipt, dues or accounts screen; nothing moves until you decide it there.", "फ़ैसला रसीद, बकाया या हिसाब स्क्रीन पर होता है; वहाँ तय किए बिना कुछ नहीं बदलता।") : T.refundFootnote,
      href: r.href ?? "/fees/finance-controls",
      ...(r.feesRefund ? { feesRefund: r.feesRefund } : {}),
    });
  }

  /* leave asked, not yet decided: who, which days, since when; decided on the timetable */
  for (const r of leave ?? []) {
    const span = LEAVE_SPAN[r.span] ?? LEAVE_SPAN.full;
    items.push({
      id: `leave:${r.id}`,
      type: "timetable",
      kind: "leave",
      at: r.askedAt,
      // Leave for today or tomorrow needs an answer before cover can be arranged;
      // leave whose days have all gone is not urgent, it is late, and says so.
      urgent: r.toDay >= day && r.fromDay <= addDays(day, 1),
      badge: p("Leave", "छुट्टी"),
      title: p(`Leave asked · ${r.staffName}`, `छुट्टी का आवेदन · ${r.staffName}`),
      sub:
        r.toDay < day
          ? p(`${leaveDays(r).en} · ${span.en} · the days have passed`, `${leaveDays(r).hi} · ${span.hi} · ये दिन बीत चुके`)
          : p(`${leaveDays(r).en} · ${span.en}`, `${leaveDays(r).hi} · ${span.hi}`),
      // The days and the part of the day are in the sub-line; the teacher's note is the reason.
      facts: r.note ? [{ label: T.reason, value: r.note }] : [],
      footnote:
        r.toDay < day
          ? p("Its days have passed: record it as taken, or decline it. No cover is arranged for a day gone.", "इसके दिन बीत चुके हैं: ली गई दर्ज करें, या अस्वीकार करें। बीते दिन की व्यवस्था नहीं होती।")
          : p("Approving marks the teacher away and arranges cover for each school day; the answer says how many periods have a teacher.", "स्वीकार करने पर शिक्षक अनुपस्थित दर्ज होते हैं और हर स्कूल-दिन की व्यवस्था होती है; जवाब बताता है कितने पीरियड में शिक्षक तय हुए।"),
      leaveId: r.id,
      leavePast: r.toDay < day,
      href: "/timetable?view=leave",
    });
  }

  /*
   * A parent's suggestions (D-598): what Veer Patta AI read on WhatsApp that
   * may belong in a record. Decided here at once (Leave or Absent, Add to
   * Admissions, Apply, Not now) and undone from the toast or Decided today.
   */
  if (parents && parents.length > 0) {
    const views = await guard(missing, "parents", () => parentNoteViews(parents, sessionLabel, day));
    const opensChild = can(staff, "students:view");
    const opensAdmissions = can(staff, "fees:manage");
    for (const view of views ?? []) {
      items.push({
        // Undone, it waits again as a new item: the one decided here stays hidden.
        id: `parent:${view.key}`,
        type: view.kind === "absence" ? "attendance" : "students",
        kind: "parent",
        at: view.createdAt,
        urgent: view.urgent,
        badge: SUGGESTION_WORDS.badge,
        title: view.title,
        sub: view.line,
        facts: [],
        footnote: SUGGESTION_FOOTNOTES[view.kind],
        href: view.kind === "visit" ? (opensAdmissions ? "/admissions" : undefined) : view.studentId && opensChild ? `/students/${view.studentId}` : undefined,
        parent: {
          suggestionId: view.id,
          kind: view.kind,
          studentId: view.studentId,
          childName: view.childName,
          classLabel: view.classLabel,
          words: view.words,
          change: view.change,
          phone: view.phone,
          practice: view.practice,
        },
      });
    }
  }

  /* toilet charts not uploaded, or checks missed (D-652) */
  if (toilets) {
    items.push({
      id: `toilets:${day}`,
      type: "system",
      kind: "toilets",
      at: toilets.oldestLate ? `${toilets.oldestLate}T09:00:00+05:30` : nowIso,
      // A chart a whole week late is urgent; today's upload and missed checks are not.
      urgent: toilets.late > 0,
      badge: T.bToilets,
      title: T.toiletsTitle(toilets.late, toilets.dueToday, toilets.missed),
      sub: T.toiletsSub,
      facts: [
        ...(toilets.dueToday ? [{ label: T.toiletsDue, value: String(toilets.dueToday) }] : []),
        ...(toilets.late ? [{ label: T.toiletsLate, value: String(toilets.late) }] : []),
        ...(toilets.missed ? [{ label: T.toiletsMissed, value: String(toilets.missed) }] : []),
      ],
      href: "/toilets",
    });
  }

  /* jobs that failed */
  for (const run of [...(jobs?.latest.values() ?? [])].filter((entry) => entry.status === "failed")) {
    items.push({
      id: `job:${run.id}`,
      type: "system",
      kind: "job",
      at: run.finishedAt ?? run.startedAt,
      urgent: false,
      badge: T.bJob,
      title: T.jobTitle(run.job),
      sub: p(run.error ?? "—"),
      facts: [{ label: p("Error", "त्रुटि"), value: run.error ?? "—" }],
      href: "/jobs",
    });
  }

  return { items, unavailable: missing };
}

/* --------------------------------------------------------- Student 360 */

export type StudentSchool = {
  unavailable: string[];
  card: StudentCard;
  classId: string | null;
  classLabel: string;
  rollNo: string | null;
  attendance: { day: string; status: MarkStatus }[];
  attendancePercent: number | null;
  attendanceCounted: number;
  halfDayCredit: number;
  closedDays: string[];
  terms: TermSummary[];
  documents: StudentDocument[];
  history: RecordChange[];
};

export async function loadStudentSchool(staff: CurrentStaff, studentId: string, sessionLabel: string): Promise<StudentSchool | null> {
  await assertPermission("students:view");
  // A configurable students:view grant does not widen a teacher's class scope.
  const [card, enrolment, scope] = await Promise.all([
    getStudentCard(studentId), enrolmentForStudent(studentId, sessionLabel), classScopeFor(staff, sessionLabel),
  ]);
  // Scoped readers need an accessible placement in this session. The legacy
  // public class_id cannot override a moved or RLS-hidden current enrolment.
  if (!card || (!scope.everyClass && !scopeIncludes(scope, enrolment?.classId))) return null;
  const missing: string[] = [];
  const [labels, attendance, rules, calendar, terms, documents, history] = await Promise.all([
    classLabelMap(sessionLabel),
    guard(missing, "attendance", () => studentAttendance(studentId, sessionLabel)),
    guard(missing, "rules", () => attendanceRules(sessionLabel)),
    guard(missing, "calendar", () => attendanceCalendar(sessionLabel)),
    can(staff, "marks:view") ? guard(missing, "marks", () => termSummaries(studentId, sessionLabel)) : Promise.resolve(null),
    can(staff, "documents:view") ? guard(missing, "documents", () => documentsForStudent(studentId)) : Promise.resolve(null),
    can(staff, "collection:view") ? guard(missing, "history", () => historyForStudent(studentId)) : Promise.resolve(null),
  ]);

  const credit = rules?.halfDayCredit ?? 0.5;
  // As the register sheet counts: leave is left out, late counts as present.
  const counted = (attendance ?? []).filter((row) => row.status === "present" || row.status === "late" || row.status === "absent" || row.status === "half_day");
  const presentCredit = counted.reduce((sum, row) => sum + (row.status === "present" || row.status === "late" ? 1 : row.status === "half_day" ? credit : 0), 0);
  const classId = enrolment?.classId ?? card.classId;

  return {
    card,
    unavailable: missing,
    classId,
    classLabel: classId ? (labels.get(classId) ?? "—") : "—",
    rollNo: enrolment?.rollNo ?? card.rollNo,
    attendance: (attendance ?? []).map((row) => ({ day: row.day, status: row.status })),
    attendancePercent: counted.length ? Math.round((presentCredit / counted.length) * 100) : null,
    attendanceCounted: counted.length,
    halfDayCredit: credit,
    closedDays: calendar ? [...calendar.keys()].filter((d) => !isSchoolOpen(d, calendar)) : [],
    terms: terms ?? [],
    documents: documents ?? [],
    history: history ?? [],
  };
}

export { boardSummary };
