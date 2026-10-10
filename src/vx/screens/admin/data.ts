import "server-only";

import { randomUUID } from "node:crypto";

import { assertPermission, type CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";
import { classLabelMap } from "@/modules/academics/data/academics-repo";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";
import { rankOf } from "@/modules/academics/domain/class-order";
import { termSummaries, type TermSummary } from "@/modules/assessments/data/reports-repo";
import {
  attendanceCalendar,
  attendanceRules,
  findRegister,
  latestReceipt,
  listMarks,
  registersForDay,
  rosterOn,
  studentAttendance,
} from "@/modules/attendance/data/attendance-repo";
import { listCorrections } from "@/modules/attendance/data/corrections-repo";
import { compareRoll, type AttendanceStatus } from "@/modules/attendance/domain/attendance";
import { documentsForStudent, historyForStudent, type RecordChange } from "@/modules/collection/data/documents-repo";
import { listSubmissions } from "@/modules/collection/data/submissions-repo";
import { splitByChange, type StudentDocument } from "@/modules/collection/domain/review";
import { listEnrolments } from "@/modules/enrolments/data/enrolments-repo";
import { jobsBoard } from "@/modules/jobs/data/jobs-repo";
import { enrolmentForStudent, getStudentCard, type StudentCard } from "@/modules/students/data/student-repo";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { absencesOn } from "@/modules/substitutions/data/absences-repo";
import { candidatesFor, profilesFor, readCoverDay } from "@/modules/substitutions/data/arrange-day";
import { currentBells, dutiesOn, liveOnly } from "@/modules/substitutions/data/cover-repo";
import type { CalendarDayKind } from "@/modules/academics/domain/calendar";

import { p } from "@/vx/text";
import { boardSummary, remindable, sortBoard, type ClassBoardRow, type MarkStatus } from "@/vx/screens/admin/logic";
import { T } from "@/vx/screens/admin/text";
import type { BoardData, InboxItem, SheetData, TimelineItem } from "@/vx/screens/admin/types";

/**
 * Reads behind the admin core (P5). Every function here reads through the
 * existing repositories, which keep their own permission checks; the few
 * direct reads are of this app's own tables (`vppsone`), never of fee data.
 */

const STATUS_WORD: Record<AttendanceStatus, { en: string; hi: string }> = {
  present: { en: "present", hi: "उपस्थित" },
  absent: { en: "absent", hi: "अनुपस्थित" },
  half_day: { en: "half day", hi: "आधा दिन" },
  late: { en: "late", hi: "देर से" },
  leave: { en: "leave", hi: "छुट्टी" },
};

/** Run a read; a failure becomes null and is recorded rather than shown as nought (D-93). */
async function guard<T>(missing: string[], key: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch {
    missing.push(key);
    return null;
  }
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

export async function loadBoard(sessionLabel: string, day: string): Promise<BoardData & { unavailable: string[] }> {
  const missing: string[] = [];
  const [labels, registers, enrolments, responsible, staff, absences, reminders, calendar, rules, bells] = await Promise.all([
    classLabelMap(sessionLabel),
    registersForDay(sessionLabel, day),
    listEnrolments(sessionLabel),
    guard(missing, "teachers", () => responsibleFor(sessionLabel, day)),
    guard(missing, "staff", () => listStaff()),
    guard(missing, "absences", () => absencesOn(sessionLabel, day)),
    guard(missing, "reminders", () => remindersOn(day)),
    guard<Map<string, CalendarDayKind>>(missing, "calendar", () => attendanceCalendar(sessionLabel)),
    guard(missing, "rules", () => attendanceRules(sessionLabel)),
    guard(missing, "bells", () => currentBells(sessionLabel)),
  ]);

  const rank = rankOf(labels);
  const daily = registers.filter((register) => register.period === null);
  const registerOf = new Map(daily.map((register) => [register.classId, register]));
  const recordedIds = daily.filter((register) => register.revision >= 1).map((register) => register.id);

  const tally = new Map<string, { present: number; absent: number; halfDay: number; other: number }>();
  if (recordedIds.length > 0) {
    const supabase = await createClient();
    const { data, error } = await fetchInChunks<{ register_id: string; status: AttendanceStatus }>(recordedIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      supabase.from("attendance_marks").select("register_id, status").in("register_id", chunk),
    );
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
export async function queueAttendanceReminders(sessionLabel: string, day: string, classIds: readonly string[]): Promise<number> {
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
  const commandId = randomUUID();

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
  cover: { needed: number; arranged: number } | null;
  timeline: TimelineItem[];
  unavailable: string[];
};

export async function loadToday(staff: CurrentStaff, sessionLabel: string, day: string, nowMinutes: number): Promise<TodayFacts> {
  const missing: string[] = [];
  const [board, absences, duties] = await Promise.all([
    guard(missing, "board", () => loadBoard(sessionLabel, day)),
    guard(missing, "absences", () => absencesOn(sessionLabel, day)),
    can(staff, "substitutions:view") ? guard(missing, "cover", async () => liveOnly(await dutiesOn(sessionLabel, day))) : Promise.resolve(null),
  ]);
  if (board) missing.push(...board.unavailable);

  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const stateAt = (minutes: number): TimelineItem["state"] => (minutes <= nowMinutes ? "done" : "next");

  const timeline: TimelineItem[] = [];
  const bells = [...(board?.bells ?? [])].sort((a, b) => toMin(a.starts) - toMin(b.starts));
  if (board?.schoolOpen && bells.length > 0) {
    const first = bells[0];
    timeline.push({ time: first.starts, title: T.firstBell, sub: T.periodRunning(1), state: stateAt(toMin(first.starts)) });
    const notMarked = board.rows.filter((row) => !row.recorded).length;
    timeline.push({
      time: first.ends,
      title: T.attendanceCloses,
      sub: T.notMarkedYet(notMarked),
      state: notMarked > 0 && toMin(first.ends) <= nowMinutes ? "alert" : stateAt(toMin(first.ends)),
    });
    const nameOf = new Map<string, string>();
    if ((duties ?? []).some((duty) => duty.coveringStaffId)) {
      for (const person of (await guard(missing, "staff", () => listStaff())) ?? []) nameOf.set(person.id, person.displayName);
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
    const last = bells[bells.length - 1];
    timeline.push({ time: last.ends, title: T.lastBell, state: stateAt(toMin(last.ends)) });
    timeline.sort((a, b) => toMin(a.time) - toMin(b.time));
    // "Now" is the first item still ahead.
    const nextIndex = timeline.findIndex((item) => item.state === "next");
    if (nextIndex >= 0) timeline[nextIndex] = { ...timeline[nextIndex], state: "now" };
  }

  return {
    board,
    staffAway: absences === null ? null : new Set(absences.map((row) => row.staffProfileId)).size,
    cover: duties === null ? null : { needed: duties.length, arranged: duties.filter((duty) => duty.status === "assigned").length },
    timeline,
    unavailable: [...new Set(missing)],
  };
}

/* ------------------------------------------------------------ Needs you */

const FIELD_CHANGE = (from: string | null, to: string | null) => `${from ?? "—"} → ${to ?? "—"}`;

export async function loadInbox(
  staff: CurrentStaff,
  sessionLabel: string,
  day: string,
  extra: { refunds?: () => Promise<{ id: string; studentId: string; studentName: string; amount: number; reason: string | null; requestedAt: string; href?: string; deskKind?: "reversal" | "write_off"; receiptNumber?: string | null }[]> } = {},
): Promise<{ items: InboxItem[]; unavailable: string[] }> {
  const missing: string[] = [];
  const items: InboxItem[] = [];
  const nowIso = new Date().toISOString();

  const [board, labels] = await Promise.all([
    can(staff, "attendance:mark_on_behalf") ? guard(missing, "board", () => loadBoard(sessionLabel, day)) : Promise.resolve(null),
    guard(missing, "classes", () => classLabelMap(sessionLabel)),
  ]);

  /* attendance not marked */
  if (board && board.schoolOpen) {
    const open = board.rows.filter((row) => !row.recorded);
    const first = [...board.bells].sort((a, b) => a.starts.localeCompare(b.starts))[0];
    if (open.length > 0) {
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
  if (can(staff, "substitutions:manage")) {
    const cover = await guard(missing, "cover", async () => {
      const coverDay = await readCoverDay(sessionLabel, day);
      const needing = coverDay.live.filter((duty) => duty.status === "needs_help");
      if (needing.length === 0) return [];
      const profiles = await profilesFor(coverDay);
      const nameOf = new Map(coverDay.staff.map((person) => [person.id, person.displayName]));
      for (const absence of coverDay.absences) nameOf.set(absence.staffProfileId, absence.staffName);
      return needing.map((duty) => {
        const candidates = candidatesFor(coverDay, profiles.everyone, profiles.history, duty).map((candidate) => ({
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

  /* attendance corrections */
  if (can(staff, "attendance:correct") && labels) {
    const corrections = await guard(missing, "corrections", () => listCorrections(sessionLabel, labels));
    for (const c of (corrections ?? []).filter((entry) => entry.status === "pending")) {
      const from = c.fromStatus ? STATUS_WORD[c.fromStatus] : { en: "not marked", hi: "दर्ज नहीं" };
      const to = STATUS_WORD[c.toStatus];
      items.push({
        id: `correction:${c.id}`,
        type: "attendance",
        kind: "correction",
        at: c.requestedAt,
        urgent: false,
        badge: T.bCorrection,
        title: T.correctionTitle(c.studentName, c.classLabel, c.day),
        sub: p(`${c.classLabel} · ${from.en} → ${to.en} on ${c.day}`, `${c.classLabel} · ${c.day} को ${from.hi} → ${to.hi}`),
        body: p(c.reason),
        facts: [
          { label: T.change, value: `${from.en} → ${to.en}` },
          { label: T.day, value: c.day },
          { label: T.askedBy, value: c.requestedByName },
          { label: T.reason, value: c.reason },
        ],
        footnote: T.correctionFootnote,
        href: "/teach/corrections",
        correctionId: c.id,
        ownRequest: c.requestedById === staff.id,
      });
    }
  }

  /* answers waiting to be checked */
  if (can(staff, "collection:manage")) {
    const pending = await guard(missing, "submissions", () => listSubmissions("pending"));
    if (pending && pending.length > 0) {
      const { changes, confirmations } = splitByChange(pending);
      for (const s of changes.slice(0, 40)) {
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
  }

  /* refunds (fee screen decides them) */
  if (extra.refunds) {
    const refunds = await guard(missing, "refunds", extra.refunds);
    for (const r of refunds ?? []) {
      const amount = `₹${new Intl.NumberFormat("en-IN").format(Math.round(r.amount))}`;
      items.push({
        id: `refund:${r.id}`,
        type: "money",
        kind: "refund",
        at: r.requestedAt,
        urgent: false,
        badge: r.deskKind === "reversal" ? p("Reversal", "रसीद रद्द") : r.deskKind === "write_off" ? p("Write-off", "माफ़ी") : T.bRefund,
        title:
          r.deskKind === "reversal"
            ? p(`Reverse receipt ${r.receiptNumber ?? ""} · ${amount} · ${r.studentName}`.replace("  ", " "), `रसीद ${r.receiptNumber ?? ""} रद्द · ${amount} · ${r.studentName}`.replace("  ", " "))
            : r.deskKind === "write_off"
              ? p(`Write off ${amount} · ${r.studentName}`, `${amount} माफ़ · ${r.studentName}`)
              : T.refundTitle(amount, r.studentName),
        sub: p(r.reason ?? "—"),
        facts: [
          { label: p("Amount", "राशि"), value: amount },
          { label: T.reason, value: r.reason ?? "—" },
        ],
        footnote: r.deskKind ? p("Decided on the receipt or dues screen; nothing moves until you confirm it there.", "फ़ैसला रसीद या बकाया स्क्रीन पर होता है; वहाँ पुष्टि के बिना कुछ नहीं बदलता।") : T.refundFootnote,
        href: r.href ?? "/fees/finance-controls",
      });
    }
  }

  /* jobs that failed */
  if (can(staff, "jobs:view")) {
    const jobs = await guard(missing, "jobs", () => jobsBoard());
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
  }

  return { items, unavailable: missing };
}

/* --------------------------------------------------------- Student 360 */

export type StudentSchool = {
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
  // The card is read beside everything else rather than first: a child who
  // does not exist costs a few wasted reads, and every child who does is shown
  // one round trip sooner.
  const missing: string[] = [];
  const [card, enrolment, labels, attendance, rules, calendar, terms, documents, history] = await Promise.all([
    getStudentCard(studentId),
    enrolmentForStudent(studentId, sessionLabel),
    classLabelMap(sessionLabel),
    guard(missing, "attendance", () => studentAttendance(studentId, sessionLabel)),
    guard(missing, "rules", () => attendanceRules(sessionLabel)),
    guard(missing, "calendar", () => attendanceCalendar(sessionLabel)),
    can(staff, "marks:view") ? guard(missing, "marks", () => termSummaries(studentId, sessionLabel)) : Promise.resolve(null),
    can(staff, "documents:view") ? guard(missing, "documents", () => documentsForStudent(studentId)) : Promise.resolve(null),
    can(staff, "collection:view") ? guard(missing, "history", () => historyForStudent(studentId)) : Promise.resolve(null),
  ]);
  if (!card) return null;

  const credit = rules?.halfDayCredit ?? 0.5;
  // As the register sheet counts: leave is left out, late counts as present.
  const counted = (attendance ?? []).filter((row) => row.status === "present" || row.status === "late" || row.status === "absent" || row.status === "half_day");
  const presentCredit = counted.reduce((sum, row) => sum + (row.status === "present" || row.status === "late" ? 1 : row.status === "half_day" ? credit : 0), 0);
  const classId = enrolment?.classId ?? card.classId;

  return {
    card,
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
