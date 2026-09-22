#!/usr/bin/env node
/**
 * Put one of every case on the dev database.
 *
 *   npm run seed:scenarios
 *
 * Screens are judged on their states, not on their happy path, and most of
 * this app's states need data somebody has to go and create: a half-day
 * absence, a correction waiting on a second person, a class nobody could be
 * found for, a child with no attendance at all. This seeds one of each so a
 * screen can be looked at rather than imagined.
 *
 * The cover plan is produced by **the engine itself**, loaded straight from
 * source — `engine.ts` and `plan.ts` import nothing but each other, so Node 24
 * runs them by stripping the types. Hand-writing plausible-looking assignments
 * here would seed a plan the app could never have produced.
 *
 * `--import ./scripts/alias-hook.mjs` is what teaches Node the `@/` alias, and
 * it has to be a flag rather than an import: static imports are resolved
 * before any module body runs, so a hook registered inside this file would
 * arrive too late to help it. `npm run seed:scenarios` passes it.
 *
 * Idempotent: every write is an upsert or a delete-then-insert on the same
 * day, so running it twice leaves the same database.
 *
 * Rule 3: dev only, and it refuses to run anywhere else.
 * Rule 6: every name written here is invented. Nothing describes a real child,
 * parent or member of staff.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  buildTeacherProfiles,
  chooseMergeHost,
  generatePlan,
  normalizeAbsences,
} from "../src/modules/substitutions/domain/engine.ts";
import {
  hostsInPeriod,
  teacherDetailsFrom,
  vacanciesFor,
} from "../src/modules/substitutions/domain/plan.ts";
import { attendancePercent } from "../src/modules/attendance/domain/attendance.ts";
import { buildReportCard } from "../src/modules/assessments/domain/report-card.ts";
import { readActiveSession } from "./read-active-session.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PROJECT_REF = "wtgxcptmucjerhufzjcf";
const PERIOD_COUNT = 8;

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

if (!(env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(DEV_PROJECT_REF)) {
  console.error(`Refusing to run: .env.local is not the dev project (rule 3).`);
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false },
});

const die = (label, error) => {
  if (error) {
    console.error(`${label}: ${error.message ?? error}`);
    process.exit(1);
  }
};

const isoDay = (offset = 0) => {
  // The school's day, not UTC's — the same +05:30 rule `src/platform/dates.ts`
  // uses, so the seeded dates match what the app calls today.
  const now = new Date(Date.now() + 330 * 60_000);
  now.setUTCDate(now.getUTCDate() + offset);
  return now.toISOString().slice(0, 10);
};

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const weekdayOf = (day) =>
  WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()];

/* --------------------------------------------------------------- lookups */

const [{ data: staff }, { data: version }, { data: kinds }] = await Promise.all([
  db.from("staff_profiles").select("id, display_name, short_name, is_teaching, role"),
  db
    .from("timetable_versions")
    .select("id, session_label")
    .eq("status", "published")
    .maybeSingle(),
  db.from("note_kinds").select("id, code").order("sort_order"),
]);

// The session the app is working in. See src/platform/config/active-session.ts.
const sessionLabel = await readActiveSession(db);

if (!version) {
  console.error("No published timetable. Run `npm run seed:timetable` first.");
  process.exit(1);
}

// Paged: a published timetable is over a thousand rows and PostgREST answers
// the first thousand with no error — the same trap `src/platform/supabase/
// paginate.ts` exists for, and the one that made this script seed a plan
// against thirty-eight missing lessons the first time it ran.
const slotRows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("timetable_slots")
    .select(
      "day, period, class_id, class_label, subject_code, staff_profile_id, teacher_short_name, parallel, shared",
    )
    .eq("version_id", version.id)
    .order("day")
    .order("period")
    .order("class_label")
    .order("teacher_short_name")
    .range(from, from + 999);

  die("Could not read the timetable", error);
  slotRows.push(...data);
  if (data.length < 1000) break;
}

const slots = slotRows.map((row) => ({
  day: row.day,
  period: row.period,
  classId: row.class_id,
  classLabel: row.class_label,
  subjectCode: row.subject_code,
  staffProfileId: row.staff_profile_id,
  teacherShortName: row.teacher_short_name,
  parallel: row.parallel,
  shared: row.shared,
}));

const days = [...new Set(slots.map((slot) => slot.day))];
const timetableTeachers = [...new Set(slots.map((slot) => slot.staffProfileId))];

const raj = staff.find((person) => person.short_name === "RAJ");
const qaTeacher = staff.find((person) => person.short_name === "QATE");
const qaOffice = staff.find((person) => person.short_name === "QAOF");

console.log(`session ${sessionLabel} · ${slots.length} slots · ${days.length} days`);

/* --------------------------------------------------------- cover policies */
//
// One of every kind, so the policy screen and the ranking both have something
// to show: a part-time window, a duty-holder, office staff, and somebody the
// planner may never assign automatically at all.

const withMost = [...timetableTeachers]
  .map((id) => ({
    id,
    periods: slots.filter((slot) => slot.staffProfileId === id).length,
  }))
  .sort((a, b) => b.periods - a.periods);

const partTime = withMost[withMost.length - 1].id;
const dutyHolder = withMost[0].id;
const cappedOut = withMost[1].id;

