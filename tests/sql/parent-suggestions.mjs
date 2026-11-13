/** In-memory PostgreSQL proof that a parent's message changes nothing until
 * a person applies it (D-598): supabase/migrations/*_parent_suggestions.sql
 * and *_parent_suggestion_undo.sql,
 * with the real record writer, session rule and school day it calls, against
 * synthetic neighbours shaped as One's are (hand-offs, enquiries, the
 * register's notes, the message queue, classes and class teachers, the
 * collected fields and the fee app's students). No URL, credentials or
 * hosted database accepted: pass a local installed @electric-sql/pglite
 * directory (CI installs it in a disposable folder). Every name and number
 * here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const one = (suffix) => {
  const found = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(found.length, 1, `one ${suffix} migration`);
  return readFileSync(join(migrations, found[0]), "utf8");
};
/** One function's definition, exactly as a migration wrote it. */
const fn = (sql, name) => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, `${name} is defined`);
  const body = sql.indexOf("$$", start);
  const end = sql.indexOf("$$;", body + 2);
  return `${sql.slice(start, end + 3)}\n`;
};

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create type vppsone.record_source as enum ('teacher', 'office', 'import');
create table vppsone.staff_profiles (
  id uuid primary key,
  role text not null,
  is_active boolean not null default true,
  is_test_account boolean not null default false
);
create table vppsone.role_permissions (role text not null, permission text not null, primary key (role, permission));
create table vppsone.class_teachers (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null,
  session_label text not null,
  staff_profile_id uuid not null references vppsone.staff_profiles(id),
  role text not null default 'class_teacher',
  effective_from date not null default current_date,
  effective_to date
);
create table vppsone.enrolments (
  student_id uuid not null,
  class_id uuid not null,
  session_label text not null,
  status text not null default 'enrolled'
);
create table vppsone.parent_replies (
  id uuid primary key,
  from_name text not null default 'Parent',
  from_phone text not null default '+919000000001'
);
create table vppsone.enquiries (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  stage text not null default 'enquiry',
  child_name text not null,
  class_label text,
  parent_name text,
  phone text,
  student_id uuid,
  created_by uuid references vppsone.staff_profiles(id),
  stage_changed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  visit_on date,
  visit_part text,
  source text not null default 'office',
  parent_reply_id uuid references vppsone.parent_replies(id) on delete set null,
  constraint enquiries_name check (length(btrim(child_name)) between 1 and 120),
  constraint enquiries_visit_whole check ((visit_on is null) = (visit_part is null)),
  constraint enquiries_one_per_handoff unique (parent_reply_id)
);
create table vppsone.parent_message_queue (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  kind text not null,
  student_id uuid not null,
  day date,
  status text not null default 'queued',
  cancelled_at timestamptz,
  cancelled_by uuid references vppsone.staff_profiles(id)
);
create table vppsone.collection_fields (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  fee_column text,
  is_active boolean not null default true
);
create table vppsone.student_records (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  student_id uuid not null,
  field_id uuid not null references vppsone.collection_fields(id),
  value text,
  source vppsone.record_source not null default 'teacher',
  source_submission_id uuid,
  recorded_by uuid,
  source_detail text,
  source_ref text,
  updated_at timestamptz not null default now()
);
create unique index student_records_unique on vppsone.student_records (student_id, field_id);
create table vppsone.student_record_history (
  id bigint generated always as identity primary key,
  student_id uuid not null,
  field_id uuid not null,
  session_label text not null,
  outcome text not null,
  reason text,
  old_value text,
  new_value text,
  old_source vppsone.record_source,
  old_source_detail text,
  source vppsone.record_source not null,
  source_detail text,
  source_ref text,
  submission_id uuid,
  command_id uuid not null,
  actor_staff_id uuid,
  recorded_at timestamptz not null default now()
);
create table public.students (id uuid primary key, guardian_phone text, date_of_birth text, address text);
-- As on Supabase: every role may look in the schema; the grants decide the rest.
grant usage on schema vppsone to anon, authenticated, service_role;
`);
await db.exec(fn(one("_deployment_marker.sql"), "vppsone.is_test_session_label"));
await db.exec(fn(one("_staff_authority_and_scoped_reads.sql"), "vppsone.school_today"));
await db.exec(fn(one("_staff_session_match.sql"), "vppsone.staff_matches_session"));
await db.exec(fn(one("_record_writer_and_history.sql"), "vppsone.write_student_value"));
await db.exec(one("_parent_absence_notes.sql"));
await db.exec(one("_parent_suggestions.sql"));
await db.exec(one("_parent_suggestion_undo.sql"));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SESSION = "TEST-2026-27";
const REAL = "2026-27";
const CLASS = id(10);
const LONELY = id(11); // a class with no class teacher
const ASHA = id(1);
const DEV = id(2); // in the lonely class
const RIYA = id(3); // in a real-session class taught by real staff
const TEACHER = id(20); // test account, Asha's class teacher
const OTHER_TEACHER = id(21); // test account, another class
const OFFICE = id(22); // test account, office
const ADMIN = id(23); // test account, admin
const REAL_ADMIN = id(24);
const REAL_TEACHER = id(25);
const COORD = id(26); // test account, academic coordinator (attendance only)
const REPLIES = Array.from({ length: 20 }, (_, n) => id(100 + n));
const PHONE = id(50);
const DOB = id(51);
const BLOOD = id(52);
const TRANSPORT = id(53);

await db.exec(`
insert into vppsone.staff_profiles (id, role, is_test_account) values
  ('${TEACHER}', 'teacher', true), ('${OTHER_TEACHER}', 'teacher', true), ('${OFFICE}', 'office', true),
  ('${ADMIN}', 'admin', true), ('${REAL_ADMIN}', 'admin', false), ('${REAL_TEACHER}', 'teacher', false),
  ('${COORD}', 'academic_coordinator', true);
