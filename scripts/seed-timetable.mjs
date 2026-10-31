#!/usr/bin/env node
/**
 * Publish the fixture timetable on dev, so the teacher screens have periods.
 *
 *   npm run seed:timetable
 *
 * Every screen from Phase 2 onwards is shaped by a published timetable — the
 * Today card's periods, `teaching_assignments`, and every substitution
 * vacancy. A dev database with none is a database where half the app is an
 * empty state, so this puts one there.
 *
 * It parses `tests/fixtures/timetable-2026-27.csv` with **the app's own
 * parser** rather than a copy of it: `parse-timetable.ts` imports nothing, so
 * Node 24 loads it directly by stripping the types. A reimplementation here
 * would be a second parser to keep in step, and the whole point of the
 * fixture is that it is the sheet the school actually uses.
 *
 * Idempotent: re-running replaces the seeded version rather than stacking
 * another one beside it.
 *
 * Rule 3 / D-346: One's main project only. While the marker says production
 * it is confined: TEST-2026-27 and test-account teachers only.
 * Rule 6: the fixture is the one already in the repo; nothing new is written
 * into it here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  buildTeacherMap,
  parseTimetable,
} from "../src/modules/timetable/domain/parse-timetable.ts";
import { readActiveSession } from "./read-active-session.mjs";
import { toolScope } from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABEL = "Fixture v11 (seeded)";

function readEnv() {
  const file = path.join(repoRoot, ".env.local");
  const entries = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    });
  return Object.fromEntries(entries);
}

const env = readEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";

// Rule 3 / D-346: One's main project only, and CONFINED on production: there
// it publishes into TEST-2026-27 (never the active, real session) and names
// only test-account staff as teachers. Every write below is filtered by
// `sessionLabel`, so nothing outside that session is touched.
const scope = await toolScope({ url, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, label: "seed:timetable", mode: "test-scoped" });

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false },
});

const die = (label, error) => {
  if (error) {
    console.error(`${label}: ${error.message ?? error}`);
    process.exit(1);
  }
};

/* ------------------------------------------------------------ the session */

// The session the app is working in. See src/platform/config/active-session.ts
// for why this is not "the label that sorts last".
// On production: always TEST-2026-27 (`scope.sessionLabel`).
const sessionLabel = scope.confined ? scope.sessionLabel : await readActiveSession(db);

/* --------------------------------------- the TEST session's own master data */