const policies = [
  {
    staff_profile_id: partTime,
    allowed_periods: [4, 5, 6, 7],
    cover_role: "normal",
    max_auto_covers: 2,
    note: "Part-time: in school for the last four periods.",
  },
  {
    staff_profile_id: dutyHolder,
    allowed_periods: [0, 1, 2, 3, 4, 5, 6, 7],
    cover_role: "duty",
    max_auto_covers: 2,
    note: "Exam in-charge — only if nobody else is free.",
  },
  {
    staff_profile_id: cappedOut,
    allowed_periods: [0, 1, 2, 3, 4, 5, 6, 7],
    cover_role: "normal",
    max_auto_covers: 0,
    note: "Never covers automatically; ask first.",
  },
];

if (qaOffice) {
  policies.push({
    staff_profile_id: qaOffice.id,
    allowed_periods: [0, 1, 2, 3, 4, 5, 6, 7],
    cover_role: "reserve",
    max_auto_covers: 1,
    note: "Office — can be asked, never volunteered.",
  });
}

die(
  "Could not write the cover policies",
  (
    await db.from("cover_policies").upsert(
      policies.map((policy) => ({ ...policy, session_label: sessionLabel })),
      { onConflict: "session_label,staff_profile_id" },
    )
  ).error,
);

console.log(`cover policies: ${policies.length}`);

/* ------------------------------------------------- absences and plans */
//
// Two days, because a cover plan has states that only a bad day produces. An
// ordinary day fills every period and shows the confirm-and-pin flow; a day
// with a third of the staff room away is what makes the planner fall through
// to sending a class next door, and then to self study.

const profileOverrides = Object.fromEntries(
  policies.map((policy) => [
    policy.staff_profile_id,
    {
      maxAutoSubstitutions: policy.max_auto_covers,
      ...(policy.allowed_periods.length < PERIOD_COUNT
        ? { availability: { allowedPeriodIndexes: policy.allowed_periods } }
        : {}),
    },
  ]),
);

const teacherProfiles = buildTeacherProfiles({
  teacherDetails: teacherDetailsFrom(slots, days),
  roster: staff.map((person) => person.id),
  policyOverrides: profileOverrides,
  reserveStaff: policies
    .filter((policy) => policy.cover_role === "reserve")
    .map((policy) => policy.staff_profile_id),
  dutyStaff: policies
    .filter((policy) => policy.cover_role === "duty")
    .map((policy) => policy.staff_profile_id),
});

/** The next date on or after `offset` that the timetable actually runs on. */
function nextTimetableDay(offset) {
  for (let step = 0; step < 14; step += 1) {
    const day = isoDay(offset + step);
    if (days.includes(weekdayOf(day))) return day;
  }
  return null;
}

async function seedPlan({ day, away, publish, pinToAdmin }) {
  const header = weekdayOf(day);

  die(
    "Could not clear the old absences",
    (await db.from("teacher_absences").delete().eq("day", day)).error,
  );

  die(
    "Could not write the absences",
    (
      await db.from("teacher_absences").insert(
        away.map((entry) => ({
          session_label: sessionLabel,
          staff_profile_id: entry.id,
          day,
          periods: entry.periods,
          reason: entry.reason,
        })),
      )
    ).error,
  );

  const absenceIndex = normalizeAbsences(
    Object.fromEntries(away.map((entry) => [entry.id, entry.periods])),
    PERIOD_COUNT,
  );

  const vacancies = vacanciesFor(slots, header, absenceIndex);

  const result = generatePlan({
    day: header,
    periodCount: PERIOD_COUNT,
    teacherProfiles,
    absenceIndex,
    vacancies: vacancies.map((vacancy) => ({
      slotId: vacancy.slotId,
      periodIndex: vacancy.periodIndex,
      className: vacancy.className,
      subject: vacancy.subject,
      originalTeacher: vacancy.originalTeacher,
    })),
    existingAssignments: [],
  });

  const byKey = new Map(vacancies.map((vacancy) => [vacancy.slotId, vacancy]));
  const rows = [];
  const covered = new Map();

  for (const item of [...result.assignments, ...result.reviewSuggestions]) {
    if (!("source" in item)) continue;
    const vacancy = byKey.get(item.slotId);
    if (!vacancy) continue;

    rows.push({
      period: vacancy.periodIndex,
      class_id: vacancy.classId,
      class_label: vacancy.className,
      subject_code: vacancy.subject,
      original_staff_id: vacancy.originalStaffId,
      covering_staff_id: item.teacher,
      kind: "cover",
      match_tier: item.matchTier,
      source: item.source,
      warnings: item.warnings,
    });

    covered.set(`${vacancy.classId}|${vacancy.periodIndex}`, item.teacher);
  }

  // What nobody could be found for: next door when the grades are close
  // enough, self study when they are not. Both are decisions a school makes
  // every week, and neither is an error.
  for (const open of result.openSlots) {
    const vacancy = byKey.get(open.slotId);
    if (!vacancy) continue;

    const hosts = hostsInPeriod(
      slots,
      header,
      vacancy.periodIndex,
      absenceIndex,
      covered,
    ).filter((host) => host.classId !== vacancy.classId);

    const chosen = chooseMergeHost(vacancy.className, hosts);
    const host = chosen
      ? hosts.find((entry) => entry.className === chosen.className)
      : null;

    rows.push({
      period: vacancy.periodIndex,
      class_id: vacancy.classId,
      class_label: vacancy.className,
      subject_code: vacancy.subject,
      original_staff_id: vacancy.originalStaffId,
      covering_staff_id: null,
      kind: host ? "merged" : "self_study",
      merge_host_class_id: host?.classId ?? null,
      merge_host_class_label: host?.className ?? null,
      source: "auto",
      warnings: [],
    });
  }

  const { data: plan, error: planError } = await db
    .from("substitution_plans")
    .upsert(
      {
        session_label: sessionLabel,
        day,
        version_id: version.id,
        status: "draft",
        published_at: null,
        published_by: null,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "session_label,day" },
    )
    .select("id")
    .single();
  die("Could not create the plan", planError);

  die(
    "Could not clear the old assignments",
    (await db.from("substitution_assignments").delete().eq("plan_id", plan.id))
      .error,
  );

  die(
    "Could not write the assignments",
    (
      await db
        .from("substitution_assignments")
        .insert(rows.map((row) => ({ ...row, plan_id: plan.id })))
    ).error,
  );

  // One cover pinned onto the signed-in admin, so the Today card's cover-duty
  // section has something in it for the account Janmejay actually tests with.
  if (pinToAdmin && raj) {
    const free = rows.find(
      (row) => row.kind === "cover" && row.covering_staff_id !== raj.id,
    );

    if (free) {
      die(
        "Could not pin a cover onto the admin",
        (
          await db
            .from("substitution_assignments")
            .update({
              covering_staff_id: raj.id,
              source: "manual",
              pinned: true,
              match_tier: null,
              warnings: [],
            })
            .eq("plan_id", plan.id)
            .eq("class_id", free.class_id)
            .eq("period", free.period)
        ).error,
      );
    }
  }

  if (publish) {
    die(
      "Could not publish the plan",
      (
        await db
          .from("substitution_plans")
          .update({
            status: "published",
            published_at: new Date().toISOString(),
            published_by: raj?.id ?? null,
          })
          .eq("id", plan.id)
      ).error,
    );
  }

  console.log(
    `plan for ${day} (${header}, ${publish ? "published" : "draft"}): ` +
      `${vacancies.length} vacancies -> ` +
      `${result.diagnostics.autoAssigned} automatic, ` +
      `${result.diagnostics.reviewRequired} to confirm, ` +
      `${rows.filter((row) => row.kind === "merged").length} merged, ` +
      `${rows.filter((row) => row.kind === "self_study").length} self study`,
  );

  return { day, header };
}