insert into vppsone.role_permissions (role, permission) values
  ('teacher', 'attendance:mark'),
  ('office', 'attendance:correct'), ('office', 'collection:manage'),
  ('academic_coordinator', 'attendance:correct'),
  ('admin', 'attendance:mark'), ('admin', 'attendance:correct'), ('admin', 'collection:manage'), ('admin', 'fees:manage');
insert into vppsone.class_teachers (class_id, session_label, staff_profile_id, effective_from) values
  ('${CLASS}', '${SESSION}', '${TEACHER}', current_date - 30),
  ('${id(12)}', '${SESSION}', '${OTHER_TEACHER}', current_date - 30),
  ('${id(13)}', '${SESSION}', '${REAL_TEACHER}', current_date - 30);
insert into vppsone.enrolments (student_id, class_id, session_label) values
  ('${ASHA}', '${CLASS}', '${SESSION}'), ('${DEV}', '${LONELY}', '${SESSION}'), ('${RIYA}', '${id(13)}', '${SESSION}');
insert into vppsone.parent_replies (id, from_name, from_phone)
  select r, 'Test Parent', '+919000000001' from unnest(array[${REPLIES.map((r) => `'${r}'::uuid`).join(", ")}]) r;
update vppsone.parent_replies set from_name = 'Parent' where id = '${REPLIES[9]}';
insert into vppsone.collection_fields (id, key, fee_column, is_active) values
  ('${PHONE}', 'guardian_phone', 'guardian_phone', true), ('${DOB}', 'date_of_birth', 'date_of_birth', true),
  ('${BLOOD}', 'blood_group', null, true), ('${TRANSPORT}', 'mother_phone', null, false);