// TEST-2026-27 has its classes and students in the fee schema (the fees app's
// rehearsal session) but none of One's own rows that hang off them: no
// timetable labels for its classes and no enrolments, so every teacher screen
// in it is an empty state and the fixture's class names resolve to nothing
// (Phase C, 31 Oct). When confined, and only for the TEST session, this fills
// the two in — idempotently, and touching no row of any other session:
//   - class_aliases: the real session's timetable label for the class of the
//     same name, pointed at the TEST class;
//   - enrolments: every active student of a TEST class, enrolled in it.
if (scope.confined) {
  const pub = db.schema("public");
  const activeSession = await readActiveSession(db);
  const [{ data: testClasses, error: testClassesError }, { data: realAliases, error: realAliasesError }, { data: testAliases, error: testAliasesError }] =
    await Promise.all([
      pub.from("classes").select("id, class_name").eq("session_label", sessionLabel),
      db.from("class_aliases").select("class_id, timetable_label, display_name, sort_order").eq("session_label", activeSession),
      db.from("class_aliases").select("class_id").eq("session_label", sessionLabel),
    ]);
  die("Could not read the TEST classes", testClassesError);
  die("Could not read the timetable labels", realAliasesError);
  die("Could not read the TEST timetable labels", testAliasesError);

  const { data: realClasses, error: realClassesError } = await pub
    .from("classes")
    .select("id, class_name")
    .in("id", (realAliases ?? []).map((row) => row.class_id));
  die("Could not read the real classes", realClassesError);

  const testClassByName = new Map((testClasses ?? []).map((row) => [row.class_name.toLowerCase(), row.id]));
  const realNameById = new Map((realClasses ?? []).map((row) => [row.id, row.class_name.toLowerCase()]));
  const aliased = new Set((testAliases ?? []).map((row) => row.class_id));
  const aliasRows = (realAliases ?? [])
    .map((row) => ({ ...row, class_id: testClassByName.get(realNameById.get(row.class_id) ?? "") }))
    .filter((row) => row.class_id && !aliased.has(row.class_id))
    .map((row) => ({
      class_id: row.class_id,
      session_label: sessionLabel,
      timetable_label: row.timetable_label,
      display_name: row.display_name,
      sort_order: row.sort_order,
    }));
  if (aliasRows.length > 0) {
    die("Could not write the TEST timetable labels", (await db.from("class_aliases").insert(aliasRows)).error);
  }

  const testClassIds = (testClasses ?? []).map((row) => row.id);
  const { data: testStudents, error: testStudentsError } = testClassIds.length
    ? await pub.from("students").select("id, class_id").in("class_id", testClassIds).eq("status", "active")
    : { data: [], error: null };
  die("Could not read the TEST students", testStudentsError);
  const today = new Date().toISOString().slice(0, 10);
  const enrolmentRows = (testStudents ?? []).map((row) => ({
    student_id: row.id,
    class_id: row.class_id,
    session_label: sessionLabel,
    status: "enrolled",
    enrolled_on: today,
  }));
  for (let index = 0; index < enrolmentRows.length; index += 500) {
    const { error } = await db
      .from("enrolments")
      .upsert(enrolmentRows.slice(index, index + 500), { onConflict: "student_id,session_label", ignoreDuplicates: true });
    die("Could not write the TEST enrolments", error);
  }
  console.log(`TEST master data: ${aliasRows.length} timetable labels added, ${enrolmentRows.length} active students enrolled (existing kept)`);
}

/* ------------------------------------------------------------ the mapping */

const [{ data: aliases }, { data: staff }, { data: subjects }] = await Promise.all([
  db
    .from("class_aliases")
    .select("class_id, timetable_label")
    .eq("session_label", sessionLabel),
  db.from("staff_profiles").select("id, short_name, is_test_account").eq("is_active", true),
  db.from("subjects").select("id, code").eq("is_active", true),
]);

// On production a teacher resolves only to a test account (D-346): a short
// name that belongs to real staff is "unresolved" below, and the run stops.
const eligibleStaff = (staff ?? []).filter((row) => !scope.confined || row.is_test_account === true);

const classesByLabel = new Map(
  (aliases ?? []).map((row) => [row.timetable_label.toLowerCase(), row.class_id]),
);
const teachersByShortName = new Map(
  eligibleStaff.filter((row) => row.short_name).map((row) => [row.short_name.toLowerCase(), row.id]),
);
const subjectsByCode = new Map(
  (subjects ?? []).map((row) => [row.code.toLowerCase(), row.id]),
);

/* ------------------------------------------------------------- the parse */

const sourceText = readFileSync(
  path.join(repoRoot, "tests/fixtures/timetable-2026-27.csv"),
  "utf8",
);

const parsed = parseTimetable(sourceText);
const teacherMap = buildTeacherMap(parsed);

console.log(
  `parsed: ${parsed.cellCount} cells, ${parsed.days.length} days, ` +
    `${parsed.classNames.length} classes, ${Object.keys(teacherMap).length} teachers, ` +
    `${parsed.problems.length} problems`,
);

/* --------------------------------------------------------- the resolution */

const slots = [];
const missing = new Map();

const note = (kind, name) => {
  const key = `${kind}:${name}`;
  missing.set(key, (missing.get(key) ?? 0) + 1);
};