const planDay = nextTimetableDay(0);
const afterPlanDay = planDay ? nextTimetableDay(1) : null;
const hardDay = afterPlanDay === planDay ? nextTimetableDay(2) : afterPlanDay;

if (!planDay || !hardDay) {
  console.error("No timetable block in the next fortnight.");
  process.exit(1);
}

// One of every absence shape: a whole day, a morning, an afternoon, one period.
await seedPlan({
  day: planDay,
  publish: true,
  pinToAdmin: true,
  away: [
    {
      id: withMost[2].id,
      periods: [0, 1, 2, 3, 4, 5, 6, 7],
      reason: "Ill, away all day",
    },
    {
      id: withMost[3].id,
      periods: [0, 1, 2, 3],
      reason: "Hospital, back after the break",
    },
    { id: withMost[4].id, periods: [5, 6, 7], reason: "Leaving early" },
    { id: withMost[5].id, periods: [2], reason: "One period only" },
  ],
});

// A third of the staff room away, left as a draft: this is the day that
// produces a class sent next door and a class left on self study, and the one
// where "not published yet" is worth looking at.
await seedPlan({
  day: hardDay,
  publish: false,
  pinToAdmin: false,
  away: withMost.slice(0, 8).map((entry, index) => ({
    id: entry.id,
    periods: [0, 1, 2, 3, 4, 5, 6, 7],
    reason: index === 0 ? "Most of the department away" : "Away",
  })),
});



/* ----------------------------------------------------------- attendance */
//
// A month of registers for one class, with every status and one register left
// open, so the monthly sheet has runs, gaps and a percentage worth reading.

const { data: enrolments, error: enrolError } = await db
  .from("enrolments")
  .select("student_id, roll_no, class_id")
  .eq("session_label", sessionLabel)
  .eq("status", "enrolled");
die("Could not read the enrolments", enrolError);

/*
 * The busiest class that the timetable also knows about.
 *
 * This used to be simply the class with the most children on the roll, and
 * everything downstream assumed that class had lessons: the exam fixture
 * takes its subjects from the class's timetable slots, and gave up with "No
 * subjects to examine" when there were none. Sixteen of the nineteen classes
 * are timetabled, so picking purely by headcount lands on an untimetabled one
 * whenever the roster changes shape — and then the run half-completes.
 *
 * Headcount still decides between candidates; being on the timetable is just
 * a precondition. The `??` keeps the old behaviour for a database with no
 * published timetable at all, where the exam step will bow out anyway.
 */
const classesWithLessons = new Set(slots.map((slot) => slot.classId));

const byRoll = [...new Set(enrolments.map((row) => row.class_id))]
  .map((classId) => ({
    classId,
    roll: enrolments.filter((row) => row.class_id === classId),
  }))
  .sort((a, b) => b.roll.length - a.roll.length);

const targetClass =
  byRoll.find((candidate) => classesWithLessons.has(candidate.classId)) ?? byRoll[0];

