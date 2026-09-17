#!/usr/bin/env node
/**
 * The QA fixture: nine accounts, two real teachers, and a way to put it back.
 *
 *   npm run qa:seed                    # create or refresh, print the run id
 *   npm run qa:seed -- --edge-classes  # also make an empty class and a class of one
 *   npm run qa:status                  # what runs exist and what they touched
 *   npm run qa:reset                   # undo the most recent seed
 *   npm run qa:reset -- --run r2609170942
 *   npm run qa:reset -- --all
 *
 * **What this exists to fix.** Until R0.2 the account the role smoke signed in
 * as for `teacher` had no periods, no assignments and no class — so 36 of its
 * 216 combinations were results about an empty teacher and nothing said so
 * (B-17). A teacher fixture that cannot take a register cannot test taking a
 * register.
 *
 * **Why it writes an undo log.** The seeder has to touch rows it did not
 * create: binding a QA login to a staff profile the timetable already knows is
 * the only way to give that login a day, because periods come from
 * `timetable_slots` and a profile the sheet has never heard of has none. Rows
 * like that must go back exactly as they were, so every write records its
 * `previous` value in `vppsone.qa_undo` and `qa:reset` replays it backwards.
 * Assuming the old value was null is how a fixture quietly eats a setting.
 *
 * Deterministic: the two teachers are chosen by rule (most periods, ties by
 * short name, second must share no class with the first), never by a name
 * written into this repository — rule 6, and it also survives a new timetable.
 *
 * Rule 3: dev only, and it refuses to run anywhere else.
 * Rule 6: every address is `@qa.vpps.local` and no real person is named here.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import {
  QA_ACCOUNTS,
  QA_EMAIL_DOMAIN,
  pickTimetableTeachers,
} from "../tests/fixtures/qa-accounts.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEV_PROJECT_REF = "wtgxcptmucjerhufzjcf";

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
  console.error("Refusing to run: .env.local is not the dev project (rule 3).");
  process.exit(1);
}

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "vppsone" },
  auth: { persistSession: false },
});

const pub = db.schema("public");

/** Every read fails loudly. A swallowed error reports a confident zero (D-93). */
function must(label, { data, error }) {
  if (error) {
    console.error(`${label}: ${error.message}`);
    process.exit(1);
  }
  return data;
}

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("--")) ?? "seed";
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : null;
};

/* ------------------------------------------------------------- the undo log */

let runId = null;
let seq = 0;

async function startRun(kind, note) {
  // Readable at a terminal, because `qa:reset --run <id>` is typed by a person.
  const stamp = new Date(Date.now() + 330 * 60_000)
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(2, 12);

  seq = 0;

  // Two runs in the same minute must not share an id. An `upsert` would have
  // merged their undo logs and restarted `seq` at 1 inside the older one, so
  // the steps would reverse in an order neither run chose — and the log is the
  // only record of how to put anything back.
  for (let attempt = 1; ; attempt += 1) {
    runId = attempt === 1 ? `r${stamp}` : `r${stamp}-${attempt}`;

    const { error } = await db
      .from("qa_runs")
      .insert({ run_id: runId, seed: SEED, kind, note });

    if (!error) return runId;

    // 23505 is the primary key. Anything else is a real failure.
    if (error.code !== "23505" || attempt > 50) {
      console.error(`Could not start the run: ${error.message}`);
      process.exit(1);
    }
  }
}

