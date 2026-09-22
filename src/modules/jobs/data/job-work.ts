import "server-only";

import { ACTIVE_SESSION_KEY, pickSessionLabel } from "@/platform/config/active-session";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";
import {
  isSchoolOpen,
  type CalendarDayKind,
} from "@/modules/academics/domain/calendar";
import { isEntered } from "@/modules/assessments/domain/assessments";
import type { JobName } from "@/modules/jobs/domain/jobs";

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

/**
 * Who has not submitted a register, and a message ready for each.
 *
 * Only classes that actually have a teacher and a number get a draft; the rest
 * are counted, because "nobody to ask" is the more useful finding of the two
 * and a job that silently dropped them would hide it.
 */
export async function attendanceReminder(day: string): Promise<Summary> {
  const sessionLabel = await currentSession();
  if (!sessionLabel) return { outstanding: 0, note: "no session" };

  const calendar = await calendarFor(sessionLabel);
  if (!isSchoolOpen(day, calendar)) {
    return { outstanding: 0, note: "school closed today" };
  }

  const admin = createAdminClient();
  const byClass = await classesWithChildren(sessionLabel);

  const registers = await must(
    admin
      .from("attendance_registers")
      .select("class_id, status")
      .eq("session_label", sessionLabel)
      .eq("day", day),
    "today's registers",
  );

  const submitted = new Set(
    registers
      .filter((row) => row.status === "submitted")
      .map((row) => row.class_id as string),
  );

  const outstanding = [...byClass.keys()].filter((classId) => !submitted.has(classId));
  const teachers = await classTeachers(sessionLabel);

  // Don't ask the same teacher for the same thing twice in a day — but only
  // the same thing. Matching on any message at all meant a teacher who had
  // been nudged about marks was then skipped for her register, which is a
  // different question about a different day's work.
  const alreadyAsked = await alreadyRemindedWith(
    "vppsone_attendance_reminder",
    sessionLabel,
    day,
  );

  let drafted = 0;
  let noTeacher = 0;
  let noPhone = 0;

  for (const classId of outstanding) {
    const teacher = teachers.get(classId);
    if (!teacher) {
      noTeacher += 1;
      continue;
    }
    if (!teacher.phone) {
      noPhone += 1;
      continue;
    }
    if (alreadyAsked.has(teacher.id)) continue;

    const wrote = await draftStaffMessage({
      sessionLabel,
      templateCode: "vppsone_attendance_reminder",
      to: teacher,
      variables: [teacher.name],
    });

    if (wrote) {
      drafted += 1;
      alreadyAsked.add(teacher.id);
    }
  }

  return {
    classes: byClass.size,
    outstanding: outstanding.length,
    drafted,
    no_class_teacher: noTeacher,
    no_phone: noPhone,
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
      .select("id, class_id, class_label, subject_code")
      .in("assessment_id", examIds),
    "the papers",
  );

  const paperList = papers as {
    id: string;
    class_id: string;
    class_label: string;
    subject_code: string;
  }[];

  if (paperList.length === 0) {
    return { exams_open: examIds.length, papers_outstanding: 0, drafted: 0 };
  }

  const marks = await fetchAllRows(
    (from, to) =>
      admin
        .from("marks")
        .select("assessment_subject_id, student_id, value, absent")
        .in(
          "assessment_subject_id",
          paperList.map((paper) => paper.id),
        )
        .range(from, to),
    "the marks",
  );

  const entered = new Map<string, number>();
  for (const row of marks as {
    assessment_subject_id: string;
    value: number | string | null;
    absent: boolean;
  }[]) {
    if (!isEntered({ value: row.value === null ? null : Number(row.value), absent: row.absent })) {
      continue;
    }
    const key = row.assessment_subject_id;
    entered.set(key, (entered.get(key) ?? 0) + 1);
  }

  const byClass = await classesWithChildren(sessionLabel);

  const outstanding = paperList.filter((paper) => {
    const expected = byClass.get(paper.class_id) ?? 0;
    return expected > 0 && (entered.get(paper.id) ?? 0) < expected;
  });

  const marksOutstanding = outstanding.reduce((total, paper) => {
    const expected = byClass.get(paper.class_id) ?? 0;
    return total + (expected - (entered.get(paper.id) ?? 0));
  }, 0);

  const teachers = await classTeachers(sessionLabel);

  // One message per teacher, however many of her papers are behind: four
  // messages about four papers is how a reminder becomes something people mute.
  const perTeacher = new Map<string, { contact: StaffContact; papers: string[] }>();

  for (const paper of outstanding) {
    const teacher = teachers.get(paper.class_id);
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

  const { data: plan, error: planError } = await admin
    .from("substitution_plans")
    .select("id, status")
    .eq("session_label", sessionLabel)
    .eq("day", day)
    .maybeSingle();

  if (planError) {
    throw new Error(`Could not read today's cover plan: ${planError.message}`);
  }

  const covers = plan
    ? await must(
        admin.from("substitution_assignments").select("kind").eq("plan_id", plan.id),
        "today's cover",
      )
    : [];

  const { count: pendingCount, error: pendingError } = await admin
    .from("collection_submissions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (pendingError) {
    throw new Error(`Could not count the answers to review: ${pendingError.message}`);
  }

  const { count: correctionsCount, error: correctionsError } = await admin
    .from("attendance_corrections")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (correctionsError) {
    throw new Error(
      `Could not count the corrections waiting: ${correctionsError.message}`,
    );
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
    cover_plan: plan ? (plan.status as string) : "none",
    covers_arranged: covers.filter((row) => row.kind === "cover").length,
    classes_merged: covers.filter((row) => row.kind === "merged").length,
    self_study: covers.filter((row) => row.kind === "self_study").length,
    answers_to_review: pendingCount ?? 0,
    corrections_waiting: correctionsCount ?? 0,
  };
}

/* ------------------------------------------------------------- dispatch */

export const jobWork: Record<JobName, (day: string) => Promise<Summary>> = {
  "open-registers": openRegisters,
  "attendance-reminder": attendanceReminder,
  "missing-marks-nudge": missingMarksNudge,
  "daily-summary": dailySummary,
};