for (const day of parsed.days) {
  for (const className of parsed.classNames) {
    const row = parsed.timetable[day]?.[className];
    if (!row) continue;

    const classId = classesByLabel.get(className.toLowerCase());

    row.forEach((cell, period) => {
      if (cell.free) return;
      if (!classId) {
        note("class", className);
        return;
      }

      // A parallel cell is two lessons side by side, one cohort each; a shared
      // cell is one lesson taught by several. The same rule the resolver uses.
      const pairs = cell.parallel
        ? cell.subjects.map((subject, index) => ({
            subject,
            teacher: cell.teachers[index],
          }))
        : cell.teachers.map((teacher) => ({ subject: cell.subject, teacher }));

      for (const pair of pairs) {
        const subjectId = subjectsByCode.get(String(pair.subject).toLowerCase());
        const staffProfileId = pair.teacher
          ? teachersByShortName.get(String(pair.teacher).toLowerCase())
          : undefined;

        if (!subjectId) note("subject", pair.subject);
        if (pair.teacher && !staffProfileId) note("teacher", pair.teacher);
        if (!subjectId || !staffProfileId) continue;

        slots.push({
          day,
          period,
          class_id: classId,
          class_label: className,
          subject_id: subjectId,
          subject_code: pair.subject,
          staff_profile_id: staffProfileId,
          teacher_short_name: pair.teacher,
          parallel: Boolean(cell.parallel),
          shared: !cell.parallel && cell.teachers.length > 1,
        });
      }
    });
  }
}

if (missing.size > 0) {
  console.error("Unresolved names — fix the master data first:");
  for (const [key, count] of missing) console.error(`  ${key} (${count} cells)`);
  process.exit(1);
}

console.log(`resolved: ${slots.length} slots for session ${sessionLabel}`);

/* -------------------------------------------------------------- the write */

// Idempotent: the seeded version is replaced, not stacked beside itself.
await db
  .from("timetable_versions")
  .delete()
  .eq("session_label", sessionLabel)
  .eq("label", LABEL);

const { data: version, error: versionError } = await db
  .from("timetable_versions")
  .insert({
    session_label: sessionLabel,
    label: LABEL,
    status: "draft",
    source_text: sourceText,
    notes: "Seeded by scripts/seed-timetable.mjs from the repo fixture.",
    cell_count: parsed.cellCount,
    slot_count: slots.length,
  })
  .select("id")
  .single();
die("Could not create the draft", versionError);

for (let index = 0; index < slots.length; index += 500) {
  const { error } = await db
    .from("timetable_slots")
    .insert(slots.slice(index, index + 500).map((slot) => ({ ...slot, version_id: version.id })));
  die("Could not write the slots", error);
}

// Archive first, then publish: the partial unique index allows exactly one
// published version per session, so the other order is refused.
die(
  "Could not archive the previous version",
  (
    await db
      .from("timetable_versions")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("session_label", sessionLabel)
      .eq("status", "published")
  ).error,
);

die(
  "Could not publish",
  (
    await db
      .from("timetable_versions")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", version.id)
  ).error,
);

/* ------------------------------------------------- teaching assignments */

const perTeacherClassSubject = new Map();
for (const slot of slots) {
  const key = `${slot.staff_profile_id}|${slot.class_id}|${slot.subject_id}`;
  perTeacherClassSubject.set(key, (perTeacherClassSubject.get(key) ?? 0) + 1);
}

die(
  "Could not clear the old assignments",
  (await db.from("teaching_assignments").delete().eq("session_label", sessionLabel)).error,
);

const assignments = [...perTeacherClassSubject.entries()].map(([key, periods]) => {
  const [staffProfileId, classId, subjectId] = key.split("|");
  return {
    session_label: sessionLabel,
    staff_profile_id: staffProfileId,
    class_id: classId,
    subject_id: subjectId,
    periods_per_week: periods,
    version_id: version.id,
  };
});

for (let index = 0; index < assignments.length; index += 500) {
  const { error } = await db
    .from("teaching_assignments")
    .insert(assignments.slice(index, index + 500));
  die("Could not write the assignments", error);
}

console.log(
  `published version ${version.id}: ${slots.length} slots, ${assignments.length} teaching assignments`,
);
