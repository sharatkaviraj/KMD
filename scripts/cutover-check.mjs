#!/usr/bin/env node
/**
 * Is dev in a state worth copying to live?
 *
 *   npm run cutover:check
 *
 * **Reads dev, and only dev.** It refuses to run against anything else, and it
 * never connects to the live fee project — rule 3, and the cutover itself is a
 * decision somebody else makes (rule 8). This answers the questions that are
 * easier before the day than during it.
 *
 * Two things it checks that nothing else does:
 *
 * - every table the migrations create actually exists on dev. Not the
 *   bookkeeping in `supabase_migrations` — that is not exposed to PostgREST,
 *   and exposing it to check on it would be a strange thing to do to a
 *   database. The effect is the better question anyway: a migration nobody
 *   applied is a table that answers "not found", which is exactly how it will
 *   fail on live, as a 500 on a Tuesday rather than as an error in a migration.
 * - `expose_vppsone_to_postgrest` is in the list. It is a PostgREST setting
 *   rather than a schema object, so it is the one that gets skipped, and
 *   skipping it makes the app answer `PGRST106` on its first request (D-19).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import {
  isDevProjectUrl,
  projectRefOf,
  PROTECTED_LIVE_PROJECT_REF,
} from "./target-guard.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_PROJECT_REF = PROTECTED_LIVE_PROJECT_REF;

const env = Object.fromEntries(
  readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const at = line.indexOf("=");
      return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";

if (projectRefOf(url) === LIVE_PROJECT_REF) {
  console.error("Refusing to run: that is the live fee project (rule 3).");
  process.exit(1);
}

if (!isDevProjectUrl(url)) {
  console.error("Refusing to run: .env.local is not the dev project (rule 3).");
  process.exit(1);
}

const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false },
});

let problems = 0;
const bad = (line) => {
  problems += 1;
  console.log(`  ✗ ${line}`);
};
const good = (line) => console.log(`  ✓ ${line}`);

/* ------------------------------------------------------------ migrations */

console.log("\nMigrations");

const files = readdirSync(path.join(repoRoot, "supabase/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();

// `supabase_migrations` is not exposed to PostgREST, and exposing it to check
// on it would be a strange thing to do to a database. So this checks the
// *effect* rather than the bookkeeping: every table the migrations create is
// asked for a row count, which is the same question a page asks and fails the
// same way. A migration nobody applied is a table that answers "not found".
const expected = [
  ...new Set(
    files.flatMap((file) => {
      const sql = readFileSync(path.join(repoRoot, "supabase/migrations", file), "utf8");
      return [...sql.matchAll(/create\s+table\s+vppsone\.(\w+)/gi)].map((m) => m[1]);
    }),
  ),
].sort();

// A check that finds nothing to check has not passed, it has broken. This
// script exists to be believed on a day when somebody is about to touch the
// live project, so it says so rather than printing a tick.
if (expected.length === 0) {
  bad("found no tables to check — this script is broken, do not trust its tick");
}

const missing = [];

for (const table of expected) {
  // `*` rather than `id`: not every table has one — `rate_limits` is keyed on
  // its bucket — and a probe that assumes a column reports a table as missing
  // when it is only shaped differently. On the day this runs, a false alarm is
  // as expensive as a missed one.
  const { error } = await db.from(table).select("*", { count: "exact", head: true });
  if (error) missing.push(`${table} (${error.message || "no such table"})`);
}

if (missing.length === 0) {
  good(`all ${expected.length} tables the ${files.length} migrations create exist on dev`);
} else {
  for (const entry of missing) bad(`missing: ${entry}`);
}

// The one that is a setting rather than a schema object, and so the one that
// gets left out of a hand-copied list.
if (files.some((name) => name.includes("expose_vppsone_to_postgrest"))) {
  good("expose_vppsone_to_postgrest is in the list — do not skip it on live");
} else {
  bad("expose_vppsone_to_postgrest is missing: live will answer PGRST106");
}

// Nothing may create anything in `public` (rule 1).
for (const file of files) {
  const sql = readFileSync(path.join(repoRoot, "supabase/migrations", file), "utf8");
  const creates = sql.match(/create\s+(table|type|function|index|policy)\s+public\./gi);
  if (creates) bad(`${file} creates something in public: ${creates.join(", ")}`);
}

/* ---------------------------------------------------------- master data */

console.log("\nMaster data on dev (what step 3 has to reproduce for real)");

const counts = [
  ["staff_profiles", "staff", 1],
  ["subjects", "subjects", 1],
  ["class_aliases", "class aliases", 0],
  ["class_teachers", "class teachers", 1],
  ["academic_calendar_days", "calendar days", 0],
  ["enrolments", "enrolments", 1],
];

for (const [table, label, atLeast] of counts) {
  const { count, error } = await db
    .from(table)
    .select("*", { count: "exact", head: true });

  if (error) {
    bad(`${label}: could not read (${error.message})`);
    continue;
  }

  if ((count ?? 0) < atLeast) bad(`${label}: ${count ?? 0}`);
  else good(`${label}: ${count ?? 0}`);
}

const { data: published, error: publishedError } = await db
  .from("timetable_versions")
  .select("id, session_label")
  .eq("status", "published");

if (publishedError) bad(`timetable: could not read (${publishedError.message})`);
else if ((published ?? []).length === 1) good(`one published timetable`);
else bad(`published timetables: ${(published ?? []).length} (there should be one)`);

/* --------------------------------------------------------------- the jobs */

console.log("\nThe scheduled jobs");

if (env.CRON_SECRET || env.JOBS_SECRET) {
  good("a job secret is set locally — production needs its own, not this one");
} else {
  console.log(
    "  · no job secret set locally; production needs CRON_SECRET or the jobs stay inert",
  );
}

/* ------------------------------------------------------------------ done */

console.log("");

if (problems > 0) {
  console.log(`${problems} thing${problems === 1 ? "" : "s"} to sort out before cutover.`);
  process.exit(1);
}

console.log("Dev looks like something worth copying. The cutover itself is");
console.log("docs/CUTOVER.md, and it is Janmejay's call to make (rule 8).");
