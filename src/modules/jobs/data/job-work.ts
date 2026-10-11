import "server-only";

import { randomUUID } from "node:crypto";

import { ACTIVE_SESSION_KEY, pickSessionLabel } from "@/platform/config/active-session";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import {
  isSchoolOpen,
  type CalendarDayKind,
} from "@/modules/academics/domain/calendar";
import { isEntered } from "@/modules/assessments/domain/assessments";
import type { JobName } from "@/modules/jobs/domain/jobs";
import { dispatchStaffNotices } from "@/modules/staff-notices/data/dispatcher";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import { firstPeriodEnds, schoolClock } from "@/modules/timetable/domain/bells";
import { FEE_SCHEMA } from "@/platform/env";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { SCHOOL_UTC_OFFSET_MINUTES } from "@/platform/dates";

/**
 * What each job actually does.
 *
 * **Every query here uses the service-role client, and that is not a
 * shortcut.** A job has no session: it is a cron request with a secret, and
 * there is no signed-in person for RLS to be about. The permission question
 * was answered before any of this ran — by the secret for a scheduled run, and
 * by `jobs:run` for one somebody pressed. Reaching for the cookie client here
 * would read zero rows and report a quiet, cheerful nothing.
 *
 * Each returns the summary that goes in its `job_runs` row: plain counts,
 * because the only thing anybody wants from a scheduler at eight in the
 * morning is a number they can compare with yesterday's.
 */

type Summary = Record<string, number | string>;

/**
 * Read, or fail loudly.
 *
 * **A job that swallows a query error reports a confident zero**, and a
 * confident zero from a scheduler is worse than a crash: "19 classes have no
 * class teacher" reads like a finding about the school rather than a broken
 * query, and it is exactly what this file did until somebody checked the
 * column names. `runJob()` catches whatever this throws and writes it into the
 * run, where it is visible as a failure instead of a fact.
 */
