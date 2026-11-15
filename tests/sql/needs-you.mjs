/** In-memory PostgreSQL proof of Needs you (D-630..D-635):
 * supabase/migrations/*_needs_you.sql against a synthetic staff table. No URL,
 * credentials or hosted database accepted: pass a local installed
 * @electric-sql/pglite directory (CI installs it in a disposable folder).
 * Every name here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const found = readdirSync(migrations).filter((name) => name.endsWith("_needs_you.sql"));
assert.equal(found.length, 1, "one _needs_you.sql migration");

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.staff_profiles(id uuid primary key);
create function vppsone.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
`);
await db.exec(readFileSync(join(migrations, found[0]), "utf8"));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ME = id(1);
const OTHER = id(2);
await db.query("insert into vppsone.staff_profiles(id) values ($1), ($2)", [ME, OTHER]);
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};

/* ------------------------------------------------------------- reminders */

const own = "insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, title, heard, remind_at) values ($1, 'TEST-2026-27', 'own', $2, $3, $4) returning id";
const first = (await db.query(own, [ME, "Phone a parent about the trip", "kal subah 9 baje", "2026-11-16T03:30:00Z"])).rows[0].id;
assert.ok(first);
assert.equal((await db.query(own, [ME, "Bring the register book", null, null])).rows.length, 1);
console.log("PASS: an own to-do keeps the person's words, with or without a time");

await rejects(own, [ME, "   ", null, null], "needs_reminders_own_has_title");
await rejects(own, [ME, "x".repeat(201), null, null], "needs_reminders_own_has_title");
await rejects("insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, item_key) values ($1, 'TEST-2026-27', 'snooze', 'att:c1:2026-11-15')", [ME], "needs_reminders_snooze_has_job");
await rejects("insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, remind_at) values ($1, 'TEST-2026-27', 'snooze', now())", [ME], "needs_reminders_snooze_has_job");
await rejects("insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, title) values ($1, 'TEST-2026-27', 'alarm', 'x')", [ME], "needs_reminders_kind_known");
await rejects("insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, title) values ($1, 'X', 'own', 'x')", [ME], "needs_reminders_session_sane");
await rejects("insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, title, heard) values ($1, 'TEST-2026-27', 'own', 'x', $2)", [ME, "y".repeat(201)], "needs_reminders_heard_sane");
await rejects("insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, title) values ($1, 'TEST-2026-27', 'own', 'x')", [id(99)], "foreign key");
console.log("PASS: an own to-do needs words (1-200), a snooze needs its job and a time, and the person must exist");

const snooze = (await db.query("insert into vppsone.needs_reminders (staff_profile_id, session_label, kind, item_key, remind_at) values ($1, 'TEST-2026-27', 'snooze', 'notices', '2026-11-15T09:00:00Z') returning updated_at", [ME])).rows[0];
await db.query("update vppsone.needs_reminders set done_at = now() where id = $1", [first]);
const touched = (await db.query("select updated_at, done_at from vppsone.needs_reminders where id = $1", [first])).rows[0];
assert.ok(touched.done_at);
assert.ok(touched.updated_at >= snooze.updated_at);
console.log("PASS: a snooze names a job by its key, and ticking a to-do stamps updated_at");

/* ------------------------------------------------------------- the sync */

const sync = (staff, day, open, complete) =>
  db.query("select * from vppsone.needs_sync($1, 'TEST-2026-27', $2, $3::jsonb, $4)", [staff, day, JSON.stringify(open), complete]);
const job = (key, lane = "today", extra = {}) => ({ key, kind: key.split(":")[0], lane, title: { en: `Job ${key}`, hi: `काम ${key}` }, ...extra });
const DAY = "2026-11-15";

let done = await sync(ME, DAY, [job("att:c1:2026-11-15", "now"), job("marks:l1"), job("notices", "today"), job("leave:v1", "waiting")], true);
assert.equal(done.rows.length, 0);
const seen = await db.query("select item_key, lane, done_at from vppsone.needs_seen where staff_profile_id = $1 order by item_key", [ME]);
assert.deepEqual(seen.rows.map((r) => [r.item_key, r.lane, r.done_at]), [
  ["att:c1:2026-11-15", "now", null],
  ["leave:v1", "waiting", null],
  ["marks:l1", "today", null],
  ["notices", "today", null],
]);
console.log("PASS: the first sync records every job on the list, nothing done yet");

done = await sync(ME, DAY, [job("marks:l1", "now"), job("notices"), job("leave:v1", "waiting")], false);
assert.equal(done.rows.length, 0, "an incomplete read marks nothing done");
assert.equal((await db.query("select lane from vppsone.needs_seen where item_key = 'marks:l1'")).rows[0].lane, "now");
console.log("PASS: an incomplete read (a source failed) updates lanes but never ticks a job off");

done = await sync(ME, DAY, [job("marks:l1", "now"), job("leave:v1", "waiting")], true);
assert.deepEqual(done.rows.map((r) => r.seen_key).sort(), ["att:c1:2026-11-15", "notices"]);
assert.deepEqual(done.rows.find((r) => r.seen_key === "notices").seen_title, { en: "Job notices", hi: "काम notices" });
assert.equal(done.rows.find((r) => r.seen_key === "notices").seen_lane, "today");
console.log("PASS: a complete read marks the jobs that left the list done, and returns them with their titles");