/*
 * The label, from the roster rather than from the timetable.
 *
 * The timetable only labels classes that have lessons on it — sixteen of the
 * nineteen — and the class picked here is the one with the most children,
 * which need not be one of them. The fallback was the bare word "Class",
 * which then became the request's title on a screen. The fee schema knows
 * every class's name whether or not it is timetabled.
 */
const { data: rosterClasses } = await db
  .schema("public")
  .from("classes")
  .select("id, class_name, section")
  .eq("session_label", sessionLabel);

const rosterClassLabel = new Map(
  (rosterClasses ?? []).map((row) => [
    row.id,
    [row.class_name, row.section].filter(Boolean).join(" "),
  ]),
);

const targetClassLabel =
  rosterClassLabel.get(targetClass.classId) ??
  slots.find((slot) => slot.classId === targetClass.classId)?.classLabel ??
  "Class";

const STATUSES = ["present", "present", "present", "absent", "late", "leave"];
const registerDays = [];

for (let offset = 1; offset <= 21 && registerDays.length < 12; offset += 1) {
  const day = isoDay(-offset);
  // Sunday is the school's weekly holiday.
  if (new Date(`${day}T00:00:00Z`).getUTCDay() === 0) continue;
  registerDays.push(day);
}

die(
  "Could not clear the old registers",
  (
    await db
      .from("attendance_registers")
      .delete()
      .eq("class_id", targetClass.classId)
      .in("day", registerDays)
  ).error,
);

let marksWritten = 0;

for (const [index, day] of registerDays.entries()) {
  // The most recent one is left open, so the "still open" state exists too.
  const submitted = index !== 0;

  const { data: register, error } = await db
    .from("attendance_registers")
    .insert({
      session_label: sessionLabel,
      class_id: targetClass.classId,
      day,
      period: null,
      status: submitted ? "submitted" : "open",
      taken_by: raj?.id ?? null,
      submitted_at: submitted ? new Date().toISOString() : null,
    })
    .select("id")
    .single();
  die(`Could not create the register for ${day}`, error);

  // The last child on the roll is never marked, so "no attendance recorded"
  // has somebody to be true about.
  const marked = targetClass.roll.slice(0, -1);

  const marks = marked.map((student, position) => ({
    register_id: register.id,
    student_id: student.student_id,
    status: STATUSES[(position + index) % STATUSES.length],
    note: null,
  }));

  die(
    `Could not write the marks for ${day}`,
    (await db.from("attendance_marks").insert(marks)).error,
  );

  marksWritten += marks.length;
}

console.log(
  `attendance: ${registerDays.length} registers (1 left open), ${marksWritten} marks`,
);

/* ---------------------------------------------------------- corrections */
//
// One of each status. The pending one is requested by somebody other than the
// admin, because nobody may approve their own.

const { data: submittedRegister } = await db
  .from("attendance_registers")
  .select("id")
  .eq("class_id", targetClass.classId)
  .eq("status", "submitted")
  .limit(1)
  .maybeSingle();

if (submittedRegister && qaTeacher) {
  const subjects = targetClass.roll.slice(0, 3);

  die(
    "Could not clear the old corrections",
    (
      await db
        .from("attendance_corrections")
        .delete()
        .eq("register_id", submittedRegister.id)
    ).error,
  );

  const now = new Date().toISOString();

  die(
    "Could not write the corrections",
    (
      await db.from("attendance_corrections").insert([
        {
          register_id: submittedRegister.id,
          student_id: subjects[0].student_id,
          from_status: "absent",
          to_status: "present",
          reason: "Was at the sports ground with me during the register.",
          requested_by: qaTeacher.id,
          status: "pending",
        },
        {
          register_id: submittedRegister.id,
          student_id: subjects[1].student_id,
          from_status: "absent",
          to_status: "late",
          reason: "Came in at 9:20 after the bus broke down.",
          requested_by: qaTeacher.id,
          status: "approved",
          decided_by: raj?.id ?? null,
          decided_at: now,
          decision_note: "Confirmed with the office.",
        },
        {
          register_id: submittedRegister.id,
          student_id: subjects[2].student_id,
          from_status: "present",
          to_status: "absent",
          reason: "Thought this was the wrong child.",
          requested_by: qaTeacher.id,
          status: "rejected",
          decided_by: raj?.id ?? null,
          decided_at: now,
          decision_note: "The register was right.",
        },
      ])
    ).error,
  );

  console.log("corrections: 1 waiting, 1 approved, 1 rejected");
}

/* ---------------------------------------------------------------- notes */
//
// One of every kind, so the tones and the filter both have something to show.

const BODIES = {
  behaviour: "Talking through the lesson again; moved to the front row.",
  praise: "Read the whole passage aloud without help today.",
  homework: "Third week without the maths book. Spoke to them after class.",
  health: "Says their eyes hurt reading the board — may need testing.",
  parent: "Called home about the absences; father will come in on Saturday.",
  other: "Wants to join the science exhibition team.",
};

die(
  "Could not clear the old notes",
  (
    await db
      .from("notes")
      .delete()
      .eq("session_label", sessionLabel)
      .eq("written_by", raj?.id ?? "00000000-0000-0000-0000-000000000000")
  ).error,
);