async function must<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  what: string,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not read ${what}: ${error.message}`);
  return (data ?? []) as T;
}

/**
 * The session the nightly jobs work in.
 *
 * Same correction as `resolveSessionLabel()`, and it matters more here: a job
 * runs with nobody watching. Sorting the labels and taking the last picks
 * `TEST-2026-27` over `2026-27` on any database carrying the rehearsal
 * session, so every scheduled job would have read and written the rehearsal
 * year — and reported success. See `src/platform/config/active-session.ts`.
 *
 * `assertStaff()` rules out calling `resolveSessionLabel()` from here: a cron
 * has a machine credential, not a member of staff.
 */
async function currentSession(): Promise<string | null> {
  const [setting, data] = await Promise.all([
    must(
      createAdminClient()
        .schema("public")
        .from("app_settings")
        .select("value")
        .eq("key", ACTIVE_SESSION_KEY),
      "the active session",
    ),
    must(
      createAdminClient().schema("public").from("classes").select("session_label"),
      "the sessions",
    ),
  ]);

  return pickSessionLabel({
    active: (setting as { value: string | null }[])[0]?.value,
    labels: [...new Set(data.map((row) => row.session_label as string))],
  });
}

async function calendarFor(sessionLabel: string): Promise<Map<string, CalendarDayKind>> {
  const data = await must(
    createAdminClient()
      .from("academic_calendar_days")
      .select("day, kind")
      .eq("session_label", sessionLabel),
    "the calendar",
  );

  // `calendarIndex()` only ever reads `day` and `kind`, so the two columns it
  // uses are the two this asks for. Building the full `CalendarDay` here would
  // mean selecting labels nothing on this path renders.
  return new Map(
    data.map((row) => [row.day as string, row.kind as CalendarDayKind]),
  );
}

/** Classes that have at least one child on the roll this session. */
async function classesWithChildren(sessionLabel: string) {
  const rows = await fetchAllRows(
    (from, to) =>
      createAdminClient()
        .from("enrolments")
        .select("class_id, student_id")
        .eq("session_label", sessionLabel)
        .eq("status", "enrolled")
        .range(from, to),
    "the enrolments",
  );

  const byClass = new Map<string, number>();
  for (const row of rows as { class_id: string }[]) {
    byClass.set(row.class_id, (byClass.get(row.class_id) ?? 0) + 1);
  }
  return byClass;
}

/* ------------------------------------------------- 1. open the registers */

/**
 * Open today's register for every class that has children.
 *
 * The register a teacher marks is a row somebody has to create, and asking
 * forty teachers to create one every morning is asking for the mornings where
 * half of them do not. Opening them is the whole job.
 *
 * It creates only what is missing, so running it again changes nothing — which
 * is what makes a cron that fires twice harmless even before `runJob()` skips
 * the second one.
 */
export async function openRegisters(day: string): Promise<Summary> {
  const sessionLabel = await currentSession();
  if (!sessionLabel) return { opened: 0, note: "no session" };

  const calendar = await calendarFor(sessionLabel);

  // A holiday has no register, and one opened on a holiday is a register that
  // will sit unsubmitted and be counted as somebody's fault tomorrow.
  if (!isSchoolOpen(day, calendar)) {
    return { opened: 0, note: "school closed today" };
  }

  const admin = createAdminClient();
  const byClass = await classesWithChildren(sessionLabel);

  const existing = await must(
    admin
      .from("attendance_registers")
      .select("class_id")
      .eq("session_label", sessionLabel)
      .eq("day", day),
    "today's registers",
  );

  const already = new Set(existing.map((row) => row.class_id as string));
  const missing = [...byClass.keys()].filter((classId) => !already.has(classId));

  if (missing.length > 0) {
    const { error } = await admin.from("attendance_registers").insert(
      missing.map((classId) => ({
        session_label: sessionLabel,
        class_id: classId,
        day,
        period: null,
        status: "open",
        // Nobody took it. The teacher who marks it becomes `taken_by` when she
        // submits — stamping this job's name there would put a name against a
        // register no person has looked at.
        taken_by: null,
      })),
    );
    if (error) throw error;
  }

  return {
    classes: byClass.size,
    opened: missing.length,
    already_open: already.size,
  };
}

/* ------------------------------------------- shared: who to nudge, and how */

type StaffContact = { id: string; name: string; phone: string | null };

async function classTeachers(
  sessionLabel: string,
): Promise<Map<string, StaffContact>> {
  const admin = createAdminClient();

  // `effective_from` / `effective_to`, and `role = 'class_teacher'` — an
  // assistant is not the person to ask about a register. An open row is one
  // with no `effective_to`, which is the same rule `getCurrentClassTeacher()`
  // uses; a class mid-handover has exactly one.
  const open = await must(
    admin
      .from("class_teachers")
      .select("class_id, staff_profile_id")
      .eq("session_label", sessionLabel)
      .eq("role", "class_teacher")
      .is("effective_to", null),
    "the class teachers",
  );

  const ids = [...new Set(open.map((row) => row.staff_profile_id as string))];
  if (ids.length === 0) return new Map();

  const staff = await must(
    admin
      .from("staff_profiles")
      .select("id, display_name, phone, whatsapp_phone, is_active")
      .in("id", ids),
    "the staff",
  );

  const byId = new Map(
    staff
      .filter((row) => row.is_active)
      .map((row) => [
        row.id as string,
        {
          id: row.id as string,
          name: row.display_name as string,
          phone: (row.whatsapp_phone ?? row.phone) as string | null,
        },
      ]),
  );

  const byClass = new Map<string, StaffContact>();
  for (const row of open) {
    const contact = byId.get(row.staff_profile_id as string);
    if (contact) byClass.set(row.class_id as string, contact);
  }
  return byClass;
}

/** Name and number for a set of staff, active ones only. */
async function staffContacts(ids: string[]): Promise<Map<string, StaffContact>> {
  const found = new Map<string, StaffContact>();
  for (const chunk of chunkArray(ids, IN_FILTER_CHUNK_SIZE)) {
    const rows = await must(
      createAdminClient()
        .from("staff_profiles")
        .select("id, display_name, phone, whatsapp_phone, is_active")
        .in("id", chunk),
      "the staff",
    );
    for (const row of rows as {
      id: string;
      display_name: string;
      phone: string | null;
      whatsapp_phone: string | null;
      is_active: boolean;
    }[]) {
      if (row.is_active) found.set(row.id, { id: row.id, name: row.display_name, phone: row.whatsapp_phone ?? row.phone });
    }
  }
  return found;
}

const fill = (body: string, values: string[]) =>
  body.replace(/\{\{(\d+)\}\}/g, (whole, index) => values[Number(index) - 1] ?? whole);

/**
 * Who has already had *this* reminder today.
 *
 * Keyed on the template, not merely on the person: two jobs ask two different
 * questions, and a teacher who has been nudged about marks has not thereby
 * been asked about her register. Matching on any message at all is how a
 * reminder silently stops arriving.
 */
async function alreadyRemindedWith(
  templateCode: string,
  sessionLabel: string,
  day: string,
): Promise<Set<string>> {
  const admin = createAdminClient();

  const { data: template } = await admin
    .from("message_templates")
    .select("id")
    .eq("code", templateCode)
    .maybeSingle();

  if (!template) return new Set();

  const sent = await must(
    admin
      .from("message_sends")
      .select("staff_profile_id")
      .eq("session_label", sessionLabel)
      .eq("template_id", template.id)
      .gte("requested_at", `${day}T00:00:00Z`),
    "the reminders already sent",
  );

  return new Set(
    sent
      .map((row) => row.staff_profile_id as string | null)
      .filter((id): id is string => id !== null),
  );
}

/**
 * Prepare a message for a member of staff. **Prepared, not sent.**
 *
 * Written as a `draft`, which is where Phase 5 left every message this app
 * produces: the office opens the messages screen, reads what it says, and
 * sends it. A job that dispatched on its own would be the one thing D-10 and
 * D-76 exist to prevent, at the worst possible hour, with nobody watching —
 * and `mayDispatch()` would refuse it anyway if it were aimed at a parent.
 */
async function draftStaffMessage(input: {
  sessionLabel: string;
  templateCode: string;
  to: StaffContact;
  variables: string[];
}): Promise<boolean> {
  if (!input.to.phone) return false;

  const admin = createAdminClient();

  const { data: template, error: templateError } = await admin
    .from("message_templates")
    .select("id, body_hi, body_en, audience, is_active")
    .eq("code", input.templateCode)
    .maybeSingle();

  if (templateError) {
    throw new Error(`Could not read the template: ${templateError.message}`);
  }

  // A missing or parent-facing template is a refusal, not a crash: the job's
  // other findings are still worth writing down, and the count of what it
  // could not draft is the thing that says something is misconfigured.
  if (!template || template.audience !== "staff" || template.is_active === false) {
    return false;
  }

  const { error } = await admin.from("message_sends").insert({
    session_label: input.sessionLabel,
    template_id: template.id,
    to_phone: input.to.phone,
    to_name: input.to.name,
    staff_profile_id: input.to.id,
    variables: input.variables,
    rendered_hi: fill(template.body_hi as string, input.variables),
    rendered_en: fill(template.body_en as string, input.variables),
    status: "draft",
    requested_by: null,
  });

  if (error) throw error;
  return true;
}

/* ------------------------------------------------ 2. attendance reminder */

/** The instant a school-clock time falls on a day. */
function schoolMoment(day: string, minutes: number): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + (minutes - SCHOOL_UTC_OFFSET_MINUTES) * 60_000);
}

/**
 * Who answers for each class's register on a day: the class teacher in
 * effect that day, or the assistant when there is none. Not the one in effect
 * today — a reminder about Tuesday goes to whoever held the class on Tuesday.
 */
async function responsibleForRegisters(sessionLabel: string, day: string): Promise<Map<string, string>> {
  const rows = await must(
    createAdminClient()
      .from("class_teachers")
      .select("class_id, staff_profile_id, role, effective_from, effective_to")
      .eq("session_label", sessionLabel),
    "the class teachers",
  );
  const byClass = new Map<string, { staff: string; role: string }>();
  for (const row of rows as {
    class_id: string;
    staff_profile_id: string;
    role: string;
    effective_from: string | null;
    effective_to: string | null;
  }[]) {
    if (row.effective_from && row.effective_from > day) continue;
    if (row.effective_to && row.effective_to < day) continue;
    const held = byClass.get(row.class_id);
    if (!held || (held.role !== "class_teacher" && row.role === "class_teacher")) {
      byClass.set(row.class_id, { staff: row.staff_profile_id, role: row.role });
    }
  }
  return new Map([...byClass].map(([classId, held]) => [classId, held.staff]));
}

/**
 * Remind whoever answers for each register still outstanding (P6).
 *
 * After the first period, by the school's own bells: the cron is a daily
 * trigger with an hour's slack, so a run that wakes before the first period
 * has ended asks nobody. Each reminder is a staff notice in the P4 outbox,
 * keyed by class, day and person, so a second run the same day adds nothing;
 * and the outbox checks again at the moment it sends — a register saved in
 * between, or a teacher no longer responsible, and the reminder is
 * suppressed rather than sent. "Not saved" never means "everyone present".
 */
export async function attendanceReminder(day: string): Promise<Summary> {
  const sessionLabel = await currentSession();
  if (!sessionLabel) return { outstanding: 0, note: "no session" };

  const calendar = await calendarFor(sessionLabel);
  if (!isSchoolOpen(day, calendar)) {
    return { outstanding: 0, note: "school closed today" };
  }

  const bells = await currentBells(sessionLabel);
  const firstEnds = firstPeriodEnds(bells);
  const clock = schoolClock(new Date());
  if (firstEnds !== null && clock.day === day && clock.minutes < firstEnds) {
    return { outstanding: 0, note: "the first period has not ended yet" };
  }

  const admin = createAdminClient();
  const byClass = await classesWithChildren(sessionLabel);

  const registers = await must(
    admin
      .from("attendance_registers")
      .select("class_id, revision")
      .eq("session_label", sessionLabel)
      .eq("day", day)
      .is("period", null),
    "today's registers",
  );
  const recorded = new Set(
    (registers as { class_id: string; revision: number }[])
      .filter((row) => row.revision >= 1)
      .map((row) => row.class_id),
  );

  const outstanding = [...byClass.keys()].filter((classId) => !recorded.has(classId));
  const responsible = await responsibleForRegisters(sessionLabel, day);
  const classes = await must(
    admin.schema(FEE_SCHEMA).from("classes").select("id, class_name"),
    "the classes",
  );
  const labelOf = new Map(
    (classes as { id: string; class_name: string }[]).map((row) => [row.id, row.class_name]),
  );

  // Worth sending until the school day is over; after that it is noise.
  const lastEnds = Math.max(
    ...bells.periods.map((period) => {
      const [hours, minutes] = period.ends.split(":").map(Number);
      return hours * 60 + minutes;
    }),
  );
  const notAfter = schoolMoment(day, Number.isFinite(lastEnds) ? lastEnds : 23 * 60 + 59).toISOString();
  const commandId = randomUUID();

  const rows = outstanding.flatMap((classId) => {
    const staffId = responsible.get(classId);
    if (!staffId) return [];
    return [
      {
        notice_key: `attendance:${classId}:${day}:${staffId}`,
        kind: "attendance_reminder",
        class_id: classId,
        class_label: labelOf.get(classId) ?? null,
        staff_profile_id: staffId,
        session_label: sessionLabel,
        day,
        not_after: notAfter,
        command_id: commandId,
      },
    ];
  });

  let queued = 0;
  if (rows.length > 0) {
    const { data, error } = await admin
      .from("staff_notices")
      .upsert(rows, { onConflict: "notice_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Could not queue the reminders: ${error.message}`);
    queued = data?.length ?? 0;
  }

  const sent = queued > 0 ? await dispatchStaffNotices({ max: queued + 5 }) : null;

  return {
    classes: byClass.size,
    outstanding: outstanding.length,
    queued,
    no_class_teacher: outstanding.filter((classId) => !responsible.has(classId)).length,
    ...(sent
      ? {
          transport: sent.transport,
          accepted: sent.accepted,
          unknown: sent.unknown,
          failed: sent.failed,
        }
      : {}),
  };
}

