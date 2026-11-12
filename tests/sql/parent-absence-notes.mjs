/** In-memory PostgreSQL proof of sick-day notes (D-588):
 * supabase/migrations/*_parent_absence_notes.sql against a synthetic
 * hand-offs table. No URL, credentials or hosted database accepted: pass a
 * local installed @electric-sql/pglite directory (CI installs it in a
 * disposable folder). Every name and number here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const found = readdirSync(migrations).filter((name) => name.endsWith("_parent_absence_notes.sql"));
assert.equal(found.length, 1, "one _parent_absence_notes.sql migration");

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.parent_replies(id uuid primary key);
`);
await db.exec(readFileSync(join(migrations, found[0]), "utf8"));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CHILD = id(1);
const OTHER = id(2);
const REPLY = id(100);
await db.query("insert into vppsone.parent_replies(id) values ($1)", [REPLY]);
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};

// The write the helper makes: PostgREST's upsert with ignoreDuplicates is
// insert ... on conflict (student_id, day) do nothing.
const keep = `insert into vppsone.parent_absence_notes (student_id, session_label, day, reason, parent_reply_id, practice)
  values ($1, 'TEST-2026-27', $2, $3, $4, true) on conflict (student_id, day) do nothing returning id`;
assert.equal((await db.query(keep, [CHILD, "2026-11-12", "sick", REPLY])).rows.length, 1);
assert.equal((await db.query(keep, [CHILD, "2026-11-13", "sick", REPLY])).rows.length, 1);
assert.equal((await db.query(keep, [CHILD, "2026-11-12", "other", null])).rows.length, 0);
assert.equal((await db.query("select reason from vppsone.parent_absence_notes where student_id = $1 and day = '2026-11-12'", [CHILD])).rows[0].reason, "sick");
console.log("PASS: one row per child per day, and the first note for a day stands");

await rejects(
  "insert into vppsone.parent_absence_notes (student_id, session_label, day, reason) values ($1, 'TEST-2026-27', '2026-11-12', 'other')",
  [CHILD],
  "parent_absence_notes_one_per_day",
);
assert.equal((await db.query(keep, [OTHER, "2026-11-12", "other", null])).rows.length, 1);
console.log("PASS: a second row for the same day is refused; another child's day is its own");

await rejects("insert into vppsone.parent_absence_notes (student_id, session_label, day, reason) values ($1, 'TEST-2026-27', '2026-11-14', 'wedding')", [CHILD], "parent_absence_notes_reason_known");
await rejects("insert into vppsone.parent_absence_notes (student_id, session_label, day, reason) values ($1, 'X', '2026-11-14', 'sick')", [CHILD], "check");
await rejects("insert into vppsone.parent_absence_notes (student_id, session_label, day, reason) values ($1, 'TEST-2026-27', null, 'sick')", [CHILD], "null");
console.log("PASS: the reason is a word (sick or other), and every row has a session and a day");

const columns = (await db.query("select column_name from information_schema.columns where table_schema = 'vppsone' and table_name = 'parent_absence_notes' order by ordinal_position")).rows.map((row) => row.column_name);
assert.deepEqual(columns, ["id", "student_id", "session_label", "day", "reason", "parent_reply_id", "practice", "created_at"]);
console.log("PASS: no column for the parent's words or number");

// The register's read, and the absent alerts' read: one class's children on one day.
const read = await db.query(
  "select student_id, reason from vppsone.parent_absence_notes where session_label = 'TEST-2026-27' and day = '2026-11-12' and student_id = any($1::uuid[]) order by student_id",
  [[CHILD, OTHER, id(3)]],
);
assert.deepEqual(read.rows.map((row) => [row.student_id, row.reason]), [[CHILD, "sick"], [OTHER, "other"]]);
assert.equal((await db.query("select count(*)::int n from vppsone.parent_absence_notes where session_label = '2026-27'")).rows[0].n, 0);
console.log("PASS: the register reads a day's notes for its own children and session only");

// Removing the hand-off from Messages keeps the note.
await db.query("delete from vppsone.parent_replies where id = $1", [REPLY]);
const after = (await db.query("select count(*)::int n, count(parent_reply_id)::int linked from vppsone.parent_absence_notes where student_id = $1", [CHILD])).rows[0];
assert.deepEqual({ ...after }, { n: 2, linked: 0 });
console.log("PASS: the note outlives its hand-off");

// Service role only, behind row-level security.
const rls = (await db.query("select relrowsecurity from pg_class where oid = 'vppsone.parent_absence_notes'::regclass")).rows[0].relrowsecurity;
assert.equal(rls, true);
for (const role of ["anon", "authenticated"]) {
  for (const privilege of ["select", "insert", "update", "delete"]) {
    assert.equal((await db.query("select has_table_privilege($1, 'vppsone.parent_absence_notes', $2) ok", [role, privilege])).rows[0].ok, false, `${role} ${privilege}`);
  }
}
for (const privilege of ["select", "insert", "update", "delete"]) {
  assert.equal((await db.query("select has_table_privilege('service_role', 'vppsone.parent_absence_notes', $1) ok", [privilege])).rows[0].ok, true, `service_role ${privilege}`);
}
console.log("PASS: nobody signed in reads or writes it; the service role does");

const described = (await db.query(
  "select count(*)::int n from pg_description where objoid = 'vppsone.parent_absence_notes'::regclass",
)).rows[0].n;
assert.equal(described, 3);
console.log("PASS: the table, its reason and its hand-off link say what they are for");
