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

const [
  { data: sessionRows, error: sessionError },
  { data: staff },
  { data: version },
  { data: kinds },
] = await Promise.all([
  db.schema("public").from("classes").select("session_label"),
  db.from("staff_profiles").select("id, display_name, short_name, is_teaching, role"),
  db
    .from("timetable_versions")
    .select("id, session_label")
    .eq("status", "published")
    .maybeSingle(),
  db.from("note_kinds").select("id, code").order("sort_order"),
]);

die("Could not read the sessions", sessionError);

const sessionLabel =
  [...new Set(sessionRows.map((row) => row.session_label))].sort().reverse()[0];

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

const targetClass = [...new Set(enrolments.map((row) => row.class_id))]
  .map((classId) => ({
    classId,
    roll: enrolments.filter((row) => row.class_id === classId),
  }))
  .sort((a, b) => b.roll.length - a.roll.length)[0];

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
console.log("\nseeded.");