/* ---------------------------------------------- 3. missing marks nudge */

/**
 * Papers in an open exam that still have marks outstanding.
 *
 * A finished paper is not outstanding, and an exam that is locked or still a
 * draft is nobody's homework — so only open exams count, which is the same
 * rule the marks grid enforces at the other end.
 */
export async function missingMarksNudge(day: string): Promise<Summary> {
  const sessionLabel = await currentSession();
  if (!sessionLabel) return { papers_outstanding: 0, note: "no session" };

  const admin = createAdminClient();

  const openExams = await must(
    admin
      .from("assessments")
      .select("id")
      .eq("session_label", sessionLabel)
      .eq("status", "open"),
    "the open exams",
  );

  const examIds = openExams.map((row) => row.id as string);
  if (examIds.length === 0) return { exams_open: 0, papers_outstanding: 0, drafted: 0 };

  const papers = await must(
    admin
      .from("assessment_subjects")
      .select("id, class_id, class_label, subject_id, subject_code, entry_status")
      .in("assessment_id", examIds),
    "the papers",
  );

  const paperList = papers as {
    id: string;
    class_id: string;
    class_label: string;
    subject_id: string;
    subject_code: string;
    entry_status: "open" | "submitted";
  }[];

  if (paperList.length === 0) {
    return { exams_open: examIds.length, papers_outstanding: 0, drafted: 0 };
  }

  // Chunked: a few open exams across every class pass the ~300 ids a URL
  // holds (rule 3b), and paged within each chunk past the 1000-row cap.
  const marks: { assessment_subject_id: string; value: number | string | null; absent: boolean; exempt: boolean }[] = [];
  for (const chunk of chunkArray(paperList.map((paper) => paper.id), IN_FILTER_CHUNK_SIZE)) {
    marks.push(
      ...((await fetchAllRows(
        (from, to) =>
          admin
            .from("marks")
            .select("assessment_subject_id, student_id, value, absent, exempt")
            .in("assessment_subject_id", chunk)
            .range(from, to),
        "the marks",
      )) as typeof marks),
    );
  }

  const entered = new Map<string, number>();
  for (const row of marks) {
    if (
      !isEntered({
        value: row.value === null ? null : Number(row.value),
        absent: row.absent,
        exempt: row.exempt,
      })
    ) {
      continue;
    }
    const key = row.assessment_subject_id;
    entered.set(key, (entered.get(key) ?? 0) + 1);
  }

  const byClass = await classesWithChildren(sessionLabel);

  // A paper is the teacher's task until she submits it (P7) — a full column
  // she has not submitted is still hers to check.
  const outstanding = paperList.filter((paper) => {
    const expected = byClass.get(paper.class_id) ?? 0;
    return expected > 0 && paper.entry_status !== "submitted";
  });

  const marksOutstanding = outstanding.reduce((total, paper) => {
    const expected = byClass.get(paper.class_id) ?? 0;
    return total + Math.max(0, expected - (entered.get(paper.id) ?? 0));
  }, 0);

  // The subject teacher the timetable gives the paper to — the person who
  // enters its marks (P7) — and the class teacher only where nobody teaches
  // the subject.
  const [teachers, assignments] = await Promise.all([
    classTeachers(sessionLabel),
    must(
      admin
        .from("teaching_assignments")
        .select("class_id, subject_id, staff_profile_id")
        .eq("session_label", sessionLabel),
      "the teaching assignments",
    ),
  ]);
  const subjectTeacher = new Map<string, string>();
  for (const row of assignments as { class_id: string; subject_id: string; staff_profile_id: string }[]) {
    subjectTeacher.set(`${row.class_id}|${row.subject_id}`, row.staff_profile_id);
  }
  const contacts = await staffContacts([...new Set(subjectTeacher.values())]);

  // One message per teacher, however many of her papers are behind: four
  // messages about four papers is how a reminder becomes something people mute.
  const perTeacher = new Map<string, { contact: StaffContact; papers: string[] }>();

  for (const paper of outstanding) {
    const assigned = subjectTeacher.get(`${paper.class_id}|${paper.subject_id}`);
    const teacher = (assigned ? contacts.get(assigned) : undefined) ?? teachers.get(paper.class_id);
    if (!teacher?.phone) continue;
    const entry = perTeacher.get(teacher.id) ?? { contact: teacher, papers: [] };
    entry.papers.push(`${paper.class_label} ${paper.subject_code}`);
    perTeacher.set(teacher.id, entry);
  }

  // The same guard the attendance reminder uses: a forced re-run should not
  // hand somebody the same nudge twice.
  const alreadyAsked = await alreadyRemindedWith(
    "vppsone_marks_reminder",
    sessionLabel,
    day,
  );

  let drafted = 0;
  for (const { contact, papers: names } of perTeacher.values()) {
    if (alreadyAsked.has(contact.id)) continue;

    const wrote = await draftStaffMessage({
      sessionLabel,
      templateCode: "vppsone_marks_reminder",
      to: contact,
      variables: [contact.name, names.sort().join(", ")],
    });
    if (wrote) drafted += 1;
  }

  return {
    exams_open: examIds.length,
    papers: paperList.length,
    papers_outstanding: outstanding.length,
    marks_outstanding: marksOutstanding,
    drafted,
  };
}