const noteRows = kinds
  .filter((kind) => BODIES[kind.code])
  .map((kind, index) => ({
    session_label: sessionLabel,
    // Alternating: some about one child, some about the whole class.
    student_id: index % 2 === 0 ? targetClass.roll[index]?.student_id ?? null : null,
    class_id: targetClass.classId,
    kind_id: kind.id,
    body: BODIES[kind.code],
    written_by: raj?.id ?? null,
  }));

die("Could not write the notes", (await db.from("notes").insert(noteRows)).error);

console.log(`notes: ${noteRows.length} across every kind`);

/* ----------------------------------------------------------- collection */
//
// A link somebody can actually open, and answers in every state the review
// queue splits on: a change, a confirmation, and one already decided.

const { data: collectionFields } = await db
  .from("collection_fields")
  .select("id, key, label_hi, label_en, input_type, mode, fee_column")
  .eq("is_active", true)
  .order("sort_order");

const asked = collectionFields.filter((entry) =>
  ["guardian_phone", "blood_group", "transport"].includes(entry.key),
);

const requestToken = randomBytes(12).toString("base64url");

await db
  .from("collection_requests")
  .delete()
  .eq("session_label", sessionLabel)
  .eq("title_en", "Phone numbers and blood groups");

const { data: request, error: requestError } = await db
  .from("collection_requests")
  .insert({
    session_label: sessionLabel,
    title_hi: "फ़ोन नंबर और रक्त समूह",
    title_en: "Phone numbers and blood groups",
    class_id: targetClass.classId,
    class_label: targetClassLabel,
    /*
     * The audience, which this insert used to leave out.
     *
     * `audience_kind` and `audience_label` arrived with rounds — one request
     * per class, fanned out from one round — and both are NOT NULL. The
     * seeder was never updated, so it inserted a row the schema had since
     * stopped accepting and died halfway through: the timetable, attendance
     * and notes were seeded, and every collection fixture after this line was
     * not. A database rebuilt from scratch came out silently half-made.
     *
     * A request made for one class is its own audience, which is exactly what
     * `createRequest` in `requests-repo.ts` writes.
     */
    audience_kind: "class",
    audience_label: targetClassLabel,
    assigned_staff_id: qaTeacher?.id ?? null,
    token: requestToken,
    due_date: isoDay(7),
    status: "open",
    opened_at: new Date().toISOString(),
    reason_hi: "इस कक्षा के सभी बच्चों के लिए।",
    reason_en: "Every child in this class. The office needs these before the trip.",
  })
  .select("id")
  .single();
die("Could not create the request", requestError);

die(
  "Could not attach the fields",
  (
    await db.from("collection_request_fields").insert(
      asked.map((entry, index) => ({
        request_id: request.id,
        field_id: entry.id,
        sort_order: index,
      })),
    )
  ).error,
);

// Answers in each of the three shapes the review queue cares about.
const phoneField = asked.find((entry) => entry.key === "guardian_phone");
const bloodField = asked.find((entry) => entry.key === "blood_group");

const submissions = [];
const answeredChildren = targetClass.roll.slice(0, 6);

answeredChildren.forEach((student, index) => {
  if (phoneField) {
    const changed = index % 2 === 0;
    submissions.push({
      request_id: request.id,
      student_id: student.student_id,
      field_id: phoneField.id,
      // Invented numbers, never a real one (rule 6). Two children share one,
      // so the office's neutral "also on N other children" line has something
      // to say.
      value: changed ? (index < 2 ? "9000000001" : `900000000${index}`) : null,
      previous_value: "9000000009",
      status: "pending",
    });
  }

  if (bloodField && index < 3) {
    submissions.push({
      request_id: request.id,
      student_id: student.student_id,
      field_id: bloodField.id,
      value: ["A+", "O+", "B-"][index],
      previous_value: null,
      status: "pending",
    });
  }
});

die(
  "Could not write the answers",
  (await db.from("collection_submissions").insert(submissions)).error,
);

// One already accepted, so `student_records` and the "what we hold" card have
// something in them.
if (phoneField && answeredChildren[0]) {
  const { data: accepted } = await db
    .from("collection_submissions")
    .update({
      status: "accepted",
      decided_by: raj?.id ?? null,
      decided_at: new Date().toISOString(),
      decision_note: "Checked with the office.",
    })
    .eq("request_id", request.id)
    .eq("student_id", answeredChildren[0].student_id)
    .eq("field_id", phoneField.id)
    .select("id, value")
    .maybeSingle();

  if (accepted?.value) {
    die(
      "Could not record the accepted answer",
      (
        await db.from("student_records").upsert(
          {
            session_label: sessionLabel,
            student_id: answeredChildren[0].student_id,
            field_id: phoneField.id,
            value: accepted.value,
            source: "teacher",
            source_submission_id: accepted.id,
            recorded_by: raj?.id ?? null,
          },
          { onConflict: "student_id,field_id" },
        )
      ).error,
    );
  }
}

console.log(
  `collection: 1 open request (/r/${requestToken}), ${submissions.length} answers, 1 accepted`,
);

/* ------------------------------------------------------------- messages */