async function record(table, action, key, previous) {
  seq += 1;
  const { error } = await db.from("qa_undo").insert({
    run_id: runId,
    seq,
    table_name: table,
    action,
    key,
    previous: previous ?? null,
  });

  // A write we cannot undo is a write we should not have made. Stopping here
  // leaves a shorter mess than carrying on would.
  if (error) {
    console.error(`Could not record the undo step for ${table}: ${error.message}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------- seed */

/**
 * The seed string. Fixed, not random: two runs must pick the same teachers and
 * the same class, or an intermittent failure cannot be argued about.
 * `--seed x` overrides it for somebody deliberately exploring a second shape.
 */
const SEED = value("seed") ?? "vppsone-r0.2";

async function seed() {
  const id = await startRun("seed", flag("edge-classes") ? "with edge classes" : null);
  console.log(`run ${id} · seed ${SEED}\n`);

  /* -------------------------------------------------- what is already here */

  const sessions = must(
    "Could not read the sessions",
    await pub.from("classes").select("session_label"),
  );
  const sessionLabel = [...new Set(sessions.map((row) => row.session_label))]
    .sort()
    .reverse()[0];

  const classes = must(
    "Could not read the classes",
    await pub.from("classes").select("id, class_name, sort_order").order("sort_order"),
  );

  const version = must(
    "Could not read the published timetable",
    await db
      .from("timetable_versions")
      .select("id")
      .eq("status", "published")
      .maybeSingle(),
  );

  if (!version) {
    console.error("No published timetable. Run `npm run seed:timetable` first.");
    process.exit(1);
  }

  const profiles = must(
    "Could not read the staff",
    await db
      .from("staff_profiles")
      .select("*"),
  );

  /* ------------------------------------------- the two teachers, by rule */

  // Paged: a published timetable is over a thousand rows and PostgREST answers
  // the first thousand with no error at all (D-62).
  const slots = [];
  for (let from = 0; ; from += 1000) {
    const page = must(
      "Could not read the timetable",
      await db
        .from("timetable_slots")
        .select("staff_profile_id, class_id")
        .eq("version_id", version.id)
        .range(from, from + 999),
    );
    slots.push(...page);
    if (page.length < 1000) break;
  }

  const byTeacher = new Map();
  for (const slot of slots) {
    if (!slot.staff_profile_id) continue;
    const entry = byTeacher.get(slot.staff_profile_id) ?? { classIds: new Set(), slots: 0 };
    entry.classIds.add(slot.class_id);
    entry.slots += 1;
    byTeacher.set(slot.staff_profile_id, entry);
  }

  const candidates = [...byTeacher.entries()]
    .map(([staffProfileId, entry]) => {
      const profile = profiles.find((p) => p.id === staffProfileId);
      return profile && profile.is_active && profile.role === "teacher"
        ? {
            staffProfileId,
            shortName: profile.short_name,
            classIds: [...entry.classIds],
            slots: entry.slots,
          }
        : null;
    })
    .filter(Boolean);

  const pair = pickTimetableTeachers(candidates);
  console.log(
    `teacher 1: ${pair.first.shortName} · ${pair.first.slots} periods · ${pair.first.classIds.length} classes`,
  );
  console.log(
    `teacher 2: ${pair.second.shortName} · ${pair.second.slots} periods · ${pair.second.classIds.length} classes`,
  );
  console.log("(disjoint by construction — nothing here is hard-coded)\n");

  /* --------------------------------------------------- resolve every account */

  const resolved = [];

  for (const account of QA_ACCOUNTS) {
    if (!account.email.endsWith(QA_EMAIL_DOMAIN)) {
      console.error(`${account.email} is outside ${QA_EMAIL_DOMAIN} — refusing.`);
      process.exit(1);
    }

    let profile = null;

    if (account.binding.kind === "existing") {
      profile = profiles.find((p) => p.short_name === account.binding.shortName);
      if (!profile) {
        console.error(
          `No staff profile ${account.binding.shortName} for ${account.email}.`,
        );
        process.exit(1);
      }
    } else if (account.binding.kind === "timetable-teacher") {
      const chosen = account.binding.slot === 1 ? pair.first : pair.second;
      profile = profiles.find((p) => p.id === chosen.staffProfileId);
    } else {
      profile = profiles.find((p) => p.short_name === account.binding.shortName) ?? null;
    }

    resolved.push({ account, profile });
  }

  /* ------------------------------------------------- auth users, then binding */

  const authUsers = new Map();
  let page = 1;
  for (;;) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.error(`Could not list the accounts: ${error.message}`);
      process.exit(1);
    }
    for (const user of data.users) authUsers.set(user.email?.toLowerCase(), user.id);
    if (data.users.length < 1000) break;
    page += 1;
  }

  for (const entry of resolved) {
    const existing = authUsers.get(entry.account.email.toLowerCase());
    if (existing) {
      entry.userId = existing;
      continue;
    }

    const { data, error } = await db.auth.admin.createUser({
      email: entry.account.email,
      email_confirm: true,
    });

    if (error) {
      console.error(`Could not create ${entry.account.email}: ${error.message}`);
      process.exit(1);
    }

    entry.userId = data.user.id;
    entry.created = true;
    await record("auth.users", "insert", { id: data.user.id });
  }

  // Create the profiles that do not exist yet, before anything binds to them.
  for (const entry of resolved) {
    if (entry.profile || entry.account.binding.kind !== "create") continue;

    const { data, error } = await db
      .from("staff_profiles")
      .insert({
        short_name: entry.account.binding.shortName,
        display_name: entry.account.binding.displayName,
        role: entry.account.role,
        is_active: entry.account.binding.isActive,
        is_teaching: entry.account.role === "teacher",
        preferred_language: entry.account.language,
      })
      .select("*")
      .single();

    if (error) {
      console.error(`Could not create profile ${entry.account.binding.shortName}: ${error.message}`);
      process.exit(1);
    }

    entry.profile = data;
    await record("vppsone.staff_profiles", "insert", { id: data.id });
  }

  const wanted = new Map(resolved.map((entry) => [entry.userId, entry.profile.id]));

  // **Release before claiming.** `user_id` is unique, so a login that is
  // moving from one profile to another has to be let go of first — and the
  // profile losing it is a row we did not create, so the old value is recorded.
  for (const profile of profiles) {
    if (!profile.user_id) continue;
    const target = wanted.get(profile.user_id);
    if (target === undefined || target === profile.id) continue;

    await record("vppsone.staff_profiles", "update", { id: profile.id }, profile);
    const { error } = await db
      .from("staff_profiles")
      .update({ user_id: null })
      .eq("id", profile.id);
    if (error) {
      console.error(`Could not release ${profile.short_name}: ${error.message}`);
      process.exit(1);
    }
    profile.user_id = null;
  }

  for (const entry of resolved) {
    const before = profiles.find((p) => p.id === entry.profile.id) ?? entry.profile;
    const isActive =
      entry.account.binding.kind === "create"
        ? entry.account.binding.isActive
        : entry.account.canSignIn;

    const next = {
      user_id: entry.userId,
      role: entry.account.role,
      preferred_language: entry.account.language,
      is_active: isActive,
    };

    const unchanged =
      before.user_id === next.user_id &&
      before.role === next.role &&
      before.preferred_language === next.preferred_language &&
      before.is_active === next.is_active;

    // An unchanged save writes nothing and logs nothing (D-80). Otherwise a
    // second `qa:seed` would fill the undo log with rows that restore a value
    // to itself, and the log is how cleanup is proved.
    if (unchanged) continue;

    await record("vppsone.staff_profiles", "update", { id: before.id }, before);

    const { error } = await db
      .from("staff_profiles")
      .update(next)
      .eq("id", before.id);

    if (error) {
      console.error(`Could not bind ${entry.account.email}: ${error.message}`);
      process.exit(1);
    }
  }

  /* --------------------------------------------------- a class of their own */

  const openRows = must(
    "Could not read the class teachers",
    await db
      .from("class_teachers")
      .select("id, class_id, staff_profile_id")
      .eq("session_label", sessionLabel)
      .is("effective_to", null),
  );

  const taken = new Set(openRows.map((row) => row.class_id));
  const orderOf = new Map(classes.map((row) => [row.id, row.sort_order ?? 0]));
  const nameOf = new Map(classes.map((row) => [row.id, row.class_name]));

  for (const [slot, teacher] of [
    [1, pair.first],
    [2, pair.second],
  ]) {
    const already = openRows.find((row) => row.staff_profile_id === teacher.staffProfileId);
    if (already) {
      console.log(`teacher ${slot} already holds ${nameOf.get(already.class_id)}`);
      continue;
    }

    // Lowest class they teach that nobody else holds. Lowest rather than
    // largest, so the choice does not move when a child transfers.
    const free = teacher.classIds
      .filter((classId) => !taken.has(classId))
      .sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0))[0];

    if (!free) {
      console.error(
        `Every class ${teacher.shortName} teaches already has a class teacher. Reset an older run first.`,
      );
      process.exit(1);
    }

    const { data, error } = await db
      .from("class_teachers")
      .insert({
        class_id: free,
        session_label: sessionLabel,
        staff_profile_id: teacher.staffProfileId,
        role: "class_teacher",
      })
      .select("id")
      .single();

    if (error) {
      console.error(`Could not make teacher ${slot} a class teacher: ${error.message}`);
      process.exit(1);
    }

    taken.add(free);
    await record("vppsone.class_teachers", "insert", { id: data.id });
    console.log(`teacher ${slot} is now class teacher of ${nameOf.get(free)}`);
  }

  /* --------------------------------------------------------------- a round */

  // **One round, so `/collection/rounds/[id]` is reachable.** The role smoke
  // resolves a dynamic route against a real row and treats a missing one as a
  // *failure* rather than a skip (D-117) — so a screen with no fixture behind
  // it is a screen nobody has ever checked the permissions of.
  //
  // Deliberately a narrowed audience with a reason: an empty-audience round
  // would render the "nothing selected" branch, which is not the page anybody
  // needs covered.
  const roundClass = classes.find((row) => !taken.has(row.id)) ?? classes[0];

  const askable = must(
    "Could not read the collection fields",
    await db
      .from("collection_fields")
      .select("id, key")
      .eq("is_active", true)
      .order("sort_order"),
  );

  if (roundClass && askable.length > 0) {
    const { data: round, error } = await db
      .from("collection_rounds")
      .insert({
        session_label: sessionLabel,
        title_hi: "QA राउंड",
        title_en: "QA round",
        audience: {
          classIds: [roundClass.id],
          houses: [],
          routeIds: [],
          search: "",
          gaps: [{ fieldKey: askable[0].key }],
          allEnrolled: false,
          studentIds: [],
          notes: {},
          from: null,
        },
        reason_hi: "QA — जाँच के लिए बनाया गया राउंड",
        reason_en: "QA — a round made for checking",
        recipient_mode: "class_teacher",
        status: "draft",
      })
      .select("id")
      .single();

    if (error) {
      console.error(`Could not seed the QA round: ${error.message}`);
      process.exit(1);
    }

    await record("vppsone.collection_rounds", "insert", { id: round.id });

    const { error: fieldError } = await db
      .from("collection_round_fields")
      .insert({ round_id: round.id, field_id: askable[0].id, sort_order: 0 });

    if (fieldError) {
      console.error(`Could not seed the QA round's fields: ${fieldError.message}`);
      process.exit(1);
    }

    console.log(`round "QA round" asks ${roundClass.class_name} for ${askable[0].key}`);
  }

  /* ------------------------------------------------------------ edge classes */

  if (flag("edge-classes")) {
    await seedEdgeClasses(sessionLabel, classes);
  }

  await db.from("qa_runs").update({ finished_at: new Date().toISOString() }).eq("run_id", runId);

  console.log(`\n${seq} reversible changes recorded.`);
  console.log(`Undo this run with: npm run qa:reset -- --run ${runId}`);
}