/* -------------------------------------------------------- 4. daily summary */

/**
 * The day, in numbers, written down once.
 *
 * Not a message and not a screen — a row. The value is that it is still there
 * in a month, when somebody asks whether attendance really was worse in
 * September, and nothing else in this app would remember.
 */
export async function dailySummary(day: string): Promise<Summary> {
  const sessionLabel = await currentSession();
  if (!sessionLabel) return { note: "no session" };

  const admin = createAdminClient();
  const calendar = await calendarFor(sessionLabel);
  const open = isSchoolOpen(day, calendar);

  const byClass = await classesWithChildren(sessionLabel);
  const children = [...byClass.values()].reduce((a, b) => a + b, 0);

  const registers = await must(
    admin
      .from("attendance_registers")
      .select("id, class_id, status")
      .eq("session_label", sessionLabel)
      .eq("day", day),
    "today's registers",
  );

  const registerList = registers as {
    id: string;
    class_id: string;
    status: string;
  }[];

  const submitted = registerList.filter((row) => row.status === "submitted");

  const marks =
    submitted.length === 0
      ? []
      : await must(
          admin
            .from("attendance_marks")
            .select("status")
            .in(
              "register_id",
              submitted.map((row) => row.id),
            ),
          "today's attendance",
        );

  const present = marks.filter(
    (row) => row.status === "present" || row.status === "late",
  ).length;
  const counted = marks.filter((row) => row.status !== "leave").length;

  // The day's live cover duties (P3). Every live row is committed and
  // published; "needs help" is the honest name for what used to be written
  // down as self study or a merged class.
  const duties = await must(
    admin
      .from("cover_duties")
      .select("status")
      .eq("session_label", sessionLabel)
      .eq("day", day)
      .in("status", ["assigned", "needs_help"]),
    "today's cover",
  );

  const { count: pendingCount, error: pendingError } = await admin
    .from("collection_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (pendingError) {
    throw new Error(`Could not count the answers to review: ${pendingError.message}`);
  }

  return {
    school_open: open ? "yes" : "no",
    classes: byClass.size,
    children,
    registers_submitted: submitted.length,
    // **Nothing is outstanding on a day the school was shut.** Subtracting
    // what was submitted from the number of classes reported "19 registers
    // outstanding" every Sunday, which reads as nineteen teachers having
    // failed to take one — a number somebody would chase on a Monday.
    registers_outstanding: open ? byClass.size - submitted.length : 0,
    attendance_percent:
      counted === 0 ? "—" : String(Math.round((present / counted) * 1000) / 10),
    cover_duties: duties.length,
    covers_arranged: duties.filter((row) => row.status === "assigned").length,
    cover_needs_help: duties.filter((row) => row.status === "needs_help").length,
    answers_to_review: pendingCount ?? 0,
  };
}

/* ------------------------------------------------------------- dispatch */

/** Send what is due and settle what is stuck (P4). The day is not used: due is due. */
async function staffNotices(): Promise<Summary> {
  const result = await dispatchStaffNotices({ max: 50 });
  return {
    transport: result.transport,
    claimed: result.claimed,
    accepted: result.accepted,
    failed: result.failed,
    unknown: result.unknown,
    released: result.swept.released,
    became_unknown: result.swept.unknown,
    stopped: result.stopped,
  };
}

export const jobWork: Record<JobName, (day: string) => Promise<Summary>> = {
  "open-registers": openRegisters,
  "attendance-reminder": attendanceReminder,
  "missing-marks-nudge": missingMarksNudge,
  "daily-summary": dailySummary,
  "staff-notices": staffNotices,
};