const templates = [
  {
    code: "vppsone_collection_link",
    label_hi: "जानकारी का लिंक",
    label_en: "Collection link",
    body_hi: "नमस्ते {{1}}, {{2}} के लिए जानकारी भरनी है। धन्यवाद।",
    body_en: "Hello {{1}}, please fill in {{2}} for your class. Thank you.",
    variables: ["Teacher name", "What is being asked"],
    has_url_button: true,
    audience: "staff",
    sort_order: 1,
  },
  {
    code: "vppsone_parent_notice",
    label_hi: "अभिभावक सूचना",
    label_en: "Parent notice",
    body_hi: "नमस्ते, {{1}} के बारे में सूचना: {{2}}",
    body_en: "Hello, a note about {{1}}: {{2}}",
    variables: ["Child name", "The message"],
    has_url_button: false,
    audience: "parent",
    sort_order: 2,
  },
];

die(
  "Could not write the templates",
  (await db.from("message_templates").upsert(templates, { onConflict: "code" })).error,
);

const { data: staffTemplate } = await db
  .from("message_templates")
  .select("id, body_hi, body_en, audience")
  .eq("code", "vppsone_collection_link")
  .single();

const { data: parentTemplate } = await db
  .from("message_templates")
  .select("id, body_hi, body_en, audience")
  .eq("code", "vppsone_parent_notice")
  .single();

const fill = (body, values) =>
  body.replace(/\{\{(\d+)\}\}/g, (whole, index) => values[Number(index) - 1] ?? whole);

await db.from("message_sends").delete().eq("session_label", sessionLabel);

const staffVars = [qaTeacher?.display_name ?? "Teacher", "phone numbers"];
const parentVars = [targetClass.roll[0] ? "your child" : "your child", "the school trip is on Friday"];

die(
  "Could not queue the messages",
  (
    await db.from("message_sends").insert([
      {
        session_label: sessionLabel,
        template_id: staffTemplate.id,
        to_phone: "9000000010",
        to_name: qaTeacher?.display_name ?? null,
        staff_profile_id: qaTeacher?.id ?? null,
        request_id: request.id,
        variables: staffVars,
        rendered_hi: fill(staffTemplate.body_hi, staffVars),
        rendered_en: fill(staffTemplate.body_en, staffVars),
        status: "queued",
        requested_by: raj?.id ?? null,
      },
      {
        session_label: sessionLabel,
        template_id: parentTemplate.id,
        to_phone: "9000000011",
        to_name: "Test Parent",
        student_id: targetClass.roll[0]?.student_id ?? null,
        variables: parentVars,
        rendered_hi: fill(parentTemplate.body_hi, parentVars),
        rendered_en: fill(parentTemplate.body_en, parentVars),
        status: "queued",
        requested_by: raj?.id ?? null,
      },
    ])
  ).error,
);

console.log("messages: 2 templates, 2 queued (1 staff, 1 parent — parent is hand-sent)");

/* ------------------------------------------------------------ documents */
//
// A real object in the private bucket, so the signed-URL path is exercised
// rather than assumed. The smallest valid PDF there is, invented here.

const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
  "utf8",
);

if (targetClass.roll[0]) {
  const studentId = targetClass.roll[0].student_id;

  const { data: existing } = await db
    .from("student_documents")
    .select("id, storage_path")
    .eq("student_id", studentId);

  for (const doc of existing ?? []) {
    await db.storage.from("vppsone-documents").remove([doc.storage_path]);
    await db.from("student_documents").delete().eq("id", doc.id);
  }

  const { data: doc, error: docError } = await db
    .from("student_documents")
    .insert({
      session_label: sessionLabel,
      student_id: studentId,
      kind: "birth_certificate",
      storage_path: `pending/${randomUUID()}`,
      file_name: "birth-certificate.pdf",
      content_type: "application/pdf",
      byte_size: TINY_PDF.byteLength,
      note: "Seeded test document. Not a real certificate.",
      uploaded_by: raj?.id ?? null,
    })
    .select("id")
    .single();
  die("Could not index the document", docError);

  const path = `${sessionLabel}/${studentId}/${doc.id}.pdf`;
  const upload = await db.storage
    .from("vppsone-documents")
    .upload(path, TINY_PDF, { contentType: "application/pdf", upsert: true });

  if (upload.error) {
    await db.from("student_documents").delete().eq("id", doc.id);
    die("Could not store the document", upload.error);
  }

  die(
    "Could not point the row at the file",
    (await db.from("student_documents").update({ storage_path: path }).eq("id", doc.id))
      .error,
  );

  console.log(`documents: 1 stored at ${path}`);
}

/* ---------------------------------------------------------- assessments */
//
// Two exams in one term, so a report card has more than one column to print,
// and marks in **every state the grid distinguishes**: a number, a nought, an
// absence, and a paper nobody has touched. Those four are the whole reason
// `isEntered()` exists — a seed with only numbers in it would let a grid that
// reads a nought as a blank pass unnoticed.

const { data: subjectRows, error: subjectError } = await db
  .from("subjects")
  .select("id, code")
  .eq("is_active", true)
  .order("sort_order");
die("Could not read the subjects", subjectError);

// Whichever subjects this class is actually taught, so a paper is never set in
// a subject nobody teaches it.
const taughtCodes = [
  ...new Set(
    slots
      .filter((slot) => slot.classId === targetClass.classId)
      .map((slot) => slot.subjectCode),
  ),
];

const examSubjects = subjectRows
  .filter((row) => taughtCodes.includes(row.code))
  .slice(0, 4);

if (examSubjects.length === 0) {
  console.error("No subjects to examine — is the timetable seeded?");
  process.exit(1);
}