insert into public.students (id, guardian_phone, date_of_birth) values ('${ASHA}', '9000000002', '2016-04-01'), ('${DEV}', null, null);
`);

const one1 = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows.map((row) => ({ ...row }));
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};
const india = (offsetDays = 0) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const TODAY = india(0);
const TOMORROW = india(1);
const LATER = india(2);
const YESTERDAY = india(-1);
const add = async (input) => (await one1("select vppsone.add_parent_suggestion($1::jsonb) as id", [JSON.stringify(input)])).id;
const decide = async (input) => (await one1("select vppsone.decide_parent_suggestions($1::jsonb) as r", [JSON.stringify(input)])).r;
const undo = async (input) => (await one1("select vppsone.undo_parent_suggestion($1::jsonb) as r", [JSON.stringify(input)])).r;
const row = (sid) => one1("select * from vppsone.parent_suggestions where id = $1", [sid]);
const absence = (student, reply, days, reason = "sick") => ({ kind: "absence", session_label: SESSION, student_id: student, parent_reply_id: reply, practice: true, payload: { days, reason } });

/* ----------------------------------------------------------- adding */

const a1 = await add(absence(ASHA, REPLIES[0], [TOMORROW, TODAY, TODAY]));
let r = await row(a1);
assert.equal(r.route, "class_teacher");
assert.equal(r.assigned_staff_id, TEACHER);
assert.equal(r.class_id, CLASS);
assert.equal(r.status, "pending");
assert.deepEqual(r.payload, { days: [TODAY, TOMORROW], reason: "sick" });
const lastDayEnds = await one1(`select ((($1::date) + 1)::timestamp at time zone 'Asia/Kolkata') as t`, [TOMORROW]);
assert.equal(new Date(r.expires_at).getTime(), new Date(lastDayEnds.t).getTime());
console.log("PASS: an absence waits for the child's class teacher, its days sorted once, until the end of its last day in India");

assert.equal(await add(absence(ASHA, REPLIES[0], [LATER])), a1);
assert.equal(await add(absence(ASHA, REPLIES[1], [TOMORROW])), a1);
const a2 = await add(absence(ASHA, REPLIES[2], [TOMORROW, LATER], "other"));
assert.notEqual(a2, a1);
console.log("PASS: one per hand-off, days already waiting add nothing, and a longer span is its own");

const d1 = await add(absence(DEV, REPLIES[3], [TODAY], "other"));
r = await row(d1);
assert.equal(r.route, "office");
assert.equal(r.assigned_staff_id, null);
const r1 = await add(absence(RIYA, REPLIES[4], [TODAY]));
assert.equal((await row(r1)).route, "office", "a real teacher is not given a test session's note");
assert.equal(await add(absence(ASHA, REPLIES[5], [YESTERDAY])), null, "a day gone waits for nobody");
console.log("PASS: no class teacher (or one of the other kind) means the office; a day gone is not asked");

const v1 = await add({ kind: "visit", session_label: SESSION, parent_reply_id: REPLIES[6], payload: { day: TOMORROW, part: "morning", child_name: "  Mira Test ", class_label: "Class 3", words: "ignored" } });
r = await row(v1);
assert.equal(r.route, "office");
assert.equal(r.student_id, null);
assert.deepEqual(r.payload, { day: TOMORROW, part: "morning", child_name: "Mira Test", class_label: "Class 3" });
const v2 = await add({ kind: "visit", session_label: SESSION, parent_reply_id: REPLIES[9], payload: { day: LATER, part: "afternoon", child_name: "-", class_label: "" } });
assert.equal((await row(v2)).payload.class_label, null);
console.log("PASS: a visit waits for the office, with only the day, part, child and class kept");

const c1 = await add({ kind: "record", session_label: SESSION, student_id: ASHA, parent_reply_id: REPLIES[7], payload: { field: "guardian_phone", value: " 9000000003 " } });
r = await row(c1);
assert.equal(r.route, "office");
assert.deepEqual(r.payload, { field: "guardian_phone", value: "9000000003", was: "9000000002" });
assert.equal(Math.round((new Date(r.expires_at) - Date.now()) / 86_400_000), 7);
assert.equal(await add({ kind: "record", session_label: SESSION, student_id: ASHA, parent_reply_id: REPLIES[8], payload: { field: "guardian_phone", value: "9000000003" } }), c1);
assert.equal(await add({ kind: "record", session_label: SESSION, student_id: ASHA, payload: { field: "guardian_phone", value: "9000000002" } }), null, "the value the school holds");
assert.equal(await add({ kind: "record", session_label: SESSION, student_id: ASHA, payload: { field: "mother_phone", value: "9000000004" } }), null, "a field not collected");
const b1 = await add({ kind: "record", session_label: SESSION, student_id: DEV, payload: { field: "blood_group", value: "B+" } });
assert.equal((await row(b1)).payload.was, null);
console.log("PASS: a record change shows what the school holds now (One's value, else the fee app's), for seven days; the same value or an uncollected field asks nothing");

for (const bad of [
  { kind: "absence", session_label: SESSION, student_id: ASHA, payload: { days: [], reason: "sick" } },
  { kind: "absence", session_label: SESSION, student_id: ASHA, payload: { days: Array.from({ length: 8 }, () => TOMORROW), reason: "sick" } },
  { kind: "absence", session_label: SESSION, student_id: ASHA, payload: { days: [TOMORROW], reason: "wedding" } },
  { kind: "absence", session_label: SESSION, payload: { days: [TOMORROW], reason: "sick" } },
  { kind: "visit", session_label: SESSION, payload: { day: TOMORROW, part: "evening", child_name: "Mira Test" } },
  { kind: "visit", session_label: SESSION, payload: { day: TOMORROW, part: "morning", child_name: " " } },
  { kind: "record", session_label: SESSION, student_id: ASHA, payload: { field: "aadhaar", value: "1234" } },
  { kind: "transfer", session_label: SESSION, student_id: ASHA, payload: {} },
  { kind: "absence", session_label: "X", student_id: ASHA, payload: { days: [TOMORROW], reason: "sick" } },
]) {
  await assert.rejects(add(bad), /parent_suggestion|invalid|null/, JSON.stringify(bad));
}
const insert = `insert into vppsone.parent_suggestions (kind, session_label, student_id, route, payload, expires_at) values ($1, '${SESSION}', $2, 'office', $3::jsonb, now() + interval '1 day')`;
await rejects(insert, ["absence", ASHA, JSON.stringify({ days: [TOMORROW], reason: "sick", words: "Asha is ill" })], "parent_suggestions_payload_ok");
await rejects(insert, ["record", ASHA, JSON.stringify({ field: "guardian_phone", value: "x".repeat(201) })], "parent_suggestions_payload_ok");
await rejects(insert, ["visit", ASHA, JSON.stringify({ day: TOMORROW, part: "morning", child_name: "Mira Test" })], "parent_suggestions_child_known");
await rejects(insert, ["absence", null, JSON.stringify({ days: [TOMORROW], reason: "sick" })], "parent_suggestions_child_known");
await rejects(
  `insert into vppsone.parent_suggestions (kind, session_label, student_id, route, payload, expires_at, status) values ('absence', '${SESSION}', $1, 'office', $2::jsonb, now(), 'applied')`,
  [ASHA, JSON.stringify({ days: [TOMORROW], reason: "sick" })],
  "parent_suggestions_decided_whole",
);
console.log("PASS: a bad kind, payload, session or child is refused, by the function and by the table");

/* ----------------------------------------------------------- who decides */

const may = async (actor, kind, session, klass) =>
  (await one1("select vppsone.parent_suggestion_may_decide($1, $2, $3, $4) as ok", [actor, kind, session, klass])).ok;
assert.equal(await may(TEACHER, "absence", SESSION, CLASS), true);
assert.equal(await may(OTHER_TEACHER, "absence", SESSION, CLASS), false);
assert.equal(await may(TEACHER, "record", SESSION, CLASS), false);
assert.equal(await may(TEACHER, "visit", SESSION, null), false);
assert.equal(await may(OFFICE, "absence", SESSION, LONELY), true);
assert.equal(await may(OFFICE, "record", SESSION, CLASS), true);
assert.equal(await may(OFFICE, "visit", SESSION, null), true);
assert.equal(await may(COORD, "absence", SESSION, CLASS), true);
assert.equal(await may(COORD, "visit", SESSION, null), false);
assert.equal(await may(ADMIN, "record", SESSION, null), true);
assert.equal(await may(REAL_ADMIN, "absence", SESSION, CLASS), false, "real staff never decide the test session");
assert.equal(await may(ADMIN, "absence", REAL, CLASS), false, "a test account never decides the real year");
await db.query("update vppsone.class_teachers set effective_to = current_date - 1 where staff_profile_id = $1", [TEACHER]);
assert.equal(await may(TEACHER, "absence", SESSION, CLASS), false, "a former class teacher");
await db.query("update vppsone.class_teachers set effective_to = null where staff_profile_id = $1", [TEACHER]);
await db.query("update vppsone.staff_profiles set is_active = false where id = $1", [OFFICE]);
assert.equal(await may(OFFICE, "record", SESSION, CLASS), false, "an inactive account");
await db.query("update vppsone.staff_profiles set is_active = true where id = $1", [OFFICE]);
console.log("PASS: the class teacher, attendance correctors, the office, the fee desk and the admin, each for their kind, and only of the session's own kind");

/* ----------------------------------------------------------- deciding */

await db.query("insert into vppsone.parent_message_queue (session_label, kind, student_id, day) values ($1, 'absent_alert', $2, $3), ($1, 'absent_alert', $2, $4), ($1, 'note', $2, $3)", [SESSION, ASHA, TODAY, YESTERDAY]);
let out = await decide({ actor_staff_id: OTHER_TEACHER, ids: [a1], decision: "apply" });
assert.equal(out.results[0].outcome, "not_permitted");
assert.equal((await row(a1)).status, "pending");
assert.equal((await one1("select count(*)::int n from vppsone.parent_absence_notes")).n, 0);
console.log("PASS: nothing is written for someone who may not decide it");

out = await decide({ actor_staff_id: TEACHER, ids: [a1], decision: "apply", mark: "leave", via: "teacher_home" });
assert.equal(out.ok, true);
assert.equal(out.applied, 1);
assert.deepEqual({ ...out.results[0], id: undefined }, { id: undefined, outcome: "applied", kind: "absence", mark: "leave", noted: 2, alerts_stopped: 1 });
const notes = await all("select day::text, reason, mark, suggestion_id, practice from vppsone.parent_absence_notes where student_id = $1 order by day", [ASHA]);
assert.deepEqual(notes, [
  { day: TODAY, reason: "sick", mark: "leave", suggestion_id: a1, practice: true },
  { day: TOMORROW, reason: "sick", mark: "leave", suggestion_id: a1, practice: true },
]);
const queue = await all("select kind, day::text, status, cancelled_by from vppsone.parent_message_queue order by kind, day");
assert.deepEqual(queue, [
  { kind: "absent_alert", day: YESTERDAY, status: "queued", cancelled_by: null },
  { kind: "absent_alert", day: TODAY, status: "cancelled", cancelled_by: TEACHER },
  { kind: "note", day: TODAY, status: "queued", cancelled_by: null },
]);
r = await row(a1);
assert.equal(r.status, "applied");
assert.equal(r.decided_by, TEACHER);
assert.equal(r.decided_via, "teacher_home");
console.log("PASS: applying an absence notes each day with the mark chosen, stops that day's queued absent alert, and says who decided");

out = await decide({ actor_staff_id: ADMIN, ids: [a2], decision: "apply", mark: "absent" });
assert.equal(out.results[0].noted, 1, "the day already noted keeps its note");
assert.deepEqual(await all("select day::text, mark from vppsone.parent_absence_notes where suggestion_id = $1", [a2]), [{ day: LATER, mark: "absent" }]);
out = await decide({ actor_staff_id: TEACHER, ids: [a1], decision: "dismiss" });
assert.equal(out.results[0].outcome, "already");
assert.equal(out.results[0].decided_by, TEACHER);
console.log("PASS: a day another note covers keeps it, and a decided suggestion answers who decided it");

// Several at once: one may fail (the hand-off is gone) and the others still go.
await db.query("update vppsone.parent_suggestions set parent_reply_id = null where id = $1", [v2]);
await db.query("delete from vppsone.parent_replies where id = $1", [REPLIES[9]]);
const ghost = id(999);
out = await decide({ actor_staff_id: OFFICE, ids: [v1, v2, d1, r1, ghost], decision: "apply", mark: "absent" });
const by = Object.fromEntries(out.results.map((x) => [x.id, x]));
assert.equal(by[v1].outcome, "applied");
assert.equal(by[v1].created, true);
assert.equal(by[v2].outcome, "failed");
assert.equal(by[v2].reason, "handoff_gone");
assert.equal(by[d1].outcome, "applied");
assert.equal(by[r1].outcome, "applied");
assert.equal(by[ghost].outcome, "not_found");
assert.equal((await row(v2)).status, "pending");
const enquiry = await one1("select session_label, stage, child_name, class_label, parent_name, phone, source, visit_on::text, visit_part, created_by from vppsone.enquiries where parent_reply_id = $1", [REPLIES[6]]);
assert.deepEqual({ ...enquiry }, { session_label: SESSION, stage: "enquiry", child_name: "Mira Test", class_label: "Class 3", parent_name: "Test Parent", phone: "9000000001", source: "whatsapp", visit_on: TOMORROW, visit_part: "morning", created_by: OFFICE });
console.log("PASS: applying several answers each on its own: the visit is on the Admissions board as the office member's, a lost hand-off fails alone");

await db.query("update vppsone.parent_replies set from_name = 'Parent' where id = $1", [REPLIES[10]]);
const v3 = await add({ kind: "visit", session_label: SESSION, parent_reply_id: REPLIES[10], payload: { day: TOMORROW, part: "afternoon", child_name: "Kabir Test" } });
await decide({ actor_staff_id: ADMIN, ids: [v3], decision: "apply" });
assert.equal((await one1("select parent_name from vppsone.enquiries where parent_reply_id = $1", [REPLIES[10]])).parent_name, null, "WhatsApp's stand-in name is not a name");
const v4 = await add({ kind: "visit", session_label: SESSION, parent_reply_id: REPLIES[11], payload: { day: TOMORROW, part: "morning", child_name: "Ira Test" } });
assert.equal((await decide({ actor_staff_id: TEACHER, ids: [v4], decision: "apply" })).results[0].outcome, "not_permitted");
console.log("PASS: a teacher cannot put a visit on the board, and \"Parent\" is no name");

out = await decide({ actor_staff_id: OFFICE, ids: [c1], decision: "apply" });
assert.equal(out.results[0].write, "written");
assert.equal(out.results[0].previous, "9000000002");
assert.equal(out.results[0].had_record, false);
let held = await one1("select value, source::text, source_detail, source_ref, recorded_by from vppsone.student_records where student_id = $1 and field_id = $2", [ASHA, PHONE]);
assert.deepEqual({ ...held }, { value: "9000000003", source: "office", source_detail: "whatsapp_parent", source_ref: `parent_suggestion:${c1}`, recorded_by: OFFICE });
assert.equal((await one1("select guardian_phone from public.students where id = $1", [ASHA])).guardian_phone, "9000000002", "the fee app is never written");
assert.equal((await one1("select count(*)::int n from vppsone.student_record_history where source_ref = $1 and outcome = 'written' and actor_staff_id = $2", [`parent_suggestion:${c1}`, OFFICE])).n, 1);
console.log("PASS: applying a record change writes One's record through its one writer, as the office member, with history; the fee app is untouched");

// Not now, then expiry, then the batch's limits.
const c2 = await add({ kind: "record", session_label: SESSION, student_id: ASHA, payload: { field: "date_of_birth", value: "2016-05-01" } });
out = await decide({ actor_staff_id: OFFICE, ids: [c2], decision: "dismiss", via: "needs_you" });
assert.equal(out.dismissed, 1);
r = await row(c2);
assert.equal(r.status, "dismissed");
assert.equal(r.decided_by, OFFICE);
assert.equal((await one1("select count(*)::int n from vppsone.student_records where field_id = $1", [DOB])).n, 0, "Not now writes nothing");
await db.query("update vppsone.parent_suggestions set expires_at = now() - interval '1 minute' where id = $1", [v4]);
assert.equal((await decide({ actor_staff_id: ADMIN, ids: [v4], decision: "apply" })).results[0].outcome, "expired");
assert.equal((await decide({ actor_staff_id: ADMIN, ids: [], decision: "apply" })).reason, "bad_request");
assert.equal((await decide({ actor_staff_id: ADMIN, ids: [v4], decision: "approve" })).reason, "bad_request");
assert.equal((await decide({ actor_staff_id: ADMIN, ids: [v4], decision: "apply", mark: "late" })).reason, "bad_request");
assert.equal((await decide({ actor_staff_id: ADMIN, ids: ["nope"], decision: "apply" })).reason, "bad_request");
assert.equal((await decide({ actor_staff_id: ADMIN, ids: Array.from({ length: 201 }, (_, n) => id(5000 + n)), decision: "apply" })).reason, "bad_request");
assert.equal((await decide({ actor_staff_id: id(777), ids: [v4], decision: "apply" })).reason, "not_permitted");
console.log("PASS: Not now writes nothing and says who; an expired one is not applied; a bad batch is refused whole");

/* ----------------------------------------------------------- taking it back */

out = await undo({ actor_staff_id: OTHER_TEACHER, id: a1 });
assert.equal(out.reason, "not_permitted");
out = await undo({ actor_staff_id: TEACHER, id: a1 });
assert.deepEqual({ ...out }, { ok: true, status: "pending", was: "applied", taken_back: 2 });
const register = "select count(*)::int n from vppsone.parent_absence_notes where student_id = $1 and day in ($2::date, $3::date) and withdrawn_at is null";
assert.equal((await one1(register, [ASHA, TODAY, TOMORROW])).n, 0, "the register no longer reads them");
assert.deepEqual(
  await all("select day::text, withdrawn_by, withdrawn_at is not null as withdrawn from vppsone.parent_absence_notes where suggestion_id = $1 order by day", [a1]),
  [{ day: TODAY, withdrawn_by: TEACHER, withdrawn: true }, { day: TOMORROW, withdrawn_by: TEACHER, withdrawn: true }],
  "kept, saying who took them back",
);
assert.equal((await one1("select count(*)::int n from vppsone.parent_absence_notes where suggestion_id = $1 and withdrawn_at is null", [a2])).n, 1, "another suggestion's day stays");
r = await row(a1);
assert.equal(r.status, "pending");
assert.equal(r.decided_by, null);
assert.equal(r.undone_by, TEACHER);
out = await decide({ actor_staff_id: TEACHER, ids: [a1], decision: "apply", mark: "absent" });
assert.equal(out.results[0].noted, 2);
assert.deepEqual(
  await all("select day::text, mark, withdrawn_at, withdrawn_by from vppsone.parent_absence_notes where suggestion_id = $1 order by day", [a1]),
  [{ day: TODAY, mark: "absent", withdrawn_at: null, withdrawn_by: null }, { day: TOMORROW, mark: "absent", withdrawn_at: null, withdrawn_by: null }],
);
assert.equal((await one1(register, [ASHA, TODAY, TOMORROW])).n, 2);
assert.equal((await one1("select count(*)::int n from vppsone.parent_absence_notes where student_id = $1", [ASHA])).n, 3, "brought back, never doubled");
await assert.rejects(
  db.query("update vppsone.parent_absence_notes set withdrawn_by = $1 where suggestion_id = $2", [TEACHER, a1]),
  /parent_absence_notes_withdrawn_says_when/,
);
console.log("PASS: Undo withdraws the register's notes and keeps them, and the note waits again; applying it afresh (as Absent this time) brings the same days back");

out = await undo({ actor_staff_id: OFFICE, id: c1 });
assert.equal(out.ok, true);
assert.equal(out.taken_back, 1);
held = await one1("select value, source::text, source_ref from vppsone.student_records where student_id = $1 and field_id = $2", [ASHA, PHONE]);
assert.deepEqual({ ...held }, { value: null, source: "office", source_ref: `parent_suggestion:${c1}:undo` }, "One holds no value of its own, so the fee app's value shows again");
assert.equal((await one1("select count(*)::int n from vppsone.student_record_history where outcome = 'written' and old_value = '9000000003' and new_value is null and source_ref = $1 and actor_staff_id = $2", [`parent_suggestion:${c1}:undo`, OFFICE])).n, 1);
const again = await add({ kind: "record", session_label: SESSION, student_id: ASHA, payload: { field: "guardian_phone", value: "9000000005" } });
assert.equal((await row(again)).payload.was, "9000000002", "the school holds the fee app's value again");
await db.query("insert into vppsone.student_records (session_label, student_id, field_id, value, source) values ($1, $2, $3, 'O+', 'teacher')", [SESSION, DEV, BLOOD]);
const b2 = await add({ kind: "record", session_label: SESSION, student_id: DEV, payload: { field: "blood_group", value: "AB+" } });
assert.equal((await row(b2)).payload.was, "O+");
await decide({ actor_staff_id: OFFICE, ids: [b2], decision: "apply" });
assert.equal((await one1("select value from vppsone.student_records where student_id = $1 and field_id = $2", [DEV, BLOOD])).value, "AB+");
out = await undo({ actor_staff_id: ADMIN, id: b2 });
assert.equal(out.ok, true);
held = await one1("select value, source::text, source_ref from vppsone.student_records where student_id = $1 and field_id = $2", [DEV, BLOOD]);
assert.deepEqual({ ...held }, { value: "O+", source: "office", source_ref: `parent_suggestion:${b2}:undo` });
await decide({ actor_staff_id: OFFICE, ids: [b2], decision: "apply" });
await db.query("update vppsone.student_records set value = 'A+', source_ref = 'submission:other' where student_id = $1 and field_id = $2", [DEV, BLOOD]);
assert.equal((await undo({ actor_staff_id: OFFICE, id: b2 })).reason, "record_moved");
assert.equal((await one1("select value from vppsone.student_records where student_id = $1 and field_id = $2", [DEV, BLOOD])).value, "A+", "a value written since stays");
console.log("PASS: Undo puts a record back (or lets the fee app's value show), and never over a value somebody wrote since");

const enquiryOf = (reply) => one1("select id, stage, created_by from vppsone.enquiries where parent_reply_id = $1", [reply]);
const firstEnquiry = await enquiryOf(REPLIES[6]);
out = await undo({ actor_staff_id: OFFICE, id: v1 });
assert.equal(out.ok, true);
assert.equal(out.taken_back, 1);
assert.deepEqual({ ...(await enquiryOf(REPLIES[6])) }, { id: firstEnquiry.id, stage: "closed", created_by: OFFICE }, "closed and kept");
out = await decide({ actor_staff_id: ADMIN, ids: [v1], decision: "apply" });
assert.equal(out.results[0].created, true);
assert.equal(out.results[0].enquiry_id, firstEnquiry.id);
assert.deepEqual({ ...(await enquiryOf(REPLIES[6])) }, { id: firstEnquiry.id, stage: "enquiry", created_by: OFFICE }, "the same enquiry, open again");
assert.equal((await one1("select count(*)::int n from vppsone.enquiries where parent_reply_id = $1", [REPLIES[6]])).n, 1);
await db.query("update vppsone.enquiries set stage = 'visited' where parent_reply_id = $1", [REPLIES[6]]);
assert.equal((await undo({ actor_staff_id: OFFICE, id: v1 })).reason, "enquiry_moved");
assert.equal((await row(v1)).status, "applied");
assert.equal((await enquiryOf(REPLIES[6])).stage, "visited");
console.log("PASS: Undo closes an untouched enquiry and keeps it, applying again opens the same one, and one the office has started on stays as it is");

out = await undo({ actor_staff_id: OFFICE, id: c2 });
assert.deepEqual({ ...out }, { ok: true, status: "pending", was: "dismissed", taken_back: 0 });
await decide({ actor_staff_id: OFFICE, ids: [c2], decision: "dismiss" });
await db.query("update vppsone.parent_suggestions set expires_at = now() - interval '1 minute' where id = $1", [c2]);
out = await undo({ actor_staff_id: OFFICE, id: c2 });
assert.equal(out.status, "undone", "a decision taken back after its time waits no longer");
r = await row(c2);
assert.equal(r.decided_at, null);
assert.equal(r.undone_by, OFFICE);
assert.equal((await undo({ actor_staff_id: OFFICE, id: c2 })).reason, "not_decided");
assert.equal((await undo({ actor_staff_id: OFFICE, id: ghost })).reason, "not_found");
console.log("PASS: Not now can be taken back too; after its time it stays closed, and a closed one has nothing to undo");

/* ----------------------------------------------------------- reach */

for (const role of ["anon", "authenticated"]) {
  await db.exec(`set role ${role}`);
  await assert.rejects(db.query("select count(*) from vppsone.parent_suggestions"), /permission denied for table parent_suggestions/, role);
  for (const call of [
    "select vppsone.add_parent_suggestion('{}'::jsonb)",
    "select vppsone.decide_parent_suggestions('{}'::jsonb)",
    "select vppsone.undo_parent_suggestion('{}'::jsonb)",
  ]) {
    await assert.rejects(db.query(call), /permission denied for function/, `${role}: ${call}`);
  }
  await db.exec("reset role");
}
// The server's role is the one that may: the helper adds, the app decides.
await db.exec("set role service_role");
const served = await add(absence(DEV, REPLIES[12], [LATER]));
assert.ok(served);
assert.equal((await decide({ actor_staff_id: OFFICE, ids: [served], decision: "dismiss" })).dismissed, 1);
await db.exec("reset role");
const columns = (await all("select column_name from information_schema.columns where table_schema = 'vppsone' and table_name = 'parent_suggestions'")).map((c) => c.column_name);
assert.ok(!columns.some((name) => /words|body|message|text|phone/.test(name)), "no column for the parent's words or number");
console.log("PASS: nobody signed in reaches the table or the three functions, the server role does, and nothing holds the parent's words");
