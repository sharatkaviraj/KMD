import "server-only";
import { readParentSwitches } from "@/vx/screens/settings/parent-switches";
import { approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
import { loadWhatsappLink, type WhatsappLinkView } from "@/modules/whatsapp/data/staff-link";
import { staffLanguage } from "@/modules/whatsapp/domain/helper-handoff";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { isTestSessionLabel, staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { schoolNow } from "@/platform/auth/qa-clock";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { logWarn } from "@/platform/observability/log";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { classLabelMap, listSubjects, resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { isSchoolOpen, timetableRuns } from "@/modules/academics/domain/calendar";
import { rankOf } from "@/modules/academics/domain/class-order";
import { listAssessments, marksForPapers, papersForClass } from "@/modules/assessments/data/assessments-repo";
import {
  attendanceCalendar,
  attendanceRules,
  classAttendanceRange,
  classRoll,
  findRegister,
  latestReceipt,
  listMarks,
  registersForDay,
  rosterOn,
  studentAttendance,
} from "@/modules/attendance/data/attendance-repo";
import { parentNotesFor, type ParentNoteReason } from "@/modules/attendance/data/parent-notes";
import { waitingAbsencesOn } from "@/modules/whatsapp/data/parent-suggestions";
import { registerAskLine } from "@/modules/whatsapp/domain/parent-suggestions";
import { attendanceScopeFor, classScopeFor, dayHeaders, heldClassIds, ownClassIds, periodsOn } from "@/modules/attendance/data/teaching-repo";
import { attendancePercent, compareRoll, registerAuthority, type AttendanceStatus } from "@/modules/attendance/domain/attendance";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { lessonsToday } from "@/modules/attendance/domain/today";
import { getStudentCard, enrolmentForStudent } from "@/modules/students/data/student-repo";
import { myDutiesOn, myEndedDuties, type EndedDutyWhy } from "@/modules/substitutions/data/duty-repo";
import { reportsForAbsent, reportsOnDuties } from "@/modules/substitutions/data/cover-reports";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import { schoolClock, type BellSchedule } from "@/modules/timetable/domain/bells";
import { periodNumber } from "@/modules/timetable/domain/periods";
import { matchDayHeader } from "@/modules/timetable/domain/weekday";
import { getPublishedVersion, listSlots } from "@/modules/timetable/data/timetable-repo";
import { schoolToday } from "@/vx/format";
import { currentExam, enrolmentsFor, listExams, marksLinkUrl, papersOf, remarksFor, trackerFor, type Exam } from "@/vx/screens/exams/data";
import { openExamsForMarks } from "@/vx/screens/exams/domain/current";
import { subjectNamer, subjectWords } from "@/vx/screens/exams/domain/groups";
import { noteViewer, notesForStudent, visibleNotes } from "@/vx/screens/notes/data";
import { excerpt, noteSubject, type BoardNote } from "@/vx/screens/notes/domain/notes";
import { addDays } from "@/vx/screens/academics/domain";

import { listTeacherTasks } from "@/modules/teacher-tasks/data/repo";
import type { CalendarDayKind } from "@/modules/academics/domain/calendar";
import { classTeacherOf } from "@/vx/screens/exams/guards";
import { onRoll } from "@/vx/screens/exams/domain/tracker";
import { p, type Pair } from "@/vx/text";
import { getViewer } from "@/vx/view-as";

import { alertWhen, attentionReasons, average, dayBefore, mergeCombinedSlots, monthEnd, tellApart, upcomingBirthdays, withoutAttendance, type AttentionReason, type Mark } from "./domain/teach";
import { closedTag, closedWhy, examWord, joinPairs, lastOpenDay, leaveForToday, openNotesP, profileClasses, remarksLeft, type CalendarEntry, type ClosedWhy, type MyCover } from "./domain/today";
import { childBasics, staffNames } from "./students";

/*
 * What the teacher screens read. Every function is called from a page that
 * has already passed `requirePermission()`; the repos below check their own
 * permission again, and the cookie client's RLS bounds the rows. Nothing on
 * these screens reads money (RULES A: teachers never see fees).
 */

function timeOf(bells: BellSchedule, index: number): { starts: string; ends: string } {
  const p = bells.periods.find((b) => b.index === index);
  return { starts: p?.starts ?? "", ends: p?.ends ?? "" };
}

/**
 * Today's counts for a saved register: from its save receipt, or, when it has
 * none (registers written before revisions were kept), from its own marks.
 * Without the fallback a fully marked class read "0/39 present".
 */
async function registerTotals(registerId: string, receipt: Awaited<ReturnType<typeof latestReceipt>> | null) {
  if (receipt?.totals) return receipt.totals;
  const marks = await listMarks(registerId).catch(() => null);
  if (!marks) return undefined;
  const t = { present: 0, absent: 0, half_day: 0, late: 0, leave: 0, total: marks.size };
  for (const m of marks.values()) if (m.status in t) t[m.status as keyof Omit<typeof t, "total">] += 1;
  return t;
}

/* ------------------------------------------------------------ the notices */

export type StaffNotice = { id: string; title: string; bodyHi: string | null; bodyEn: string | null; createdAt: string; fromName: string; seen: boolean; kind: string };

/** Notices the office sent to staff (message_campaigns, audience staff), with this reader's "Got it". */
export async function staffNotices(staffId: string, sessionLabel: string, limit = 30): Promise<StaffNotice[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("message_campaigns")
    .select("id, kind, title, body_hi, body_en, created_by, created_at, status, audience")
    .eq("session_label", sessionLabel)
    .eq("audience", "staff")
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; kind: string; title: string | null; body_hi: string | null; body_en: string | null; created_by: string | null; created_at: string }[]>();
  if (error || !data?.length) return [];
  const [reads, names] = await Promise.all([
    fetchInChunks<{ campaign_id: string }>(
      data.map((d) => d.id),
      IN_FILTER_CHUNK_SIZE,
      (chunk) => admin.from("staff_notice_reads").select("campaign_id").eq("staff_profile_id", staffId).in("campaign_id", chunk),
    ),
    staffNames(data.map((d) => d.created_by ?? "")),
  ]);
  const seen = new Set(reads.data.map((r) => r.campaign_id));
  return data.map((d) => ({
    id: d.id,
    kind: d.kind,
    title: d.title ?? "Notice",
    bodyHi: d.body_hi,
    bodyEn: d.body_en,
    createdAt: d.created_at,
    fromName: d.created_by ? (names.get(d.created_by) ?? "Office") : "Office",
    seen: seen.has(d.id),
  }));
}

/* ------------------------------------------------------- the calendar */

/**
 * The calendar's rows for a range of days, with the names the office typed
 * ("Dussehra"). The cached calendar carries only each day's kind, and Today
 * said "No school today" with no reason (smoke 20 Oct).
 */
async function calendarNames(sessionLabel: string, from: string, to: string): Promise<Map<string, CalendarEntry>> {
  const { data } = await createAdminClient()
    .from("academic_calendar_days")
    .select("day, kind, label_en, label_hi")
    .eq("session_label", sessionLabel)
    .gte("day", from)
    .lte("day", to)
    .returns<{ day: string; kind: CalendarDayKind; label_en: string | null; label_hi: string | null }[]>();
  return new Map((data ?? []).map((r) => [r.day, { kind: r.kind, labelEn: r.label_en, labelHi: r.label_hi }]));
}

/** A closed day ahead, for the leave form's day chips: "Holiday · Dussehra". */
export type ClosedDay = { day: string; tag: Pair };

/** The closed days from `today` for the next `span` days, with why. */
function closedDaysAhead(today: string, calendar: Map<string, CalendarDayKind>, names: Map<string, CalendarEntry>, span = 14): ClosedDay[] {
  const out: ClosedDay[] = [];
  let d = today;
  for (let i = 0; i < span; i += 1) {
    if (!isSchoolOpen(d, calendar)) {
      const why = closedWhy(d, false, names.get(d));
      if (why) out.push({ day: d, tag: closedTag(why) });
    }
    d = addDays(d, 1);
  }
  return out;
}

/* --------------------------------------------------------- her leave */

export type LeaveItem = {
  id: string;
  from_day: string;
  to_day: string;
  span: string;
  note: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  /** Who takes each of her periods while she is away; empty until the office arranges it. */
  covers: MyCover[];
};

type LeaveRow = { id: string; from_day: string; to_day: string; span: string; note: string | null; status: string; created_at: string; decided_by: string | null; decided_at: string | null };

/**
 * Her leave requests with who answered and, for each day, who covers her
 * periods ("who takes my class?", smoke 20 Oct): the live cover duties that
 * name her as the absent teacher.
 */
async function withCovers(staffId: string, sessionLabel: string, rows: LeaveRow[]): Promise<LeaveItem[]> {
  const live = rows.filter((r) => r.status === "approved" || r.status === "asked");
  const from = live.reduce((m, r) => (m && m < r.from_day ? m : r.from_day), "");
  const to = live.reduce((m, r) => (m > r.to_day ? m : r.to_day), "");
  type DutyRow = { day: string; period: number; class_labels: string[]; covering_staff_id: string | null; status: string };
  const duties: DutyRow[] = from
    ? await createAdminClient()
        .from("cover_duties")
        .select("day, period, class_labels, covering_staff_id, status")
        .eq("session_label", sessionLabel)
        .contains("absent_staff_ids", [staffId])
        .in("status", ["assigned", "needs_help"])
        .gte("day", from)
        .lte("day", to)
        .order("day")
        .order("period")
        .returns<DutyRow[]>()
        .then((r) => r.data ?? [], () => [] as DutyRow[])
    : [];
  const names = await staffNames([...rows.map((r) => r.decided_by ?? ""), ...duties.map((d) => d.covering_staff_id ?? "")]).catch(() => new Map<string, string>());
  return rows.map((r) => ({
    id: r.id,
    from_day: r.from_day,
    to_day: r.to_day,
    span: r.span,
    note: r.note,
    status: r.status,
    created_at: r.created_at,
    decided_at: r.decided_at,
    decided_by_name: r.decided_by ? (names.get(r.decided_by) ?? null) : null,
    covers: duties
      .filter((d) => d.day >= r.from_day && d.day <= r.to_day)
      .map((d) => ({ day: d.day, number: periodNumber(d.period), classLabels: d.class_labels ?? [], coverName: d.status === "assigned" && d.covering_staff_id ? (names.get(d.covering_staff_id) ?? null) : null })),
  }));
}

/**
 * Her leave rows, newest first: in sessions of the kind she is looking at, so
 * a practice-day leave recorded against a real teacher in TEST never shows in
 * her real year (owner, 8 Nov 2026).
 */
async function myLeaveRows(staffId: string, limit: number, sessionLabel: string): Promise<LeaveRow[]> {
  const query = createAdminClient()
    .from("teacher_leave")
    .select("id, from_day, to_day, span, note, status, created_at, decided_by, decided_at")
    .eq("staff_profile_id", staffId);
  const sameKind = isTestSessionLabel(sessionLabel)
    ? query.or("session_label.ilike.TEST-*,session_label.ilike.UAT-*,session_label.ilike.DEMO-*")
    : query.not("session_label", "ilike", "TEST-*").not("session_label", "ilike", "UAT-*").not("session_label", "ilike", "DEMO-*");
  const { data } = await sameKind
    .order("from_day", { ascending: false })
    .limit(limit)
    .returns<LeaveRow[]>();
  return data ?? [];
}

/* ------------------------------------------------------ office tasks */

export type WaitingTask = { id: string; title: string; href: string; dueDate: string | null };

/**
 * The office's tasks still waiting on her (missing details, photos), for
 * Today and More. Attendance and marks have their own cards, so only the
 * office's own requests; a failed read shows nothing rather than a wrong count.
 */
async function waitingTasks(now: Date): Promise<WaitingTask[]> {
  const rows = await listTeacherTasks(false, { now, only: ["collection"] }).catch(() => []);
  return rows.filter((t) => t.state === "waiting").map((t) => ({ id: t.id, title: t.title, href: t.href, dueDate: t.dueDate }));
}

/* ------------------------------------------------- report-card remarks */

/**
 * Report-card remarks she still has to write for her own classes, by the
 * marks page's own rule (the current exam's term, children on the roll).
 * More said "Nothing waiting" while 41 were (smoke 20 Oct).
 */
export async function remarksToWrite(staffId: string, sessionLabel: string, today: string): Promise<number> {
  const [mine, exams] = await Promise.all([classTeacherOf(staffId, sessionLabel), listExams(sessionLabel)]);
  const exam = currentExam(exams, today, undefined);
  if (!exam || mine.length === 0) return 0;
  const cards = await Promise.all(
    mine.map(async (classId) => {
      const roll = (await enrolmentsFor(sessionLabel, [classId])).filter((e) => onRoll(e, { startsOn: today, endsOn: today }, today));
      const remarks = await remarksFor(sessionLabel, exam.term, roll.map((r) => r.studentId));
      return { done: remarks.size, total: roll.length };
    }),
  );
  return remarksLeft(cards);
}

/* ----------------------------------------------------- one class, in depth */

export type ChildRow = {
  photoUrl?: string | null;
  id: string;
  name: string;
  rollNo: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  attendancePct: number | null;
  daysCounted: number;
  lowestSubject: { code: string; pct: number } | null;
  openNotes: number;
  reasons: AttentionReason[];
  /** Present days, half days at the session's credit — the "18" of "18/20 days". */
  presentDays: number;
  /** Latest papers whose marking has started in this class but not for this child. */
  papersMissing: number;
  /** The soonest review date among this child's open support actions the reader may see. */
  nextReview: string | null;
};

export type SubjectAverage = { subjectId: string; code: string; average: number | null; paperId: string; paperLabel: Pair; below33: number; marked: number };

/** A paper whose exam row is missing: nothing to name, in either language. */
const NO_EXAM: Pair = p("", "");

async function latestPapers(classId: string, sessionLabel: string) {
  const [papers, assessments] = await Promise.all([
    papersForClass(classId, sessionLabel).catch(() => []),
    listAssessments(sessionLabel).catch(() => []),
  ]);
  const when = new Map(assessments.map((a) => [a.id, { at: a.startsOn ?? a.endsOn ?? "", label: examWord(a.labelEn || a.code, a.labelHi) }]));
  const bySubject = new Map<string, (typeof papers)[number]>();
  // An undated exam is a rehearsal, not part of the year, while any dated exam
  // exists (the exam office's plannedExams rule): its zeros flagged whole
  // classes as "below 33%" (smoke 20 Oct).
  const anyDated = assessments.some((a) => Boolean(a.startsOn ?? a.endsOn));
  for (const paper of papers) {
    if (anyDated && !when.get(paper.assessmentId)?.at) continue;
    const cur = bySubject.get(paper.subjectId);
    if (!cur || (when.get(paper.assessmentId)?.at ?? "") > (when.get(cur.assessmentId)?.at ?? "")) bySubject.set(paper.subjectId, paper);
  }
  const latest = [...bySubject.values()];
  const marks = latest.length ? await marksForPapers(latest.map((p) => p.id)).catch(() => new Map()) : new Map();
  return { latest, marks, when };
}

/**
 * A class as its teacher sees it: every child with attendance so far, the
 * latest paper in each subject, open notes, and why anyone needs attention.
 */
export async function classInsight(classId: string, sessionLabel: string, staff: CurrentStaff, notesRead?: Promise<BoardNote[]>, schoolDay?: string) {
  // The school's day from the caller's clock (the lab clock for a test account), so Today and My class agree.
  const today = schoolDay ?? schoolToday();
  // The notes this reader may see; Today passes the read it already started
  // so they are not read twice (perf fix 6).
  const notesP =
    notesRead ??
    (can(staff, "notes:view")
      ? noteViewer(staff, sessionLabel).then((viewer) => visibleNotes(viewer, sessionLabel)).catch(() => [] as BoardNote[])
      : Promise.resolve([] as BoardNote[]));
  const [roll, range, rules, papers, notes] = await Promise.all([
    classRoll({ classId, sessionLabel }),
    classAttendanceRange(classId, sessionLabel, "1900-01-01", today),
    attendanceRules(sessionLabel),
    latestPapers(classId, sessionLabel),
    notesP,
  ]);
  const basics = await childBasics(roll.map((r) => r.studentId));

  const statuses = new Map<string, AttendanceStatus[]>();
  for (const m of range) {
    const list = statuses.get(m.studentId) ?? [];
    list.push(m.status);
    statuses.set(m.studentId, list);
  }
  const openNotes = new Map<string, number>();
  for (const n of notes) if (n.status !== "done" && n.studentId) openNotes.set(n.studentId, (openNotes.get(n.studentId) ?? 0) + 1);
  const nextReview = new Map<string, string>();
  for (const n of notes) {
    if (n.status === "done" || !n.needsFollowUp || !n.followUpOn || !n.studentId) continue;
    const cur = nextReview.get(n.studentId);
    if (!cur || n.followUpOn < cur) nextReview.set(n.studentId, n.followUpOn);
  }
  // A paper counts as "not entered" for a child only once its marking has
  // begun in this class; a paper nobody has marked yet is not missing anyone.
  const started = new Set<string>();
  for (const key of papers.marks.keys()) started.add(String(key).split("|")[0]);

  const subjectPct = new Map<string, number[]>();
  // Children accounted for on each paper: a mark, an absent or an exempt.
  // "Marked" counted only numbers, so a sent paper with one absent child read
  // "3 of 4 entered" on the class page (6 Nov school day).
  const subjectDone = new Map<string, number>();
  const children: ChildRow[] = [...roll].sort(compareRoll).map((r) => {
    const att = attendancePercent(statuses.get(r.studentId) ?? [], rules);
    let lowest: { code: string; pct: number } | null = null;
    let missing = 0;
    for (const paper of papers.latest) {
      const mark = papers.marks.get(`${paper.id}|${r.studentId}`) as { value: number | null; absent: boolean; exempt: boolean } | undefined;
      if (started.has(paper.id) && (!mark || (mark.value === null && !mark.absent && !mark.exempt))) missing += 1;
      if (mark && (mark.value !== null || mark.absent || mark.exempt)) subjectDone.set(paper.id, (subjectDone.get(paper.id) ?? 0) + 1);
      if (!mark || mark.value === null || mark.absent || mark.exempt || !paper.maxMarks) continue;
      const pct = Math.round((mark.value / paper.maxMarks) * 100);
      const list = subjectPct.get(paper.id) ?? [];
      list.push(pct);
      subjectPct.set(paper.id, list);
      if (!lowest || pct < lowest.pct) lowest = { code: paper.subjectCode, pct };
    }
    const open = openNotes.get(r.studentId) ?? 0;
    const b = basics.get(r.studentId);
    return {
      id: r.studentId,
      name: r.fullName,
      photoUrl: b?.photoPath ?? null,
      rollNo: r.rollNo,
      dateOfBirth: b?.dateOfBirth ?? null,
      gender: b?.gender ?? null,
      attendancePct: att.percent,
      daysCounted: att.counted,
      lowestSubject: lowest,
      openNotes: open,
      reasons: attentionReasons({ attendancePct: att.percent, daysCounted: att.counted, lowestSubjectPct: lowest?.pct ?? null, openNotes: open }),
      presentDays: att.present,
      papersMissing: missing,
      nextReview: nextReview.get(r.studentId) ?? null,
    };
  });

  const subjects: SubjectAverage[] = papers.latest
    .map((paper) => {
      const pcts = subjectPct.get(paper.id) ?? [];
      return {
        subjectId: paper.subjectId,
        code: paper.subjectCode,
        average: average(pcts),
        paperId: paper.id,
        paperLabel: papers.when.get(paper.assessmentId)?.label ?? NO_EXAM,
        below33: pcts.filter((x) => x < 33).length,
        marked: subjectDone.get(paper.id) ?? 0,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const classAverage = average(children.flatMap((c) => (c.attendancePct === null ? [] : [c.attendancePct])));
  return { children, subjects, classAttendance: classAverage, notes };
}

/* ------------------------------------------------------------------ Today */

export type TodayPeriod = { period: number; number: number; starts: string; ends: string; subjectCode: string; subjectName: string; subjectHi: string; classLabel: string; classId: string | null; combined: boolean; /** Every class in the lesson; a combined period has several and no single classId. */ classIds?: string[] };

export type CoverRow = {
  id: string;
  /** The school day of the duty; today's, or one of the next few school days. */
  day: string;
  period: number;
  number: number;
  starts: string;
  ends: string;
  classLabels: string;
  subjectCode: string;
  subjectName: string;
  /** The subject in Hindi, for a Hindi reader ("Physics" read as English on Today). */
  subjectHi?: string;
  forName: string;
  acknowledged: boolean;
  askedAt: string;
  reason: string | null;
};

/** A cover that was hers until the office changed it; shown for a day so it never just vanishes. */
export type ChangedCover = {
  id: string;
  day: string;
  number: number;
  starts: string;
  classLabels: string;
  subjectName: string;
  subjectHi: string;
  why: EndedDutyWhy;
};

/** The next `count` open school days after `today`, looking at most two weeks ahead. */
function nextSchoolDays(today: string, calendar: Awaited<ReturnType<typeof attendanceCalendar>>, count: number): string[] {
  const out: string[] = [];
  let d = today;
  for (let i = 0; i < 14 && out.length < count; i += 1) {
    d = addDays(d, 1);
    if (isSchoolOpen(d, calendar)) out.push(d);
  }
  return out;
}

/**
 * Today, read in as few rounds as the data allows (perf fixes 4 and 6): the
 * first round starts everything that needs only the session — the notes and
 * marks links included — and the second everything that needs the first,
 * together. The timetable's day names are read once for today and tomorrow,
 * and the notes once for both "children who need you" and the reviews.
 */
export async function loadHome(staff: CurrentStaff) {
  const [sessionLabel, now] = await Promise.all([resolveSessionLabel(), schoolNow(staff)]);
  const today = schoolToday(now);
  const nowMinutes = schoolClock(now).minutes;
  if (!sessionLabel) return { sessionLabel: null as string | null, today, nowMinutes };

  const mayReadNotes = can(staff, "notes:view");
  const labelsP = classLabelMap(sessionLabel);
  const notesP: Promise<BoardNote[]> = mayReadNotes
    ? noteViewer(staff, sessionLabel).then((viewer) => visibleNotes(viewer, sessionLabel)).catch(() => [] as BoardNote[])
    : Promise.resolve([] as BoardNote[]);
  const linksP = labelsP
    .then((labels) => marksLinks(staff.id, sessionLabel, labels, today))
    .catch(() => ({ links: [] as MarksLink[], assigned: [] as { class_id: string; subject_id: string }[], sizes: new Map<string, number>() }));

  const [calendar, labels, held, published, registers, covers, bells, notices, subjectList, dayNames, leaveRows, tasks, prefs] = await Promise.all([
    attendanceCalendar(sessionLabel),
    labelsP,
    heldClassIds(staff.id, sessionLabel),
    getPublishedVersion(sessionLabel),
    registersForDay(sessionLabel, today),
    myDutiesOn(staff.id, sessionLabel, today).catch(() => []),
    currentBells(sessionLabel).catch(() => null),
    staffNotices(staff.id, sessionLabel, 10),
    listSubjects().catch(() => []),
    calendarNames(sessionLabel, addDays(today, -10), addDays(today, 14)).catch(() => new Map<string, CalendarEntry>()),
    myLeaveRows(staff.id, 10, sessionLabel).catch(() => [] as LeaveRow[]),
    waitingTasks(now),
    createAdminClient()
      .from("staff_ui_preferences")
      .select("large_text")
      .eq("staff_profile_id", staff.id)
      .maybeSingle<{ large_text: boolean }>()
      .then((r) => Boolean(r.data?.large_text), () => false),
  ]);
  // Subject names for the day's rows ("Class 6 · Science"), one name per
  // subject in each language, the one the marks cards use too (D-524).
  const named = subjectNamer(subjectList);
  const schoolOpen = isSchoolOpen(today, calendar);
  // Why school is shut today, by name (smoke 20 Oct: "No school today" with no reason).
  const closed: ClosedWhy = closedWhy(today, schoolOpen, dayNames.get(today));
  // On a closed day, the last open day, so an unmarked register there can be finished.
  const lastOpen = schoolOpen ? null : lastOpenDay(today, (d) => isSchoolOpen(d, calendar));
  const rank = rankOf(labels);
  const heldSorted = [...held].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  const myClassId = heldSorted[0] ?? null;
  const schedule = bells ?? { id: null, label: "", periods: [], revision: 0 };

  // Tomorrow: the next open school day, for the "all set" card's first lesson.
  let next = addDays(today, 1);
  for (let i = 0; i < 10 && !isSchoolOpen(next, calendar); i += 1) next = addDays(next, 1);
  const runsToday = Boolean(published) && schoolOpen && timetableRuns(today, calendar);
  const runsNext = Boolean(published) && isSchoolOpen(next, calendar) && timetableRuns(next, calendar);
  const headersP = published && (runsToday || runsNext) ? dayHeaders(published.id).catch(() => [] as string[]) : Promise.resolve([] as string[]);
  const slotsOn = (day: string, runs: boolean) =>
    headersP.then((headers) => {
      const header = runs && published ? matchDayHeader(headers, day) : null;
      return header && published ? periodsOn(staff.id, published.id, header) : [];
    });

  const reg = myClassId ? (registers.find((r) => r.classId === myClassId && r.period === null) ?? null) : null;
  const recorded = Boolean(reg && reg.revision >= 1);
  const upcomingDays = nextSchoolDays(today, calendar, 3);
  // Covers the office took back from her in the last day, so Today can say so.
  const endedP = myEndedDuties(staff.id, sessionLabel, [today, ...upcomingDays], new Date(Date.now() - 86_400_000).toISOString())
    .catch((): Awaited<ReturnType<typeof myEndedDuties>> => []);

  const [slots, nextSlots, upcoming, insights, totals, queue, linkSet, myNotes, leave, lastRegisters, parentSwitches] = await Promise.all([
    slotsOn(today, runsToday),
    slotsOn(next, runsNext).catch(() => []),
    Promise.all(upcomingDays.map((day) => myDutiesOn(staff.id, sessionLabel, day).then((list) => list.map((c) => ({ ...c, day })), () => []))).then((lists) => lists.flat()),
    // Every class she holds, not only the first (smoke 20 Oct: "where did my Class 3 go?").
    Promise.all(heldSorted.map((id) => classInsight(id, sessionLabel, staff, notesP, today).catch(() => null))),
    reg && recorded ? latestReceipt(reg.id).catch(() => null).then((receipt) => registerTotals(reg.id, receipt)) : Promise.resolve(undefined),
    // The absent alerts queued with today's register, and the birthday
    // wishes already queued today — so "all set" can say what was done.
    myClassId
      ? createAdminClient()
          .from("parent_message_queue")
          .select("student_id, kind")
          .eq("class_id", myClassId)
          .eq("day", today)
          .in("kind", ["absent_alert", "birthday"])
          .neq("status", "cancelled")
          .returns<{ student_id: string; kind: string }[]>()
          .then((r) => r.data ?? [], () => [] as { student_id: string; kind: string }[])
      : Promise.resolve([] as { student_id: string; kind: string }[]),
    linksP,
    notesP,
    withCovers(staff.id, sessionLabel, leaveForToday(leaveRows, today)).catch(() => [] as LeaveItem[]),
    lastOpen && held.length ? registersForDay(sessionLabel, lastOpen).catch(() => []) : Promise.resolve([] as Awaited<ReturnType<typeof registersForDay>>),
    myClassId ? readParentSwitches() : Promise.resolve(null),
  ]);
  const insight = insights[0] ?? null;

  const lessons = lessonsToday(slots);
  const periods: TodayPeriod[] = lessons.map((l) => ({
    period: l.period,
    number: periodNumber(l.period),
    ...timeOf(schedule, l.period),
    subjectCode: l.subjectCode,
    subjectName: named(l.subjectCode).en,
    subjectHi: named(l.subjectCode).hi,
    classLabel: l.classes.map((c) => c.classLabel).join(" · "),
    classId: l.classId,
    combined: l.classes.length > 1,
    classIds: l.classes.map((c) => c.classId),
  }));
  // The whole bell day, so the timeline can draw the free periods between lessons.
  const bellDay = slots.length || covers.length ? schedule.periods.map((b) => ({ period: b.index, number: periodNumber(b.index), starts: b.starts, ends: b.ends })) : [];

  const names = await staffNames([...new Set([...covers, ...upcoming].flatMap((c) => c.absentStaffIds))]);
  const toRow = (c: (typeof covers)[number], day: string): CoverRow => ({
    id: c.id,
    day,
    period: c.period,
    number: periodNumber(c.period),
    ...timeOf(schedule, c.period),
    classLabels: c.classLabels.join(", "),
    subjectCode: c.subjectCode,
    subjectName: named(c.subjectCode).en,
    subjectHi: named(c.subjectCode).hi,
    forName: c.absentStaffIds.map((id) => names.get(id) ?? "—").join(", "),
    acknowledged: c.acknowledgedAt !== null,
    askedAt: c.createdAt,
    reason: c.reason,
  });
  const coverRows = covers.map((c) => toRow(c, today));
  const changedCovers: ChangedCover[] = (await endedP).map(({ duty: c, why }) => ({
    id: c.id,
    day: c.day,
    number: periodNumber(c.period),
    starts: timeOf(schedule, c.period).starts,
    classLabels: c.classLabels.join(", "),
    subjectName: named(c.subjectCode).en,
    subjectHi: named(c.subjectCode).hi,
    why,
  }));
  const upcomingRows = upcoming.map((c) => toRow(c, c.day));
  // What she told the teachers she covered for, and what her own substitutes told her (D-419).
  const [toldMap, awayRaw] = await Promise.all([
    reportsOnDuties(coverRows.map((c) => c.id)).catch((): Awaited<ReturnType<typeof reportsOnDuties>> => new Map()),
    reportsForAbsent(staff.id, sessionLabel, today).catch((): Awaited<ReturnType<typeof reportsForAbsent>> => []),
  ]);
  const byNames = awayRaw.length ? await staffNames([...new Set(awayRaw.map((r) => r.byId))]) : new Map<string, string>();
  const coverReports = Object.fromEntries([...toldMap].map(([id, r]) => [id, r]));
  const awayReports = awayRaw.map((r) => ({ ...r, by: byNames.get(r.byId) ?? "—", number: periodNumber(r.period) }));

  const first = lessonsToday(nextSlots)[0];
  const tomorrow: { day: string; first: { number: number; starts: string; classLabel: string; subjectName: string; subjectHi?: string } | null } | null = runsNext
    ? {
        day: next,
        first: first
          ? { number: periodNumber(first.period), starts: timeOf(schedule, first.period).starts, classLabel: first.classes.map((c) => c.classLabel).join(" · "), subjectName: named(first.subjectCode).en, subjectHi: named(first.subjectCode).hi }
          : null,
      }
    : null;

  let myClass: null | {
    classId: string;
    classLabel: string;
    total: number;
    register: { revision: number; submittedAt: string | null; present: number; absent: number; halfDay: number; total: number; alerts: number } | null;
  } = null;
  // `detail` is a pair: "2 open notes" read as English to a Hindi-only teacher (verification 21 Oct).
  let kids: { id: string; name: string; classLabel?: string | null; reasons: AttentionReason[]; detail: Pair | string; attendancePct: number | null }[] = [];
  let birthdays: { id: string; name: string; inDays: number; turning: number; rollNo: string | null; wished: boolean }[] = [];
  if (myClassId) {
    const wished = new Set(queue.filter((q) => q.kind === "birthday").map((q) => q.student_id));
    myClass = {
      classId: myClassId,
      classLabel: labels.get(myClassId) ?? "—",
      total: insight?.children.length ?? 0,
      register:
        reg && recorded
          ? {
              revision: reg.revision,
              submittedAt: reg.submittedAt,
              present: Number(totals?.present ?? 0) + Number(totals?.late ?? 0),
              absent: Number(totals?.absent ?? 0),
              halfDay: Number(totals?.half_day ?? 0),
              total: Number(totals?.total ?? insight?.children.length ?? 0),
              alerts: queue.filter((q) => q.kind === "absent_alert").length,
            }
          : null,
    };
    // Children who need her from every class she holds, a few from each, so
    // a second class's child absent three days is not left out (smoke 20 Oct).
    const several = insights.filter(Boolean).length > 1;
    kids = heldSorted.flatMap((classId, i) => {
      const one = insights[i];
      if (!one) return [];
      return one.children
        .filter((c) => c.reasons.length > 0)
        .slice(0, several ? 3 : 4)
        .map((c) => ({
          id: c.id,
          name: c.name,
          // Which class, said by the screen in the reader's words ("कक्षा 4").
          classLabel: several ? (labels.get(classId) ?? null) : null,
          reasons: c.reasons,
          attendancePct: c.attendancePct === null ? null : Math.round(c.attendancePct),
          detail: joinPairs([
            c.reasons.includes("attendance") && c.attendancePct !== null ? p(`${Math.round(c.attendancePct)}% attendance`, `${Math.round(c.attendancePct)}% हाज़िरी`) : null,
            c.reasons.includes("marks") && c.lowestSubject
              ? p(`${named(c.lowestSubject.code).en} ${c.lowestSubject.pct}%`, `${named(c.lowestSubject.code).hi} ${c.lowestSubject.pct}%`)
              : null,
            c.reasons.includes("notes") ? openNotesP(c.openNotes) : null,
          ]),
        }));
    });
    if (insight) {
      birthdays = upcomingBirthdays(insight.children, today, 7).map((c) => ({ id: c.id, name: c.name, inDays: c.inDays, turning: c.turning, rollNo: c.rollNo, wished: wished.has(c.id) }));
    }
  }

  // "My subjects": each class-subject this teacher teaches, with its roll size.
  const subjectById = new Map(subjectList.map((s) => [s.id, s]));
  const subjects = linkSet.assigned
    .map((a) => {
      const s = subjectById.get(a.subject_id);
      const words = s ? named(s.code) : { en: "—", hi: "—" };
      return {
        classId: a.class_id,
        classLabel: labels.get(a.class_id) ?? "—",
        subjectId: a.subject_id,
        code: s?.code ?? null,
        name: words.en,
        nameHi: words.hi,
        children: linkSet.sizes.get(a.class_id) ?? 0,
        mine: held.includes(a.class_id),
      };
    })
    .sort((a, b) => (rank.get(a.classId) ?? 0) - (rank.get(b.classId) ?? 0) || a.name.localeCompare(b.name));
  const mine = (n: BoardNote) => n.followUpStaffId === staff.id || (n.followUpStaffId === null && n.writtenBy === staff.id);
  const followUpsDue = myNotes.filter((n) => n.status !== "done" && n.needsFollowUp && n.followUpOn !== null && n.followUpOn <= today && mine(n)).length;
  // The support reviews this teacher owns, due within two days or late, by
  // name — the same notes Student 360 lists, so finishing one there clears it
  // here (notes §3).
  const soon = addDays(today, 2);
  const reviews = myNotes
    .filter((n) => n.status !== "done" && n.needsFollowUp && n.followUpOn !== null && n.followUpOn <= soon && mine(n))
    .sort((a, b) => (a.followUpOn ?? "").localeCompare(b.followUpOn ?? ""))
    .slice(0, 6)
    // A whole-class note has no child: say "Whole class", never a blank name (smoke 20 Oct).
    .map((n) => ({ id: n.id, studentId: n.studentId, studentName: n.studentName, subject: noteSubject(n), body: excerpt(n.body, 90), followUpOn: n.followUpOn as string }));

  return {
    sessionLabel,
    today,
    nowMinutes,
    schoolOpen,
    published: Boolean(published),
    myClass,
    heldCount: held.length,
    otherHeld: heldSorted.slice(1).map((id) => ({ classId: id, classLabel: labels.get(id) ?? "—" })),
    periods,
    bells: bellDay,
    covers: coverRows,
    /** Cover duties on the next three school days (BUG-06). */
    upcomingCovers: upcomingRows,
    /** Her covers the office cancelled or moved in the last day (teacher 11, 6 Nov). */
    changedCovers,
    /** Her report on each of today's covers, by duty id, once she has said how it went (D-419). */
    coverReports,
    /** Reports from the teachers who covered her periods in the last ten days, not yet read (D-419). */
    awayReports,
    tomorrow,
    notices,
    kids,
    birthdays,
    /** Settings → Parent messages: false hides "Send wishes". */
    birthdayWishes: parentSwitches ? parentSwitches.birthday : false,
    followUpsDue,
    reviews,
    subjects,
    /** No class of her own and nothing to teach: a new joiner not yet in the timetable (ST-15). */
    unassigned: held.length === 0 && linkSet.assigned.length === 0,
    links: linkSet.links.filter((l) => !l.submitted).slice(0, 6),
    canMark: can(staff, "attendance:mark"),
    /** Her id, for the phone's kept attendance drafts and the welcome card. */
    staffId: staff.id,
    /** Why school is shut today, or null when it is open. */
    closed,
    /** On a closed day: the last open day, and her classes whose register there is still not saved. */
    lastOpen: lastOpen
      ? {
          day: lastOpen,
          unmarked: heldSorted
            .filter((id) => !lastRegisters.some((r) => r.classId === id && r.period === null && r.revision >= 1))
            .map((id) => ({ classId: id, classLabel: labels.get(id) ?? "—" })),
        }
      : null,
    /** Every class she holds, each with today's register state (smoke 20 Oct). */
    myClasses: heldSorted.map((id, i) => {
      const r = registers.find((x) => x.classId === id && x.period === null) ?? null;
      const saved = Boolean(r && r.revision >= 1);
      return { classId: id, classLabel: labels.get(id) ?? "—", total: insights[i]?.children.length ?? 0, saved, savedAt: saved ? (r?.submittedAt ?? null) : null };
    }),
    /** Closed days in the next two weeks, for the leave form. */
    closedDays: closedDaysAhead(today, calendar, dayNames),
    /** Her leave that still covers today or later, with who covers her periods. */
    leave,
    /** The office's tasks waiting on her (missing details, photos). */
    tasks,
    largeText: prefs,
  };
}

/* ------------------------------------------------------------- Attendance */

/** What the register says beside a child whose parent told the school on WhatsApp (D-588). */
const INFORMED: Record<ParentNoteReason, Pair> = {
  sick: p("Parent informed · sick", "अभिभावक ने बताया · बीमार"),
  other: p("Parent informed", "अभिभावक ने बताया"),
};

/**
 * The register's waiting parents' notes (D-601): children whose parent told
 * Veer Patta AI they would be away, not yet applied by anyone. Only for a
 * reader who may decide them (whoever corrects attendance, or the class's own
 * teacher who marks it), never while an admin sees One as someone else, and
 * empty when they cannot be read: the register opens and saves either way.
 */
async function registerAsks(staff: CurrentStaff, sessionLabel: string, classId: string, day: string, owner: boolean): Promise<Map<string, { id: string; line: Pair }>> {
  const asks = new Map<string, { id: string; line: Pair }>();
  if (!can(staff, "attendance:correct") && !(owner && can(staff, "attendance:mark"))) return asks;
  if (!staffBelongsToSession(staff.isTestAccount, sessionLabel)) return asks;
  try {
    if ((await getViewer()).previewing) return asks;
    for (const waiting of await waitingAbsencesOn(sessionLabel, classId, day)) {
      asks.set(waiting.studentId, { id: waiting.id, line: registerAskLine({ payload: waiting.payload, day, practice: waiting.practice }) });
    }
  } catch (caught) {
    logWarn("attendance.parent_asks_unreadable", { error: caught instanceof Error ? caught.message.slice(0, 120) : "unknown" });
    asks.clear();
  }
  return asks;
}

export async function loadAttendance(staff: CurrentStaff, input: { classId: string | null; day: string; month: string | null }) {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { kind: "no-session" as const };

  const [labels, held, scope, calendar, now] = await Promise.all([
    classLabelMap(sessionLabel),
    heldClassIds(staff.id, sessionLabel),
    // A class's register is its class teacher's: a subject teacher who teaches
    // it does not read it (owner, 6 Nov 2026).
    attendanceScopeFor(staff, sessionLabel),
    attendanceCalendar(sessionLabel),
    // The school clock (the lab clock for a test account), read before "closed" so Today and the register agree.
    schoolNow(staff),
  ]);
  const rank = rankOf(labels);
  const choices = (can(staff, "attendance:mark_on_behalf") ? [...labels.keys()] : held)
    .map((classId) => ({ classId, classLabel: labels.get(classId) ?? "—" }))
    .sort((a, b) => (rank.get(a.classId) ?? 0) - (rank.get(b.classId) ?? 0));

  const classId = input.classId ?? (choices.length === 1 ? choices[0].classId : held.length === 1 ? held[0] : null);
  if (!classId) return { kind: "choose" as const, choices, day: input.day };

  const authority = registerAuthority({
    isOwner: held.includes(classId),
    hasMarkPermission: can(staff, "attendance:mark"),
    hasMarkOnBehalfPermission: can(staff, "attendance:mark_on_behalf"),
    hasCorrectPermission: can(staff, "attendance:correct"),
  });
  if (!scopeIncludes(scope, classId) && !authority.save && !authority.correct) return { kind: "not-yours" as const, choices };

  const day = input.day;
  const closed = !isSchoolOpen(day, calendar) || day > schoolToday(now);

  // The last open school day before this one, for "Same as yesterday".
  let prev = dayBefore(day);
  for (let i = 0; i < 10 && !isSchoolOpen(prev, calendar); i += 1) prev = dayBefore(prev);

  const [roll, register, prevRegister] = await Promise.all([
    rosterOn({ classId, sessionLabel, day }),
    findRegister(classId, sessionLabel, day, null),
    findRegister(classId, sessionLabel, prev, null),
  ]);
  const recorded = register !== null && register.revision >= 1;
  const [marks, receipt, prevMarks] = await Promise.all([
    recorded ? listMarks(register.id) : Promise.resolve(new Map<string, { status: AttendanceStatus; note: string | null }>()),
    recorded ? latestReceipt(register.id) : Promise.resolve(null),
    prevRegister && prevRegister.revision >= 1 ? listMarks(prevRegister.id) : Promise.resolve(new Map<string, { status: AttendanceStatus; note: string | null }>()),
  ]);

  // The queued 10 am alerts for this register, so the save sheet says so.
  let queuedAlerts: string[] = [];
  if (recorded) {
    const { data } = await createAdminClient()
      .from("parent_message_queue")
      .select("student_id")
      .eq("register_id", register.id)
      .eq("kind", "absent_alert")
      .eq("status", "queued")
      .returns<{ student_id: string }[]>();
    queuedAlerts = (data ?? []).map((r) => r.student_id);
  }

  // The month view. An asked-for month that is not "YYYY-MM" falls back to the day's.
  const month = input.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) ? input.month : day.slice(0, 7);
  const [range, basics, parentSwitches, told, asks] = await Promise.all([
    classAttendanceRange(classId, sessionLabel, `${month}-01`, monthEnd(month)),
    childBasics(roll.map((r) => r.studentId)),
    readParentSwitches(),
    // A parent who told the school on WhatsApp that the child would be away (D-588),
    // once a person at school applied it (D-598).
    parentNotesFor(sessionLabel, day, roll.map((r) => r.studentId)),
    // The same, still waiting: the teacher applies it from the register (D-601).
    closed ? Promise.resolve(new Map<string, { id: string; line: Pair }>()) : registerAsks(staff, sessionLabel, classId, day, held.includes(classId)),
  ]);
  const closedDays = [...calendar.entries()].filter(([d]) => d.startsWith(month)).filter(([d]) => !isSchoolOpen(d, calendar)).map(([d]) => d);

  const sorted = [...roll].sort(compareRoll);
  // SR number and father for children who share a name (BUG-05, ST-19).
  const apart = tellApart(sorted.map((r) => ({ id: r.studentId, name: r.fullName, admissionNo: basics.get(r.studentId)?.admissionNo ?? null, fatherName: basics.get(r.studentId)?.fatherName ?? null })));
  return {
    kind: "class" as const,
    sessionLabel,
    classId,
    classLabel: labels.get(classId) ?? "—",
    choices,
    day,
    prevDay: prev,
    closed,
    canSave: authority.save,
    canCorrect: authority.correct,
    isOwner: held.includes(classId),
    correctsAny: can(staff, "attendance:correct"),
    onBehalf: authority.onBehalf,
    reason: authority.reason ?? null,
    /** Settings → Parent messages: whether the absent-child WhatsApp is offered, and where its switch starts. */
    parentAlerts: parentSwitches.absentAlert,
    ...(told.size || asks.size ? { informedNote: p("No absent message goes to a parent who told the school on WhatsApp.", "जिन अभिभावकों ने व्हाट्सऐप पर स्कूल को बता दिया है, उन्हें अनुपस्थिति का संदेश नहीं जाएगा।") } : {}),
    roll: sorted.map((r) => {
      const dob = basics.get(r.studentId)?.dateOfBirth ?? null;
      const why = told.get(r.studentId);
      const ask = why ? undefined : asks.get(r.studentId);
      return {
        id: r.studentId,
        name: r.fullName,
        rollNo: r.rollNo,
        admissionNo: basics.get(r.studentId)?.admissionNo ?? null,
        hint: apart.get(r.studentId) ?? null,
        gender: basics.get(r.studentId)?.gender ?? null,
        birthday: Boolean(dob && dob.slice(5, 10) === day.slice(5, 10)),
        // The child starts as Leave or Absent, as the person who applied the
        // parent's note chose (D-598), and the card says why; the teacher can still change it.
        ...(why ? { informed: INFORMED[why.reason], informedMark: why.mark } : {}),
        // Still waiting (D-601): "Parent says sick" with Leave and Absent beside
        // the child. Saving the child as Leave or Absent applies it as the teacher.
        ...(ask ? { ask } : {}),
      };
    }),
    registerId: register?.id ?? null,
    revision: register?.revision ?? 0,
    saved: Object.fromEntries([...marks.entries()].map(([id, m]) => [id, m.status])) as Record<string, Mark>,
    yesterday: Object.fromEntries([...prevMarks.entries()].map(([id, m]) => [id, m.status])) as Record<string, Mark>,
    // A register with no stored revision (one written before revisions were
    // kept) still has its own save time; "Saved at —" told the teacher nothing.
    receipt: receipt
      ? { savedAt: receipt.savedAt, actorName: receipt.actorName, revision: receipt.revision }
      : recorded && register?.submittedAt
        ? { savedAt: register.submittedAt, actorName: null, revision: register.revision }
        : null,
    queuedAlerts,
    /** When parents' absent messages go, said truthfully for the time of saving (BUG-16). */
    alertWhen: alertWhen(schoolClock(now).minutes, day, schoolToday(now)),
    month,
    monthMarks: range.map((r) => ({ studentId: r.studentId, day: r.day, status: r.status as Mark })),
    closedDays,
  };
}

/* -------------------------------------------------------------- My class */

export async function loadClass(staff: CurrentStaff, input: { classId: string | null }) {
  // The session and the clock first; then everything that needs only them,
  // together. My class read in six rounds one after another and took 11 s on
  // a phone (smoke 20 Oct); the class itself is known from the URL or from
  // her held classes, so its insight starts in the second round, not the fourth.
  const [sessionLabel, now] = await Promise.all([resolveSessionLabel(), schoolNow(staff)]);
  if (!sessionLabel) return { kind: "no-session" as const };
  const today = schoolToday(now);
  const labelsP = classLabelMap(sessionLabel);
  const heldP = heldClassIds(staff.id, sessionLabel);
  const ownP = ownClassIds(staff.id, sessionLabel);
  const publishedP = getPublishedVersion(sessionLabel);
  const classIdP = Promise.all([labelsP, heldP, ownP]).then(([labels, held, own]) => {
    const rank = rankOf(labels);
    const scope = readsEveryClass(staff) ? [...labels.keys()] : own;
    return input.classId && scope.includes(input.classId) ? input.classId : ([...held].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))[0] ?? null);
  });
  const insightP = classIdP.then((id) => (id ? classInsight(id, sessionLabel, staff, undefined, today) : null));
  const headersP = publishedP.then((pub) => (pub ? dayHeaders(pub.id).catch(() => [] as string[]) : ([] as string[])));
  const slotsP = publishedP.then((pub) => (pub ? listSlots(pub.id).catch(() => []) : []));
  // These three start now and are awaited after the round below. If that round
  // throws first, or one of them fails before it is awaited, the rejection has
  // no handler, and Node ends the whole function instance with every request
  // on it: a statement timeout in the class insight took /exam-office down with
  // /teach/class (smoke test, 6 Nov 2026). Marking them handled changes nothing
  // for the awaits that follow; they still see the error.
  for (const early of [insightP, headersP, slotsP]) early.catch(() => {});

  const [labels, held, registers, subjects, published, assignedRes, linkSet, calendar, bells, classId, dayNames] = await Promise.all([
    labelsP,
    heldP,
    registersForDay(sessionLabel, today),
    listSubjects().catch(() => []),
    publishedP,
    // "My subjects": the class-subjects this teacher teaches, from her assignments.
    createAdminClient()
      .from("teaching_assignments")
      .select("class_id, subject_id, periods_per_week")
      .eq("staff_profile_id", staff.id)
      .eq("session_label", sessionLabel)
      .returns<{ class_id: string; subject_id: string; periods_per_week: number | null }[]>(),
    // Her marks links, for each subject card's "Half-yearly marks" and the links list.
    labelsP.then((l) => marksLinks(staff.id, sessionLabel, l, today)).catch(() => ({ links: [] as MarksLink[], assigned: [], sizes: new Map<string, number>() })),
    attendanceCalendar(sessionLabel).catch(() => null),
    currentBells(sessionLabel).catch(() => null),
    classIdP,
    calendarNames(sessionLabel, today, today).catch(() => new Map<string, CalendarEntry>()),
  ]);
  const rank = rankOf(labels);
  const assigned = assignedRes.data;
  const codeOf = new Map(subjects.map((s) => [s.id, s.code]));
  // One name per subject in each language, as Today and the marks cards say it (D-524).
  const named = subjectNamer(subjects);
  const mySubjects = (assigned ?? [])
    .map((a) => {
      const code = codeOf.get(a.subject_id);
      const words = code ? named(code) : { en: "—", hi: "—" };
      return { classId: a.class_id, classLabel: labels.get(a.class_id) ?? "—", subjectId: a.subject_id, code: code ?? "—", name: words.en, nameHi: words.hi, periods: a.periods_per_week ?? 0 };
    })
    .sort((a, b) => (rank.get(a.classId) ?? 0) - (rank.get(b.classId) ?? 0) || a.code.localeCompare(b.code));
  const subjectCards = mySubjects.map((s) => ({ ...s, children: linkSet.sizes.get(s.classId) ?? 0, held: held.includes(s.classId) }));

  if (!classId) {
    return { kind: "subjects-only" as const, sessionLabel, today, mySubjects: subjectCards, links: linkSet.links, heldClasses: [] as { classId: string; classLabel: string }[], published: Boolean(published) };
  }

  const reg = registers.find((r) => r.classId === classId && r.period === null) ?? null;
  const runs = Boolean(published && calendar && isSchoolOpen(today, calendar) && timetableRuns(today, calendar));
  const [insight, receipt, headers, allSlots] = await Promise.all([
    insightP.then((i) => i ?? classInsight(classId, sessionLabel, staff, undefined, today)),
    reg && reg.revision >= 1 ? latestReceipt(reg.id).catch(() => null) : Promise.resolve(null),
    runs ? headersP : Promise.resolve([] as string[]),
    runs ? slotsP : Promise.resolve([]),
  ]);
  // Attendance on this page is the class teacher's (owner, 6 Nov 2026): a
  // subject teacher opening a class she teaches sees its roll, notes and
  // marks, not its register or anybody's attendance.
  const seesAttendance = readsEveryClass(staff) || held.includes(classId);
  const shown = seesAttendance ? insight : withoutAttendance(insight);
  const totals = seesAttendance && reg && reg.revision >= 1 ? await registerTotals(reg.id, receipt) : undefined;

  // The class's own timetable today (every teacher's periods in it), when one is published and runs today.
  let timetable: { period: number; number: number; starts: string; ends: string; subjectName: string; subjectHi: string; teacher: string; mine: boolean }[] = [];
  const header = runs ? matchDayHeader(headers, today) : null;
  if (header) {
    const schedule = bells ?? { id: null, label: "", periods: [], revision: 0 };
    timetable = allSlots
      .filter((x) => x.classId === classId && x.day === header)
      .map((x) => ({ period: x.period, number: periodNumber(x.period), ...timeOf(schedule, x.period), subjectName: named(x.subjectCode).en, subjectHi: named(x.subjectCode).hi, teacher: x.teacherShortName ?? "", mine: x.staffProfileId === staff.id }))
      .sort((a, b) => a.period - b.period);
  }
  return {
    kind: "class" as const,
    sessionLabel,
    today,
    classId,
    classLabel: labels.get(classId) ?? "—",
    isHeld: held.includes(classId),
    heldClasses: held.map((id) => ({ classId: id, classLabel: labels.get(id) ?? "—" })),
    seesAttendance,
    children: shown.children,
    subjects: shown.subjects,
    classAttendance: shown.classAttendance,
    todayRegister:
      seesAttendance && reg && reg.revision >= 1
        ? { present: Number(totals?.present ?? 0) + Number(totals?.late ?? 0), absent: Number(totals?.absent ?? 0), halfDay: Number(totals?.half_day ?? 0), total: Number(totals?.total ?? insight.children.length), savedAt: reg.submittedAt }
        : null,
    birthdays: upcomingBirthdays(shown.children, today, 7).map((c) => ({ id: c.id, name: c.name, inDays: c.inDays, turning: c.turning, rollNo: c.rollNo })),
    mySubjects: subjectCards,
    links: linkSet.links,
    timetable,
    nowMinutes: schoolClock(now).minutes,
    published: Boolean(published),
    /** Why school is shut today, so the register card does not ask for attendance on a holiday. */
    closed: calendar ? closedWhy(today, isSchoolOpen(today, calendar), dayNames.get(today)) : null,
  };
}

/** One class-subject's latest paper, child by child (the subject page). */
export async function loadSubject(staff: CurrentStaff, classId: string, subjectId: string) {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;
  const scope = await classScopeFor(staff, sessionLabel);
  if (!scopeIncludes(scope, classId)) return null;
  const [labels, roll, papers, subjects] = await Promise.all([classLabelMap(sessionLabel), classRoll({ classId, sessionLabel }), latestPapers(classId, sessionLabel), listSubjects().catch(() => [])]);
  const paper = papers.latest.find((p) => p.subjectId === subjectId) ?? null;
  // A subject with no paper yet (Sports) titled its page "Class 12 Science · —" (6 Nov).
  const subject = subjects.find((s) => s.id === subjectId);
  const rows = [...roll].sort(compareRoll).map((r) => {
    const m = paper ? (papers.marks.get(`${paper.id}|${r.studentId}`) as { value: number | null; absent: boolean; exempt: boolean } | undefined) : undefined;
    const pct = m && m.value !== null && paper?.maxMarks ? Math.round((m.value / paper.maxMarks) * 100) : null;
    return { id: r.studentId, name: r.fullName, rollNo: r.rollNo, value: m?.value ?? null, absent: Boolean(m?.absent), exempt: Boolean(m?.exempt), pct };
  });
  return {
    classId,
    classLabel: labels.get(classId) ?? "—",
    subjectCode: paper?.subjectCode ?? (subject?.nameEn || subject?.code || "—"),
    paper: paper ? { id: paper.id, maxMarks: paper.maxMarks, label: papers.when.get(paper.assessmentId)?.label ?? NO_EXAM, entryStatus: paper.entryStatus } : null,
    rows,
    average: average(rows.flatMap((r) => (r.pct === null ? [] : [r.pct]))),
  };
}

/** One child, as a teacher sees them: contact, attendance, marks, notes. Never fees. */
export async function loadStudent(staff: CurrentStaff, studentId: string) {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;
  const [scope, placement] = await Promise.all([classScopeFor(staff, sessionLabel), enrolmentForStudent(studentId, sessionLabel)]);
  if (!placement || !scopeIncludes(scope, placement.classId)) return null;
  const [card, labels, att, rules, basics, papers, notes] = await Promise.all([
    getStudentCard(studentId),
    classLabelMap(sessionLabel),
    studentAttendance(studentId, sessionLabel),
    attendanceRules(sessionLabel),
    childBasics([studentId]),
    latestPapers(placement.classId, sessionLabel),
    can(staff, "notes:view") ? notesForStudent(studentId).catch(() => [] as BoardNote[]) : Promise.resolve([] as BoardNote[]),
  ]);
  if (!card) return null;
  const photoHeld = await heldClassIds(staff.id, sessionLabel);
  // A child's attendance is for the class teacher and the office (owner, 6 Nov 2026).
  const seesAttendance = readsEveryClass(staff) || photoHeld.includes(placement.classId);
  const pct = attendancePercent(seesAttendance ? att.map((a) => a.status) : [], rules);
  const marks = papers.latest.map((paper) => {
    const m = papers.marks.get(`${paper.id}|${studentId}`) as { value: number | null; absent: boolean; exempt: boolean } | undefined;
    return {
      code: paper.subjectCode,
      label: papers.when.get(paper.assessmentId)?.label ?? NO_EXAM,
      value: m?.value ?? null,
      max: paper.maxMarks,
      absent: Boolean(m?.absent),
      pct: m && m.value !== null && paper.maxMarks ? Math.round((m.value / paper.maxMarks) * 100) : null,
    };
  });
  return {
    id: studentId,
    name: card.fullName,
    ...({canEditPhoto: photoHeld.includes(placement.classId)} as {canEditPhoto?: boolean}),
    ...({photoUrl: basics.get(studentId)?.photoPath ?? null} as {photoUrl?: string | null}),
    admissionNo: card.admissionNo,
    rollNo: placement.rollNo,
    classId: placement.classId,
    classLabel: labels.get(placement.classId) ?? "—",
    fatherName: card.fatherName,
    motherName: card.motherName,
    phone: card.guardianPhone ?? card.primaryPhone,
    dateOfBirth: basics.get(studentId)?.dateOfBirth ?? null,
    attendance: { hidden: !seesAttendance, percent: pct.percent, counted: pct.counted, present: pct.present, days: seesAttendance ? att.map((a) => ({ day: a.day, status: a.status as Mark })) : [] },
    marks: marks.sort((a, b) => a.code.localeCompare(b.code)),
    notes,
    sessionLabel,
  };
}


export type MarksLink = {
  paperId: string;
  /**
   * The paper's class. A subject card finds its paper by this, never by the
   * label: papers keep the label they were made with ("11 Arts") while the
   * class list says "Class 11 Arts", so every Class 11 and 12 card read
   * "No paper yet" beside a paper that was there (D-538).
   */
  classId: string;
  /** The class's name as every other teacher screen says it (the class list, with the school's own names). */
  classLabel: string;
  subjectCode: string;
  exam: string;
  /** The exam's Hindi name ("अर्धवार्षिक परीक्षा"); a Hindi-only teacher read "Half yearly". */
  examHi?: string;
  entered: number;
  total: number;
  submitted: boolean;
  examId: string;
  maxMarks: number | null;
  /** The teacher's own no-login marks link for this paper's exam (UI-56), when the exam office or she has made one. */
  url: string | null;
};

/**
 * "Your marks links" (RULES D): the papers for the class-subjects this
 * teacher teaches, with how many children have a mark, and her no-login link
 * for the exam (`/t/marks/<token>`, UI-56) when one is live. Opening a paper
 * here falls back to the in-app marks page.
 */
export async function marksLinks(
  staffId: string,
  sessionLabel: string,
  labels: Map<string, string>,
  /** The school day by the reader's clock (the lab clock for a test account). */
  today: string = schoolToday(),
): Promise<{ links: MarksLink[]; assigned: { class_id: string; subject_id: string }[]; sizes: Map<string, number> }> {
  const admin = createAdminClient();
  const { data: assigned } = await admin
    .from("teaching_assignments")
    .select("class_id, subject_id")
    .eq("staff_profile_id", staffId)
    .eq("session_label", sessionLabel)
    .returns<{ class_id: string; subject_id: string }[]>();
  const pairs = new Set((assigned ?? []).map((a) => `${a.class_id}|${a.subject_id}`));
  const classIds = [...new Set((assigned ?? []).map((a) => a.class_id))];
  // Saved / eligible by the one contract every marks surface uses
  // (exams/domain/progress.ts, through `trackerFor`): the paper's roster by
  // the exam's dates, and only rows holding a value, an absence or an
  // exemption — never a cleared cell, never "enrolled" ignoring dates.
  const exams = pairs.size ? openExamsForMarks(await listExams(sessionLabel).catch(() => [] as Exam[]), today) : [];
  const mine = (r: { class_id: string; subject_id: string }) => pairs.has(`${r.class_id}|${r.subject_id}`);
  const rows = exams.length ? (await papersOf(exams.map((e) => e.id)).catch(() => [])).filter(mine) : [];
  const withPapers = exams.filter((e) => rows.some((r) => r.assessment_id === e.id));
  const tracked = await Promise.all(
    withPapers.map(async (exam) => ({ exam, papers: (await trackerFor({ exam, classes: [], staff: [], onlyPapers: mine, rows }).catch(() => ({ papers: [] }))).papers })),
  );
  const enrolled = classIds.length
    ? await fetchInChunks<{ class_id: string }>(classIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
        admin.from("enrolments").select("class_id").eq("session_label", sessionLabel).eq("status", "enrolled").in("class_id", chunk),
      )
    : { data: [] as { class_id: string }[] };
  const size = enrolled.data.reduce((m, r) => m.set(r.class_id, (m.get(r.class_id) ?? 0) + 1), new Map<string, number>());
  const examIds = withPapers.map((e) => e.id);
  const tokens = new Map<string, string>();
  if (examIds.length) {
    const { data } = await fetchInChunks<{ assessment_id: string; token: string }>(examIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      admin.from("exam_marks_links").select("assessment_id, token").eq("staff_profile_id", staffId).is("revoked_at", null).in("assessment_id", chunk),
    );
    for (const row of data) tokens.set(row.assessment_id, row.token);
  }
  // Classes in school order, never by their labels as text (class-order.test.ts).
  const rank = rankOf(labels);
  const links = tracked.flatMap(({ exam, papers }) =>
    [...papers].sort((a, b) => a.classSort - b.classSort || (rank.get(a.classId) ?? 0) - (rank.get(b.classId) ?? 0) || a.subjectCode.localeCompare(b.subjectCode)).map((p) => {
      const token = tokens.get(exam.id);
      return {
        paperId: p.paperId,
        classId: p.classId,
        classLabel: labels.get(p.classId) ?? (p.classLabel || "—"),
        subjectCode: p.subjectCode,
        exam: exam.labelEn || exam.code,
        examHi: exam.labelHi || exam.labelEn || exam.code,
        entered: p.entered,
        total: p.total,
        submitted: p.entryStatus === "submitted",
        examId: exam.id,
        maxMarks: p.maxMarks ?? null,
        url: token ? marksLinkUrl(token) : null,
      };
    }),
  );
  return { links, assigned: assigned ?? [], sizes: size };
}

/* ------------------------------------------------------------------ More */

export async function loadMore(staff: CurrentStaff) {
  // One clock for the whole screen: More said "Now · P3" from the real date
  // while Today, on the lab clock, said it was a holiday (smoke 20 Oct).
  const [sessionLabel, now] = await Promise.all([resolveSessionLabel(), schoolNow(staff)]);
  if (!sessionLabel) return null;
  const today = schoolToday(now);
  const admin = createAdminClient();
  const labelsP = classLabelMap(sessionLabel);
  const publishedP = getPublishedVersion(sessionLabel);
  const [labels, held, own, , notices, prefs, leaveRows, bells, subjects, calendar, dayNames, tasks, remarks, slots, linkSet, portrait, whatsapp] = await Promise.all([
    labelsP,
    heldClassIds(staff.id, sessionLabel),
    ownClassIds(staff.id, sessionLabel),
    publishedP,
    staffNotices(staff.id, sessionLabel, 40),
    admin.from("staff_ui_preferences").select("large_text, alerts").eq("staff_profile_id", staff.id).maybeSingle<{ large_text: boolean; alerts: Record<string, boolean> | null }>(),
    myLeaveRows(staff.id, 20, sessionLabel).catch(() => [] as LeaveRow[]),
    currentBells(sessionLabel).catch(() => null),
    listSubjects().catch(() => []),
    attendanceCalendar(sessionLabel).catch(() => new Map<string, CalendarDayKind>()),
    calendarNames(sessionLabel, today, addDays(today, 14)).catch(() => new Map<string, CalendarEntry>()),
    waitingTasks(now),
    remarksToWrite(staff.id, sessionLabel, today).catch(() => 0),
    // The weekly timetable: this teacher's slots in the published version.
    publishedP.then((pub) => (pub ? listSlots(pub.id).then((all) => all.filter((s) => s.staffProfileId === staff.id)) : [])),
    labelsP.then((l) => marksLinks(staff.id, sessionLabel, l, today)),
    approvedStaffPhotos([staff.id]).catch(() => new Map<string, string>()),
    // Link my WhatsApp on My profile (D-582); a failed read leaves the card out.
    loadWhatsappLink(staff.id, staffLanguage(staff.language), Boolean(staff.viewedBy)).catch((): WhatsappLinkView | null => null),
  ]);
  const { links, assigned, sizes } = linkSet;

  // A combined period once, classes in school order (BUG-07, ST-14, ST-25).
  const rank = rankOf(labels);
  const week = mergeCombinedSlots([...slots].sort((a, b) => (rank.get(a.classId) ?? 0) - (rank.get(b.classId) ?? 0)));
  const schedule = bells ?? { id: null, label: "", periods: [], revision: 0 };
  const leave = await withCovers(staff.id, sessionLabel, leaveRows).catch(() => leaveRows.map((l) => ({ ...l, decided_by_name: null, covers: [] as MyCover[] })));
  const openToday = isSchoolOpen(today, calendar);
  // An approved leave that covers today: More must not say she is teaching now.
  const leaveToday = leaveRows.find((l) => l.status === "approved" && l.from_day <= today && l.to_day >= today) ?? null;
  return {
    sessionLabel,
    today,
    notices,
    links,
    week: week.map((s) => ({ day: s.day, period: s.period, number: periodNumber(s.period), classLabel: s.classLabel, subjectCode: s.subjectCode, ...timeOf(schedule, s.period) })),
    periodTimes: schedule.periods.map((p) => ({ number: periodNumber(p.index), starts: p.starts, ends: p.ends })),
    /** Each subject's one name in each language by code (D-524), so More says it as Today and the marks cards do. */
    subjectNames: Object.fromEntries(subjects.map((s) => [s.code, subjectWords(s.code, { en: s.nameEn, hi: s.nameHi })])) as Record<string, { en: string; hi: string }>,
    profile: {
      name: staff.displayName,
      /** The name staff call her by, so Today and More greet her the same way. */
      shortName: staff.shortName,
      ...({ photoUrl: portrait.get(staff.id) ?? null } as { photoUrl?: string | null }),
      email: staff.email,
      role: staff.role,
      // Her own class first, then the school's order (smoke 20 Oct: a jumbled list).
      classes: profileClasses(own.map((id) => ({ classId: id, classLabel: labels.get(id) ?? "—", held: held.includes(id) })), rank),
      subjects: [...new Set(assigned.map((a) => subjects.find((s) => s.id === a.subject_id)?.code).filter(Boolean) as string[])],
      largeText: Boolean(prefs.data?.large_text),
      alerts: prefs.data?.alerts ?? {},
      /** Link my WhatsApp (D-582): null when it could not be read. */
      whatsapp: whatsapp?.card ? whatsapp : null,
      /** An administrator seeing One as this person (D-544): the card is look-only. */
      lookOnly: Boolean(staff.viewedBy),
    },
    leave,
    nowMinutes: schoolClock(now).minutes,
    /** Why school is shut today, or null when it is open. */
    closed: closedWhy(today, openToday, dayNames.get(today)),
    /** Her approved leave today, if any: "full", "first_half" or "second_half". */
    leaveToday: leaveToday ? leaveToday.span : null,
    /** Closed days in the next two weeks, for the leave form. */
    closedDays: closedDaysAhead(today, calendar, dayNames),
    /** The office's tasks waiting on her. */
    tasks,
    /** Report-card remarks still to write for her classes. */
    remarks,
    /** Children on each of her classes' rolls, for the menu's lines. */
    classSizes: Object.fromEntries(sizes) as Record<string, number>,
  };
}

export type HomeData = Extract<Awaited<ReturnType<typeof loadHome>>, { periods: unknown }>;
export type AttendData = Extract<Awaited<ReturnType<typeof loadAttendance>>, { kind: "class" }>;
export type AttendChoices = Extract<Awaited<ReturnType<typeof loadAttendance>>, { kind: "choose" }>;
export type ClassData = Extract<Awaited<ReturnType<typeof loadClass>>, { kind: "class" | "subjects-only" }>;
export type SubjectData = NonNullable<Awaited<ReturnType<typeof loadSubject>>>;
export type StudentData = NonNullable<Awaited<ReturnType<typeof loadStudent>>>;
export type MoreData = NonNullable<Awaited<ReturnType<typeof loadMore>>>;