/**
 * A class with nobody in it, and a class with one child.
 *
 * QA.md wants both, and the fee app owns the roster — rule 2 forbids writing a
 * student row from here, so the only honest way to make an empty class is to
 * mark *our own* enrolment rows as left. That is a VPPS One table, it is
 * exactly what a class emptying out looks like in real life, and the undo log
 * puts every row back.
 *
 * A 40-child class cannot be made this way and is not attempted: it needs more
 * children than the fee app's dev database has, and inventing them here would
 * be a write into `public.students`.
 */
async function seedEdgeClasses(sessionLabel, classes) {
  const enrolments = must(
    "Could not read the enrolments",
    await db
      .from("enrolments")
      .select("*")
      .eq("session_label", sessionLabel)
      .eq("status", "enrolled"),
  );

  const byClass = new Map();
  for (const row of enrolments) {
    byClass.set(row.class_id, [...(byClass.get(row.class_id) ?? []), row]);
  }

  // Smallest two classes that nobody has already emptied, in class order, so
  // the fixture disturbs as few children as possible and picks the same two
  // classes every run.
  const ordered = classes
    .filter((row) => (byClass.get(row.id) ?? []).length > 0)
    .sort(
      (a, b) =>
        (byClass.get(a.id).length - byClass.get(b.id).length) ||
        (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );

  const [emptyClass, singleClass] = ordered;

  if (!emptyClass || !singleClass) {
    console.log("\nNot enough populated classes to build the edge cases; skipped.");
    return;
  }

  const leave = async (rows, label) => {
    for (const row of rows) {
      await record("vppsone.enrolments", "update", { id: row.id }, row);
      const { error } = await db
        .from("enrolments")
        .update({ status: "left", left_on: new Date().toISOString().slice(0, 10) })
        .eq("id", row.id);
      if (error) {
        console.error(`Could not move a child out of ${label}: ${error.message}`);
        process.exit(1);
      }
    }
  };

  // Deterministic: sorted by student id, so "all but one" is always the same one.
  const emptyRows = [...byClass.get(emptyClass.id)].sort((a, b) =>
    a.student_id.localeCompare(b.student_id),
  );
  const singleRows = [...byClass.get(singleClass.id)].sort((a, b) =>
    a.student_id.localeCompare(b.student_id),
  );

  await leave(emptyRows, emptyClass.class_name);
  await leave(singleRows.slice(1), singleClass.class_name);

  console.log(`\n${emptyClass.class_name} now has no children on the roll.`);
  console.log(`${singleClass.class_name} now has exactly one.`);
}

/* ------------------------------------------------------------------ reset */

async function reset() {
  const only = value("run");
  const all = flag("all");

  const runs = must(
    "Could not read the runs",
    await db
      .from("qa_runs")
      .select("run_id, started_at, kind, note")
      .eq("kind", "seed")
      .order("started_at", { ascending: false }),
  );

  const targets = only
    ? runs.filter((row) => row.run_id === only)
    : all
      ? runs
      : runs.slice(0, 1);

  if (targets.length === 0) {
    console.log(only ? `No run ${only}.` : "Nothing to reset.");
    return;
  }

  for (const run of targets) {
    const steps = must(
      "Could not read the undo log",
      await db
        .from("qa_undo")
        .select("id, seq, table_name, action, key, previous")
        .eq("run_id", run.run_id)
        .order("seq", { ascending: false }),
    );

    console.log(`${run.run_id}: ${steps.length} steps to reverse`);

    for (const step of steps) {
      await reverse(step);
    }

    // Only after every step came back. A run row deleted first would take its
    // undo log with it (ON DELETE CASCADE) and leave the changes in place.
    const { error } = await db.from("qa_runs").delete().eq("run_id", run.run_id);
    if (error) {
      console.error(`Could not close ${run.run_id}: ${error.message}`);
      process.exit(1);
    }

    console.log(`${run.run_id}: reversed.`);
  }
}

async function reverse(step) {
  const [schema, table] = step.table_name.split(".");

  if (step.table_name === "auth.users") {
    const { error } = await db.auth.admin.deleteUser(step.key.id);
    // A user somebody already removed by hand is not a failure to reverse.
    if (error && !/not found/i.test(error.message)) {
      console.error(`Could not remove account ${step.key.id}: ${error.message}`);
      process.exit(1);
    }
    return;
  }

  const client = schema === "public" ? db.schema("public") : db;
  let query = client.from(table);

  if (step.action === "insert") {
    query = query.delete();
  } else if (step.action === "update") {
    query = query.update(step.previous);
  } else {
    const { error } = await client.from(table).insert(step.previous);
    if (error) {
      console.error(`Could not restore a ${step.table_name} row: ${error.message}`);
      process.exit(1);
    }
    return;
  }

  for (const [column, value] of Object.entries(step.key)) {
    query = query.eq(column, value);
  }

  const { error } = await query;
  if (error) {
    console.error(`Could not reverse ${step.action} on ${step.table_name}: ${error.message}`);
    process.exit(1);
  }
}

/* ----------------------------------------------------------------- status */

async function status() {
  const runs = must(
    "Could not read the runs",
    await db
      .from("qa_runs")
      .select("run_id, seed, kind, note, started_at, finished_at")
      .order("started_at", { ascending: false })
      .limit(20),
  );

  if (runs.length === 0) {
    console.log("No QA fixture runs. `npm run qa:seed` makes one.");
    return;
  }

  for (const run of runs) {
    const { count } = await db
      .from("qa_undo")
      .select("id", { count: "exact", head: true })
      .eq("run_id", run.run_id);

    const state = run.finished_at ? "finished" : "UNFINISHED";
    console.log(
      `${run.run_id}  ${run.kind.padEnd(5)} ${state.padEnd(10)} ${count ?? 0} steps  ${run.started_at}${run.note ? `  (${run.note})` : ""}`,
    );
  }
}

/* ------------------------------------------------------------------- go */

if (command === "seed") await seed();
else if (command === "reset") await reset();
else if (command === "status") await status();
else {
  console.error(`Unknown command: ${command}. Expected seed, reset or status.`);
  process.exit(1);
}
