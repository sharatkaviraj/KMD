/** In-memory PostgreSQL proof of "teach it once" (D-589, D-590):
 * supabase/migrations/*_parent_helper_lessons.sql against synthetic staff,
 * Messages and turn tables. No URL, credentials or hosted database accepted:
 * pass a local installed @electric-sql/pglite directory (CI installs it in a
 * disposable folder). Every question here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const found = readdirSync(migrations).filter((name) => name.endsWith("_parent_helper_lessons.sql"));
assert.equal(found.length, 1, "one _parent_helper_lessons.sql migration");

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.staff_profiles(id uuid primary key);
create table vppsone.parent_replies(id uuid primary key);
create table vppsone.parent_helper_turns(
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  received_at timestamptz not null default now()
);
insert into vppsone.parent_helper_turns(provider_message_id) values ('wamid.before-1'), ('wamid.before-2');
`);
await db.exec(readFileSync(join(migrations, found[0]), "utf8"));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ADMIN = id(1);
await db.query("insert into vppsone.staff_profiles(id) values ($1)", [ADMIN]);
const note = async (practice, role, lessonId, question, fingerprint, topic = "calendar") =>
  (await db.query("select vppsone.parent_helper_note_lesson($1, $2, $3, $4, $5, $6) as id", [practice, role, lessonId, question, fingerprint, topic])).rows[0].id;
const lesson = async (lessonId) => (await db.query("select * from vppsone.parent_helper_lessons where id = $1", [lessonId])).rows[0];
const count = async (where = "true") => (await db.query(`select count(*)::int n from vppsone.parent_helper_lessons where ${where}`)).rows[0].n;
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};

// Asked for the first time: listed, waiting. The same words again: the same row, counted.
const WINTER = "winter school timings";
const first = await note(true, "asked", null, "What are the winter school timings?", WINTER);
assert.ok(first);
assert.equal((await lesson(first)).status, "waiting");
assert.equal((await lesson(first)).asked_count, 1);
assert.equal(await note(true, "asked", null, "What are the winter school timings ?", WINTER), first);
assert.equal((await lesson(first)).asked_count, 2);
assert.equal((await lesson(first)).question, "What are the winter school timings?", "the first wording stands");
console.log("PASS: a new question is listed once, and asking it again counts on the same row");

// The helper names the open row it repeats, in other words.
assert.equal(await note(true, "asked", first, "When does school start in winter?", "when does school start in winter"), first);
assert.equal((await lesson(first)).asked_count, 3);
assert.equal(await count(), 1);
console.log("PASS: a question the helper names as the same as an open one is counted there, not listed again");

// The practice family's questions and real families' are separate lists.
const real = await note(false, "asked", null, "What are the winter school timings?", WINTER);
assert.notEqual(real, first);
assert.equal(await note(false, "asked", first, "x", null), null, "a practice row is never counted for a real chat");
assert.equal((await lesson(first)).asked_count, 3);
console.log("PASS: practice and real questions are kept apart, both ways");

// Answered: the helper's answers from it are counted; a 'used' for an unanswered row changes nothing.
assert.equal(await note(true, "used", first, null, null), null, "not answered yet");
await db.query(
  "update vppsone.parent_helper_lessons set status = 'answered', answer = 'From 1 November, 9 am to 3 pm.', answered_by = $2, answered_at = now() where id = $1",
  [first, ADMIN],
);
assert.equal(await note(true, "used", first, null, null), first);
assert.equal(await note(true, "used", first, null, null), first);
assert.equal((await lesson(first)).used_count, 2);
assert.ok((await lesson(first)).last_used_at);
assert.equal(await note(false, "used", first, null, null), null, "a practice answer is never used for a real chat");
assert.equal((await lesson(first)).used_count, 2);
console.log("PASS: answers given from a school answer are counted, for its own kind of chat only");

// An answered question asked in a way its answer does not cover is listed afresh.
const again = await note(true, "asked", null, "What are the winter school timings?", WINTER);
assert.ok(again);
assert.notEqual(again, first);
assert.equal((await lesson(again)).status, "waiting");
console.log("PASS: an answered question asked again in a way it does not cover is listed afresh");

// A person always answers this one: asked again, it is counted there and not listed.
await db.query("update vppsone.parent_helper_lessons set status = 'by_people', closed_by = $2, closed_at = now() where id = $1", [again, ADMIN]);
assert.equal(await note(true, "asked", null, "What are the winter school timings?", WINTER), again);
assert.equal(await note(true, "asked", again, "Winter timings please", "winter timings please"), again);
assert.equal((await lesson(again)).asked_count, 3);
assert.equal(await count("practice and status = 'waiting'"), 0);
console.log("PASS: a question a person always answers is counted, never listed again");

// Only one open row per question and kind.
await rejects(
  "update vppsone.parent_helper_lessons set status = 'waiting', answer = null where id = $1",
  [first],
  "parent_helper_lessons_open_question",
);
console.log("PASS: an answered row cannot reopen beside an open row with the same words");

// Bad input from the app is refused, not stored.
assert.equal(await note(true, "asked", null, "Hm?", "hm"), null, "too short");
assert.equal(await note(true, "asked", null, "x".repeat(161), "x".repeat(161)), null, "too long");
assert.equal(await note(true, "asked", null, null, null), null, "nothing to list");
assert.equal(await note(true, "shouted", first, null, null), null, "unknown role");
assert.equal(await note(null, "asked", null, "Is there a sports day this year?", "is there a sports day this year"), null, "no kind");
const odd = await note(true, "asked", null, "Is there a sports day this year?", "is there a sports day this year", "Sports Day!");
assert.equal((await lesson(odd)).topic, null, "an odd topic is left out, the question kept");
await rejects("insert into vppsone.parent_helper_lessons (practice, question, fingerprint, status) values (true, 'Is the canteen open?', 'is the canteen open', 'answered')", [], "parent_helper_lessons_answered_has_answer");
await rejects("insert into vppsone.parent_helper_lessons (practice, question, fingerprint, status) values (true, 'Is the canteen open?', 'is the canteen open', 'done')", [], "parent_helper_lessons_status_known");
await rejects("insert into vppsone.parent_helper_lessons (practice, question, fingerprint, answer, status) values (true, 'Is the canteen open?', 'is the canteen open', 'x', 'answered')", [], "parent_helper_lessons_answer_size");
console.log("PASS: short, long, empty and unknown input changes nothing; an answered row always has its answer");

// The turns ledger: every earlier turn was the practice family's; the lesson a turn used or added to.
const before = (await db.query("select bool_and(practice) all_practice, count(*)::int n from vppsone.parent_helper_turns")).rows[0];
assert.deepEqual({ ...before }, { all_practice: true, n: 2 });
await db.query("update vppsone.parent_helper_turns set lesson_id = $1, lesson_role = 'used' where provider_message_id = 'wamid.before-1'", [first]);
await rejects("update vppsone.parent_helper_turns set lesson_role = 'taught' where provider_message_id = 'wamid.before-2'", [], "parent_helper_turns_lesson_role_known");
await db.query("insert into vppsone.parent_helper_turns(provider_message_id, practice) values ('wamid.real-1', false)");
assert.equal((await db.query("select count(*)::int n from vppsone.parent_helper_turns where not practice")).rows[0].n, 1);
console.log("PASS: earlier turns read as practice; a turn names the lesson it used or added to");

// Service role only, behind row-level security; the function too.
const rls = (await db.query("select relrowsecurity from pg_class where oid = 'vppsone.parent_helper_lessons'::regclass")).rows[0].relrowsecurity;
assert.equal(rls, true);
for (const role of ["anon", "authenticated"]) {
  for (const privilege of ["select", "insert", "update", "delete"]) {
    assert.equal((await db.query("select has_table_privilege($1, 'vppsone.parent_helper_lessons', $2) ok", [role, privilege])).rows[0].ok, false, `${role} ${privilege}`);
  }
  assert.equal(
    (await db.query("select has_function_privilege($1, 'vppsone.parent_helper_note_lesson(boolean, text, uuid, text, text, text)', 'execute') ok", [role])).rows[0].ok,
    false,
    `${role} execute`,
  );
}
for (const privilege of ["select", "insert", "update", "delete"]) {
  assert.equal((await db.query("select has_table_privilege('service_role', 'vppsone.parent_helper_lessons', $1) ok", [privilege])).rows[0].ok, true, `service_role ${privilege}`);
}
assert.equal(
  (await db.query("select has_function_privilege('service_role', 'vppsone.parent_helper_note_lesson(boolean, text, uuid, text, text, text)', 'execute') ok")).rows[0].ok,
  true,
);
console.log("PASS: nobody signed in reads or writes the list or calls the function; the service role does");

const columns = (await db.query("select column_name from information_schema.columns where table_schema = 'vppsone' and table_name = 'parent_helper_lessons' order by ordinal_position")).rows.map((row) => row.column_name);
assert.deepEqual(columns, [
  "id", "practice", "question", "fingerprint", "answer", "status", "topic", "asked_count", "first_asked_at", "last_asked_at",
  "used_count", "last_used_at", "answered_by", "answered_at", "closed_by", "closed_at", "created_at", "updated_at",
]);
console.log("PASS: no column for a parent's words, number or child");
