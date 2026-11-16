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
import { queueStaffNotice, queueStaffNoticeToPermission } from "@/modules/staff-notices/data/enqueue";
import { loadDeskReceipts } from "@/modules/receipts/vx/data";
import { DESK_MODES, latestCloseState, summarizeReceipts } from "@/modules/receipts/vx/domain/day-close";
import { isConfinedDeployment } from "@/platform/deployment/confinement";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { feesBridgeEnabled } from "@/platform/fees-bridge/policy";
import { readFeesBridgeState } from "@/platform/fees-bridge/state";
import { runDocumentBackup } from "@/modules/collection/data/drive-documents";
import { runDriveBackup } from "@/modules/archives/data/drive-backup-job";
import { purgeBuiltinAiInputs } from "@/lib/ai/jobs";
import { purgeAssistLog } from "@/modules/assist/data/log";
import { purgeDrafts } from "@/modules/assist/data/drafts";
import { prepareClassDigests, prepareCoverPlans } from "@/modules/assist/data/prepare";
import { ASSIST_LOG_RETENTION_DAYS } from "@/modules/assist/domain/retention";
import { vercelOidcToken } from "@/platform/google/vercel-oidc";
import { currentBells } from "@/modules/substitutions/data/school-rules-repo";
import { firstPeriodEnds, schoolClock } from "@/modules/timetable/domain/bells";
import { createAbsoluteUrl, FEE_SCHEMA } from "@/platform/env";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { addDays, SCHOOL_UTC_OFFSET_MINUTES } from "@/platform/dates";
import {
  alertKey,
  alertPayload,
  evaluateHealth,
  healthSummary,
  needsAttention,
  WEBHOOK_PROBE_REQUEST,
  webhookProbeFinding,
} from "@/modules/ops-health/domain/health";

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
  if (feesBridgeEnabled()) return (await readFeesBridgeState()).active_session_label;
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
    feesBridgeEnabled() && !isTestSessionLabel(sessionLabel)
      ? admin.from("fees_bridge_classes").select("id, class_name").eq("session_label",sessionLabel)
      : admin.schema(FEE_SCHEMA).from("classes").select("id, class_name").eq("session_label",sessionLabel),
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

  // A staff notice in the outbox each (go-live Phase F; it used to be a
  // message_sends draft somebody sent by hand). Keyed by day and teacher, so a
  // forced re-run hands nobody the same nudge twice; the outbox asks consent
  // and the limits when it sends, and holds it for 07:00 if it runs late.
  let queued = 0;
  for (const { contact, papers: names } of perTeacher.values()) {
    const id = await queueStaffNotice({
      key: `marks:${sessionLabel}:${day}:${contact.id}`,
      kind: "marks_reminder",
      staffId: contact.id,
      sessionLabel,
      payload: { papers: names.sort().join(", ") },
      notAfter: schoolMoment(addDays(day, 2), 20 * 60),
    });
    if (id) queued += 1;
  }
  const sent = queued > 0 ? await dispatchStaffNotices({ max: queued + 5 }) : null;

  return {
    exams_open: examIds.length,
    papers: paperList.length,
    papers_outstanding: outstanding.length,
    marks_outstanding: marksOutstanding,
    queued,
    ...(sent ? { transport: sent.transport, accepted: sent.accepted, held: sent.held, suppressed: sent.suppressed } : {}),
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

/* --------------------------------------------- 5. the fee day, for staff */

/**
 * The fee day's money for the office (go-live Phase F, plan §8.2): what came
 * in (19:00) and, at 20:00, whether the day was closed. Both read the desk's
 * own figures (`loadDeskReceipts` + `summarizeReceipts`, the numbers the
 * Receipts desk closes against) and queue a staff notice for everybody with
 * `fees:accounts`; the outbox asks consent and the limits when it sends.
 *
 * Both also run for the TEST session (review of PR #148), so each kind can be
 * rehearsed end to end under TEST-2026-27: the TEST pass's notices are TEST-
 * session notices, which the outbox sends only to numbers on the test list. A
 * confined deployment (anything but Vercel production) runs the TEST pass
 * only and never looks at a real session (D-346).
 */
type DayFigures = { sessionLabel: string; count: number; net: number; byMode: Record<string, number> };

/** The sessions the fee day is told about: the real one (production only) and every TEST one. */
async function feeDaySessions(): Promise<{ real: string | null; test: string[] }> {
  const classes = await must(
    createAdminClient().schema("public").from("classes").select("session_label"),
    "the sessions",
  );
  const test = [...new Set((classes as { session_label: string | null }[]).map((row) => row.session_label ?? ""))]
    .filter((label) => isTestSessionLabel(label))
    .sort();
  if (isConfinedDeployment()) return { real: null, test };
  const active = await currentSession();
  return { real: active && !isTestSessionLabel(active) ? active : null, test };
}

async function feeDayFigures(sessionLabel: string, day: string): Promise<DayFigures> {
  const { rows, truncated } = await loadDeskReceipts(sessionLabel, day, day);
  if (truncated) throw new Error("The day's receipt list is incomplete; nothing was queued.");
  const summary = summarizeReceipts(rows.filter((row) => row.paymentDate === day));
  return {
    sessionLabel,
    count: summary.count,
    net: summary.net,
    byMode: Object.fromEntries(DESK_MODES.map((mode) => [mode, summary.byMode[mode].amount])),
  };
}

/**
 * Whether the real year's fee day is One's to tell staff about (D-648). Not
 * while One's real year is the night's copy of the Fees app: the office takes
 * the money and closes its day in Fees, and the copy is a night behind, so a
 * summary from it would be part of a day, or a day "not closed" that was. The
 * Fees app keeps the real year's fee day until real fee writes are open in
 * One (takeover day). An unreadable setting is not One's.
 */
async function realFeeDayIsOnes(): Promise<boolean> {
  const { data, error } = await createAdminClient()
    .schema("public")
    .from("app_settings")
    .select("value")
    .eq("key", "fee_writes_enabled");
  if (error) return false;
  return (data as { value: string | null }[] | null)?.[0]?.value === "true";
}

/**
 * Run one fee-day pass per session and say what happened: the real session's
 * numbers as before, and the TEST pass's under `test_…` keys. One dispatch at
 * the end sends whatever was queued.
 */
async function feeDayPasses(
  day: string,
  pass: (figures: DayFigures) => Promise<Summary & { queued: number }>,
): Promise<Summary> {
  if (feesBridgeEnabled()) return { queued: 0, note: "Fees owns financial day summaries during coexistence" };
  const sessions = await feeDaySessions();
  let summary: Summary = {};
  let queuedTotal = 0;
  if (sessions.real && !(await realFeeDayIsOnes())) {
    summary = { queued: 0, note: "the real year is the night's copy of the Fees app, which keeps its fee day" };
  } else if (sessions.real) {
    const figures = await feeDayFigures(sessions.real, day);
    // A day with no receipts says nothing worth a message.
    const result = figures.count === 0 ? { receipts: 0, queued: 0, note: "no receipts today" } : await pass(figures);
    summary = { ...result };
    queuedTotal += result.queued;
  } else {
    summary = { queued: 0, note: isConfinedDeployment() ? "confined deployment: real fee data not read" : "no session" };
  }
  let testReceipts = 0;
  let testQueued = 0;
  for (const label of sessions.test) {
    const figures = await feeDayFigures(label, day);
    if (figures.count === 0) continue;
    testReceipts += figures.count;
    const result = await pass(figures);
    testQueued += result.queued;
  }
  if (sessions.test.length > 0) summary = { ...summary, test_receipts: testReceipts, test_queued: testQueued };
  queuedTotal += testQueued;
  const sent = queuedTotal > 0 ? await dispatchStaffNotices({ max: queuedTotal + 5 }) : null;
  return sent ? { ...summary, accepted: sent.accepted, held: sent.held, suppressed: sent.suppressed } : summary;
}

export async function feeDaySummary(day: string): Promise<Summary> {
  return feeDayPasses(day, async (figures) => {
    const queued = await queueStaffNoticeToPermission({
      key: `day_collection:${figures.sessionLabel}:${day}`,
      kind: "day_collection",
      permission: "fees:accounts",
      sessionLabel: figures.sessionLabel,
      payload: { date: day, total_rupees: figures.net, receipts: figures.count, by_mode: figures.byMode },
      // Still worth reading the next morning; not after.
      notAfter: schoolMoment(addDays(day, 1), 10 * 60),
    });
    return { receipts: figures.count, total: figures.net, queued };
  });
}

export async function feeDayNotClosed(day: string): Promise<Summary> {
  return feeDayPasses(day, async (figures) => {
    const events = await must(
      createAdminClient()
        .from("fee_day_close_events")
        .select("id, action, created_at")
        .eq("session_label", figures.sessionLabel)
        .eq("payment_date", day),
      "the day's close history",
    );
    const closed = latestCloseState(
      (events as { id: string; action: "close" | "reopen"; created_at: string }[]).map((event) => ({
        action: event.action,
        createdAt: event.created_at,
      })),
    ).closed;
    if (closed) return { receipts: figures.count, closed: "yes", queued: 0 };
    const queued = await queueStaffNoticeToPermission({
      key: `day_not_closed:${figures.sessionLabel}:${day}`,
      kind: "day_not_closed",
      permission: "fees:accounts",
      sessionLabel: figures.sessionLabel,
      payload: { date: day, receipts: figures.count, total_rupees: figures.net },
      // Sent at the window's edge (gates.ts); overnight it stops mattering.
      notAfter: schoolMoment(day, 21 * 60),
    });
    return { receipts: figures.count, closed: "no", queued };
  });
}

/* ------------------------------------------------------------- dispatch */

/**
 * Send what is due and settle what is stuck (P4). The day is not used: due is
 * due. Every five minutes once the database timer is set (docs/cutover/
 * STAFF-WHATSAPP.md §5), so the kill switch, the 07:00 hold and the digest
 * all work; once a day from Vercel's cron until then (critique1 A10).
 */
async function staffNotices(): Promise<Summary> {
  const result = await dispatchStaffNotices({ max: 50 });
  return {
    transport: result.transport,
    claimed: result.claimed,
    accepted: result.accepted,
    failed: result.failed,
    unknown: result.unknown,
    suppressed: result.suppressed,
    held: result.held,
    digested: result.digested,
    released: result.swept.released,
    became_unknown: result.swept.unknown,
    stopped: result.stopped,
  };
}

/** D-333: check the Drive path, then seal a copy of each new Drive document elsewhere. */
async function documentBackup(): Promise<Summary> {
  return runDocumentBackup(await vercelOidcToken());
}

/** D-334: every record and every stored file, sealed, into the school's Drive folder. */
async function driveBackup(): Promise<Summary> {
  return runDriveBackup(await vercelOidcToken());
}

/* ------------------------------------------------------ AI helper log */

/**
 * `vppsone.assist_log` past 180 days (D8's retention for metadata-only AI
 * logs), deleted in bounded batches. The summary is counts only — the run row
 * never names a member of staff, a feature or a row.
 */
export async function assistLogPurge(): Promise<Summary> {
  const result = await purgeAssistLog(new Date());
  return {
    deleted: result.deleted,
    retention_days: ASSIST_LOG_RETENTION_DAYS,
    more_waiting: result.more ? "yes" : "no",
  };
}

/* ------------------------------------------------- AI prepared drafts */

/**
 * The AI helper's drafts that wait for staff instead of a button (D-418):
 * today's cover plans every morning, the class digests on Saturday. A
 * confined deployment shares the one database, so it prepares only for TEST
 * sessions. Counts only in the summary.
 */
async function assistPrepare(day: string): Promise<Summary> {
  const confined = isConfinedDeployment();
  const cover = await prepareCoverPlans({ day, testOnly: confined });
  const saturday = new Date(`${day}T12:00:00Z`).getUTCDay() === 6;
  let digests = { prepared: 0, skipped: 0, failed: 0 };
  if (saturday) {
    const session = confined ? null : await currentSession();
    if (session && !isTestSessionLabel(session)) digests = await prepareClassDigests({ sessionLabel: session, day });
  }
  const purged = await purgeDrafts();
  return {
    cover_prepared: cover.prepared,
    cover_skipped: cover.skipped,
    cover_failed: cover.failed,
    digests_prepared: digests.prepared,
    digests_skipped: digests.skipped,
    digests_failed: digests.failed,
    drafts_purged: purged,
  };
}

/* ---------------------------------------------------------------- health */

/**
 * The health pack (go-live Phase G, plan §9.1): counts from
 * `vppsone.ops_health_counts()`, judged by `ops-health/domain/health.ts`, and
 * — when something needs a person — one `ops_alert` staff WhatsApp to every
 * real admin (`settings:manage`) through the outbox, which asks consent, the
 * kind switch (off until the owner names it), the window and the caps.
 *
 * The counts carry no personal data, so a confined deployment may read them;
 * it queues its alert on a TEST session only, which the outbox sends only to
 * numbers on the test list (D-346). Production uses the real session.
 */
/**
 * POST a deliberately wrong signature to this deployment's own webhook. The
 * route refuses before it reads or writes anything, so the probe leaves no
 * row. The status, or null when no answer came (a finding, never quiet).
 */
async function probeRazorpayWebhook(): Promise<number | null> {
  try {
    const response = await fetch(createAbsoluteUrl("/api/webhooks/razorpay"), {
      ...WEBHOOK_PROBE_REQUEST,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return response.status;
  } catch {
    return null;
  }
}

export async function healthCheck(day: string): Promise<Summary> {
  const counts = await must(
    createAdminClient().rpc("ops_health_counts", { p_hours: 24 }),
    "the health counts",
  );
  // The uptime check on the Razorpay webhook (plan §9.1): production only —
  // a confined deployment has no webhook of its own to answer for.
  const probe = isConfinedDeployment() ? [] : [webhookProbeFinding(await probeRazorpayWebhook(), counts as Record<string, unknown>)];
  const result = evaluateHealth(counts as Record<string, unknown>, probe);
  const summary = healthSummary(result);
  if (!needsAttention(result)) return summary;

  let sessionLabel: string | null;
  if (isConfinedDeployment()) {
    sessionLabel = (await feeDaySessions()).test[0] ?? null;
  } else {
    const active = await currentSession();
    sessionLabel = active && !isTestSessionLabel(active) ? active : null;
  }
  if (!sessionLabel) return { ...summary, queued: 0, note: "no session to alert under" };

  const queued = await queueStaffNoticeToPermission({
    key: alertKey(result, day),
    kind: "ops_alert",
    permission: "settings:manage",
    sessionLabel,
    payload: alertPayload(result, day),
    // Tomorrow's check says it again if it is still true.
    notAfter: schoolMoment(addDays(day, 1), 8 * 60),
  });
  const sent = queued > 0 ? await dispatchStaffNotices({ max: queued + 5 }) : null;
  return sent
    ? { ...summary, queued, accepted: sent.accepted, held: sent.held, suppressed: sent.suppressed }
    : { ...summary, queued };
}

/* ------------------------------------------------- AI connection purge */

/**
 * Retention for the AI connection (owner decision D8): call rows past 180
 * days, codes and tokens a day past expiry or revocation, connections ended
 * more than 180 days ago, registered clients nobody connected with. One SQL
 * function (`vppsone.ai_purge`), counts only.
 */
async function aiConnectionPurge(): Promise<Summary> {
  const result = await must(createAdminClient().rpc("ai_purge", { p_keep_days: 180 }), "the AI connection purge");
  const counts = (result ?? {}) as Record<string, unknown>;
  return {
    calls: Number(counts.calls ?? 0),
    codes: Number(counts.codes ?? 0),
    tokens: Number(counts.tokens ?? 0),
    connections: Number(counts.connections ?? 0),
    clients: Number(counts.clients ?? 0),
  };
}

export const jobWork: Record<JobName, (day: string) => Promise<Summary>> = {
  "open-registers": openRegisters,
  "attendance-reminder": attendanceReminder,
  "missing-marks-nudge": missingMarksNudge,
  "daily-summary": dailySummary,
  "staff-notices": staffNotices,
  "fee-day-summary": feeDaySummary,
  "fee-day-not-closed": feeDayNotClosed,
  "document-backup": documentBackup,
  "drive-backup": driveBackup,
  health: healthCheck,
  "assist-log-purge": assistLogPurge,
  "assist-prepare": assistPrepare,
  "builtin-ai-purge": () => purgeBuiltinAiInputs(),
  "ai-connection-purge": aiConnectionPurge,
};