const TERM = "Term 1";

// Delete-then-insert: the papers, marks and change log all cascade off the
// exam, so this is what makes a second run leave the same database.
die(
  "Could not clear the old exams",
  (
    await db
      .from("assessments")
      .delete()
      .eq("session_label", sessionLabel)
      .eq("term", TERM)
      .in("code", ["FA1", "SA1"])
  ).error,
);

const { data: exams, error: examError } = await db
  .from("assessments")
  .insert([
    {
      session_label: sessionLabel,
      term: TERM,
      code: "FA1",
      label_hi: "प्रथम सतत मूल्यांकन",
      label_en: "First formative",
      kind: "formative",
      // Out of 20 and worth half as much as the half-yearly: the report card's
      // weighting only means anything when two exams disagree about it.
      weight: 1,
      status: "open",
      starts_on: isoDay(-40),
      ends_on: isoDay(-36),
      created_by: null,
    },
    {
      session_label: sessionLabel,
      term: TERM,
      code: "SA1",
      label_hi: "अर्धवार्षिक परीक्षा",
      label_en: "Half yearly",
      kind: "summative",
      weight: 2,
      status: "open",
      starts_on: isoDay(-14),
      ends_on: isoDay(-8),
      created_by: null,
    },
  ])
  .select("id, code, term, label_hi, label_en, weight");
die("Could not create the exams", examError);

// A second class, examined but unmarked, so "who has not entered yet" has
// somebody real to name rather than being empty on a seeded database.
const otherClassId = [...new Set(enrolments.map((row) => row.class_id))].find(
  (classId) => classId !== targetClass.classId,
);

// The timetable only labels classes that have lessons on it, so the fee
// schema is the source here — a class examined but not timetabled would
// otherwise be seeded onto the board as the word "Class".
const { data: classRows } = await db
  .schema("public")
  .from("classes")
  .select("id, class_name, section")
  .eq("session_label", sessionLabel);

// Name and section joined the same way `classLabelMap()` joins them, so a
// paper's stored label reads as the rest of the app would have written it.
const classNames = new Map(
  (classRows ?? []).map((row) => [
    row.id,
    [row.class_name, row.section].filter(Boolean).join(" "),
  ]),
);

const labelFor = (classId) =>
  classNames.get(classId) ??
  slots.find((slot) => slot.classId === classId)?.classLabel ??
  "Class";

const paperRows = [];

for (const exam of exams) {
  const outOf = exam.code === "FA1" ? 20 : 80;

  examSubjects.forEach((subject, index) => {
    paperRows.push({
      assessment_id: exam.id,
      class_id: targetClass.classId,
      class_label: targetClassLabel,
      subject_id: subject.id,
      subject_code: subject.code,
      max_marks: outOf,
      pass_marks: Math.round(outOf * 0.33),
      sort_order: index,
    });

    if (otherClassId && exam.code === "SA1") {
      paperRows.push({
        assessment_id: exam.id,
        class_id: otherClassId,
        class_label: labelFor(otherClassId),
        subject_id: subject.id,
        subject_code: subject.code,
        max_marks: outOf,
        pass_marks: Math.round(outOf * 0.33),
        sort_order: index,
      });
    }
  });
}

const { data: papers, error: paperError } = await db
  .from("assessment_subjects")
  .insert(paperRows)
  .select(
    "id, assessment_id, class_id, class_label, subject_id, subject_code, max_marks, pass_marks, sort_order",
  );
die("Could not create the papers", paperError);

const ourPapers = papers.filter((paper) => paper.class_id === targetClass.classId);

// The last two children on the roll are left unmarked on every paper, so the
// board's outstanding count and the report card's "not entered" both have
// something true to say.
const marked = targetClass.roll.slice(0, -2);
const SPREAD = [0.92, 0.81, 0.74, 0.66, 0.58, 0.47, 0.35];
const codeOf = new Map(exams.map((exam) => [exam.id, exam.code]));

const examMarks = [];

for (const paper of ourPapers) {
  const isFormative = codeOf.get(paper.assessment_id) === "FA1";

  marked.forEach((student, index) => {
    // One child away for one paper, one child on nought. A nought is a mark
    // somebody gave and must read as entered everywhere; an absence is not a
    // mark at all, and the column check refuses to store a value beside it.
    const absent = index === 0 && paper.sort_order === 0;
    const zero = index === 1 && paper.sort_order === 1;

    // The first child picked up after the formative: weak in the one that
    // counts once, strong in the one that counts double. Without somebody
    // shaped like this the weighting is invisible on seeded data — every
    // child scoring the same share of both papers gets the same percentage
    // whether it is weighted or not, and a smoke test that cannot tell the
    // two apart is not testing the thing.
    const share =
      index === 0
        ? isFormative
          ? 0.4
          : 0.88
        : SPREAD[index % SPREAD.length];

    examMarks.push({
      assessment_subject_id: paper.id,
      student_id: student.student_id,
      value: absent ? null : zero ? 0 : Math.round(paper.max_marks * share * 2) / 2,
      absent,
      entered_by: raj?.id ?? null,
    });
  });
}

die("Could not write the marks", (await db.from("marks").insert(examMarks)).error);

// One mark corrected after the fact, with both sides of it kept. This is the
// write the log exists for: "it was 68 last week" needs an answer that does
// not depend on anybody remembering.
const corrected = examMarks.find(
  (row) => !row.absent && row.value !== null && row.value > 5,
);