done = await sync(ME, DAY, [job("marks:l1", "now"), job("notices"), job("leave:v1", "waiting")], true);
assert.deepEqual(done.rows.map((r) => r.seen_key), ["att:c1:2026-11-15"]);
assert.equal((await db.query("select done_at from vppsone.needs_seen where item_key = 'notices'")).rows[0].done_at, null);
console.log("PASS: a job that comes back (a new notice) is open again");

done = await sync(ME, DAY, [job("marks:l1"), job("marks:l1", "now"), { key: "", kind: "x", lane: "now", title: {} }, { key: "bad-lane", kind: "x", lane: "soon", title: {} }, { key: "no-title", kind: "x", lane: "now", title: "plain" }, "not-an-object", job("notices"), job("leave:v1", "waiting")], false);
assert.equal((await db.query("select count(*)::int n from vppsone.needs_seen where staff_profile_id = $1 and day = $2", [ME, DAY])).rows[0].n, 4);
console.log("PASS: a repeated key is kept once, and malformed jobs are skipped, not stored");

await sync(ME, DAY, [job("snz:x", "later", { wake_at: "2026-11-15T09:00:00Z" }), job("marks:l1"), job("notices"), job("leave:v1", "waiting")], true);
assert.equal((await db.query("select wake_at from vppsone.needs_seen where item_key = 'snz:x'")).rows[0].wake_at.toISOString(), "2026-11-15T09:00:00.000Z");
console.log("PASS: a put-off job keeps the time it comes back, for the menu's count");

// Another person and another day are their own lists.
await sync(OTHER, DAY, [job("notices")], true);
done = await sync(ME, "2026-11-16", [job("marks:l1")], true);
assert.equal(done.rows.length, 0);
assert.equal((await db.query("select count(*)::int n from vppsone.needs_seen where staff_profile_id = $1 and done_at is null and day = $2", [ME, DAY])).rows[0].n, 4);
assert.equal((await db.query("select count(*)::int n from vppsone.needs_seen where staff_profile_id = $1", [OTHER])).rows[0].n, 1);
console.log("PASS: each person and each day is its own list; a new day starts with nothing done");

await rejects("select * from vppsone.needs_sync($1, 'TEST-2026-27', $2, '{}'::jsonb, true)", [ME, DAY], "must be an array");
await rejects("select * from vppsone.needs_sync(null, 'TEST-2026-27', $1, '[]'::jsonb, true)", [DAY], "are required");
await rejects("select * from vppsone.needs_sync($1, 'TEST-2026-27', $2, $3::jsonb, true)", [ME, DAY, JSON.stringify(Array.from({ length: 201 }, (_, i) => job(`k:${i}`)))], "at most 200");
console.log("PASS: the sync refuses a missing person, a list that is not a list, and more than 200 jobs");

/* ---------------------------------------------------------------- plans */

const plan = "insert into vppsone.needs_plans (staff_profile_id, session_label, day, signature, item_order, reasons, source) values ($1, 'TEST-2026-27', $2, $3, $4::jsonb, $5::jsonb, $6)";
await db.query(plan, [ME, DAY, "3:a1b2c3d4", JSON.stringify(["marks:l1", "notices"]), JSON.stringify({ "marks:l1": "late" }), "ai"]);
await db.query(plan, [ME, DAY, "3:a1b2c3d4", "[]", "{}", "none"]);
await rejects(plan, [ME, DAY, "s", '{"a":1}', "{}", "ai"], "needs_plans_order_array");
await rejects(plan, [ME, DAY, "s", JSON.stringify(Array.from({ length: 61 }, (_, i) => `k${i}`)), "{}", "ai"], "needs_plans_order_array");
await rejects(plan, [ME, DAY, "s", "[]", "[]", "ai"], "needs_plans_reasons_object");
await rejects(plan, [ME, DAY, "s", "[]", "{}", "claude"], "needs_plans_source_known");
await rejects(plan, [ME, DAY, "", "[]", "{}", "ai"], "needs_plans_signature_sane");
const latest = await db.query("select source from vppsone.needs_plans where staff_profile_id = $1 and session_label = 'TEST-2026-27' and day = $2 order by created_at desc limit 1", [ME, DAY]);
assert.ok(["ai", "none"].includes(latest.rows[0].source));
console.log("PASS: a plan is an ordered list of keys with a reason object, from the AI or marked as nothing usable");

/* --------------------------------------------------------------- grants */

const grants = await db.query(`
  select table_name, grantee, privilege_type from information_schema.role_table_grants
   where table_schema = 'vppsone' and table_name in ('needs_reminders', 'needs_seen', 'needs_plans')
     and grantee in ('anon', 'authenticated', 'public')`);
assert.equal(grants.rows.length, 0, "no table grant to anon, authenticated or public");
const rls = await db.query("select relname, relrowsecurity from pg_class where relname in ('needs_reminders', 'needs_seen', 'needs_plans') order by relname");
assert.deepEqual(rls.rows.map((r) => [r.relname, r.relrowsecurity]), [["needs_plans", true], ["needs_reminders", true], ["needs_seen", true]]);
const execute = await db.query(`
  select grantee from information_schema.role_routine_grants
   where routine_schema = 'vppsone' and routine_name = 'needs_sync' order by grantee`);
assert.deepEqual(execute.rows.map((r) => r.grantee).filter((g) => g !== "postgres"), ["service_role"]);
const definer = await db.query("select prosecdef, proconfig from pg_proc where proname = 'needs_sync'");
assert.equal(definer.rows[0].prosecdef, true);
assert.deepEqual(definer.rows[0].proconfig, ['search_path=""']);
console.log("PASS: row security on, no grant to anon or authenticated, and only the service role runs the sync (search_path pinned)");

await db.close();