if (corrected) {
  const wasValue = corrected.value;
  const nowValue = wasValue - 4;

  die(
    "Could not correct a mark",
    (
      await db
        .from("marks")
        .update({ value: nowValue })
        .eq("assessment_subject_id", corrected.assessment_subject_id)
        .eq("student_id", corrected.student_id)
    ).error,
  );

  corrected.value = nowValue;

  die(
    "Could not write the change log",
    (
      await db.from("marks_change_log").insert({
        assessment_subject_id: corrected.assessment_subject_id,
        student_id: corrected.student_id,
        from_value: wasValue,
        to_value: nowValue,
        from_absent: false,
        to_absent: false,
        reason: "Re-totalled: a page was missed in marking.",
        changed_by: raj?.id ?? null,
      })
    ).error,
  );
}

console.log(
  `assessments: ${exams.length} exams, ${papers.length} papers ` +
    `(${papers.length - ourPapers.length} nobody has marked), ` +
    `${examMarks.length} marks — 1 absent, 1 nought, ${targetClass.roll.length - marked.length} children blank, 1 corrected`,
);

/* ------------------------------------------------------- a report card */
//
// Built by `buildReportCard()` itself, loaded from source, for the same reason
// the cover plan is produced by the engine: a hand-written payload here would
// seed a card the app could never have produced, and the snapshot is the whole
// point of the table.

const cardStudent = targetClass.roll[0];

if (cardStudent) {
  const { data: studentRow } = await db
    .schema("public")
    .from("students")
    .select("id, full_name, admission_no, father_name")
    .eq("id", cardStudent.student_id)
    .maybeSingle();

  // The child's own attendance, read back from what was seeded above, so the
  // card's percentage and the register agree.
  const { data: registers } = await db
    .from("attendance_registers")
    .select("id")
    .eq("class_id", targetClass.classId)
    .in("day", registerDays);

  const { data: attendanceMarks } = await db
    .from("attendance_marks")
    .select("status")
    .eq("student_id", cardStudent.student_id)
    .in("register_id", (registers ?? []).map((row) => row.id));

  const summary = attendancePercent(
    (attendanceMarks ?? []).map((row) => row.status),
  );

  const card = buildReportCard({
    sessionLabel,
    term: TERM,
    student: {
      id: cardStudent.student_id,
      fullName: studentRow?.full_name ?? "Student",
      admissionNo: studentRow?.admission_no ?? null,
      rollNo: cardStudent.roll_no,
      classLabel: targetClassLabel,
      fatherName: studentRow?.father_name ?? null,
    },
    assessments: exams.map((exam) => ({
      id: exam.id,
      sessionLabel,
      term: exam.term,
      code: exam.code,
      labelHi: exam.label_hi,
      labelEn: exam.label_en,
      kind: "summative",
      startsOn: null,
      endsOn: null,
      weight: Number(exam.weight),
      status: "open",
      lockedAt: null,
      lockedByName: null,
    })),
    papers: ourPapers.map((paper) => ({
      id: paper.id,
      assessmentId: paper.assessment_id,
      classId: paper.class_id,
      classLabel: paper.class_label,
      subjectId: paper.subject_id,
      subjectCode: paper.subject_code,
      maxMarks: Number(paper.max_marks),
      passMarks: paper.pass_marks === null ? null : Number(paper.pass_marks),
      sortOrder: paper.sort_order,
    })),
    marks: new Map(
      examMarks
        .filter((row) => row.student_id === cardStudent.student_id)
        .map((row) => [
          `${row.assessment_subject_id}|${row.student_id}`,
          {
            studentId: row.student_id,
            value: row.value,
            absent: row.absent,
            enteredByName: null,
            enteredAt: new Date().toISOString(),
          },
        ]),
    ),
    attendance:
      summary.counted === 0
        ? null
        : {
            present: summary.present,
            counted: summary.counted,
            percent: summary.percent,
          },
    generatedAt: new Date().toISOString(),
  });

  die(
    "Could not issue the report card",
    (
      await db.from("report_cards").upsert(
        {
          session_label: sessionLabel,
          student_id: cardStudent.student_id,
          term: TERM,
          payload: card,
          generated_by: raj?.id ?? null,
        },
        { onConflict: "session_label,student_id,term" },
      )
    ).error,
  );

  console.log(
    `report card: 1 issued — ${card.rows.length} subjects, ` +
      `${card.totals.scored}/${card.totals.outOf} (${card.totals.percent ?? "—"}%), ` +
      `grade ${card.grade ?? "—"}`,
  );
}

/* -------------------------------------------------------- the export log */

await db.from("academic_exports").delete().eq("session_label", sessionLabel);

die(
  "Could not write the export log",
  (
    await db.from("academic_exports").insert([
      {
        session_label: sessionLabel,
        kind: "marks",
        scope: `${TERM} SA1`,
        row_count: examMarks.length,
        exported_by: raj?.id ?? null,
      },
      {
        session_label: sessionLabel,
        kind: "report_cards",
        scope: `${TERM} · ${targetClassLabel}`,
        row_count: 1,
        exported_by: raj?.id ?? null,
      },
    ])
  ).error,
);

console.log("exports: 2 logged");

console.log("\nseeded.");
