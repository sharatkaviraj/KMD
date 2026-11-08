/** In-memory PostgreSQL proof of supabase/migrations/20261108170533_staff_session_match.sql
 * (D-560, owner 8 Nov 2026: test accounts only in the test session, real staff
 * only in the real year), against a synthetic schema.
 * No URL, credentials or hosted database accepted: pass a local installed
 * @electric-sql/pglite directory (CI installs it in a disposable folder).
 * Proves the predicate, both halves of the notice rule, the row guard on a
 * table carrying its own session and on one reaching it through a parent, and
 * that an unchanged person or session is never re-checked.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migration = (name) => readFile(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8");

const db = new PGlite();
const run = (sql) => db.exec(sql);
const q = async (sql, params) => (await db.query(sql, params)).rows;
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures += 1; };
async function refuses(sql, params, label) {
  try { await db.query(sql, params); ok(false, `${label} (was accepted)`); }
  catch (error) { ok(String(error.message).includes("Test accounts work only in a test session"), `${label} -> ${String(error.message).slice(0, 80)}`); }
}
async function accepts(sql, params, label) {
  try { await db.query(sql, params); ok(true, label); }
  catch (error) { ok(false, `${label} -> ${String(error.message).slice(0, 120)}`); }
}

const REAL = "00000000-0000-4000-8000-000000000001";
const REAL2 = "00000000-0000-4000-8000-000000000002";
const TEST = "00000000-0000-4000-8000-000000000003";
const GONE = "00000000-0000-4000-8000-000000000004";

await run(`
  create role anon; create role authenticated; create role service_role;
  create schema vppsone;
  create function vppsone.is_test_session_label(p_label text) returns boolean language sql immutable set search_path = ''
    as $$ select coalesce(p_label ~* '^(test|uat|demo)-[0-9]{4}-[0-9]{2}$', false) $$;
  create table vppsone.staff_profiles (id uuid primary key, is_test_account boolean not null default false, is_active boolean not null default true);
  insert into vppsone.staff_profiles (id, is_test_account, is_active) values
    ('${REAL}', false, true), ('${REAL2}', false, true), ('${TEST}', true, true), ('${GONE}', false, false);
  create table vppsone.staff_notices (id uuid primary key default gen_random_uuid(), notice_key text unique, kind text, staff_profile_id uuid,
    session_label text, day date, not_after timestamptz, command_id uuid, payload jsonb, requested_by uuid);
  create table vppsone.class_teachers (id uuid primary key default gen_random_uuid(), class_id uuid, session_label text not null, staff_profile_id uuid not null, note text);
  create table vppsone.teaching_assignments (id uuid primary key default gen_random_uuid(), session_label text, staff_profile_id uuid);
  create table vppsone.staff_scopes (id uuid primary key default gen_random_uuid(), session_label text, staff_profile_id uuid);
  create table vppsone.cover_policies (id uuid primary key default gen_random_uuid(), session_label text, staff_profile_id uuid);
  create table vppsone.teacher_tasks (id uuid primary key default gen_random_uuid(), session_label text, assigned_staff_id uuid);
  create table vppsone.collection_requests (id uuid primary key default gen_random_uuid(), session_label text, assigned_staff_id uuid);
  create table vppsone.timetable_versions (id uuid primary key default gen_random_uuid(), session_label text not null);
  create table vppsone.timetable_slots (id uuid primary key default gen_random_uuid(), version_id uuid references vppsone.timetable_versions(id), staff_profile_id uuid, period int);
  create table vppsone.assessments (id uuid primary key default gen_random_uuid(), session_label text not null);
  create table vppsone.exam_duties (id uuid primary key default gen_random_uuid(), assessment_id uuid, staff_profile_id uuid);
  create table vppsone.exam_marks_links (id uuid primary key default gen_random_uuid(), assessment_id uuid, staff_profile_id uuid);
`);
await run(await migration("20261108170533_staff_session_match.sql"));

// The predicate.
const match = async (staff, label) => (await q("select vppsone.staff_matches_session($1::uuid, $2) m", [staff, label]))[0].m;
ok(await match(REAL, "2026-27") === true, "real staff belong to the real year");
ok(await match(REAL, "TEST-2026-27") === false, "real staff do not belong to TEST");
ok(await match(TEST, "TEST-2026-27") === true, "a test account belongs to TEST");
ok(await match(TEST, "UAT-2026-27") === true, "and to any rehearsal label");
ok(await match(TEST, "2026-27") === false, "a test account does not belong to the real year");
ok(await match(null, "2026-27") === true, "nobody is nothing to refuse");
ok(await match(REAL, null) === true, "no label reads as a real session");

// Notices, both ways.
const queue = async (staff, label) => (await q("select vppsone.queue_staff_notice($1, 'ops_alert', $2::uuid, $3, '{}'::jsonb) id", [`k:${staff}:${label}`, staff, label]))[0].id;
ok(await queue(REAL, "2026-27") !== null, "real staff hear about the real year");
ok(await queue(TEST, "TEST-2026-27") !== null, "a test account hears about TEST");
ok(await queue(TEST, "2026-27") === null, "a test account never hears about the real year");
ok(await queue(REAL, "TEST-2026-27") === null, "real staff never hear about TEST (new half)");
ok(await queue(GONE, "2026-27") === null, "an inactive profile is still skipped");
ok((await q("select count(*)::int n from vppsone.staff_notices"))[0].n === 2, "exactly the two matching notices were written");

// A table carrying its own session.
await accepts(`insert into vppsone.class_teachers (session_label, staff_profile_id) values ('2026-27', '${REAL}')`, [], "real teacher on a real class");
await accepts(`insert into vppsone.class_teachers (session_label, staff_profile_id) values ('TEST-2026-27', '${TEST}')`, [], "test account on a TEST class");
await refuses(`insert into vppsone.class_teachers (session_label, staff_profile_id) values ('2026-27', '${TEST}')`, [], "test account on a real class refused");
await refuses(`insert into vppsone.class_teachers (session_label, staff_profile_id) values ('TEST-2026-27', '${REAL}')`, [], "real teacher on a TEST class refused");
await refuses(`update vppsone.class_teachers set staff_profile_id = '${TEST}' where session_label = '2026-27'`, [], "moving a real class to a test account refused");
await refuses(`update vppsone.class_teachers set session_label = 'TEST-2026-27' where staff_profile_id = '${REAL}'`, [], "moving a real teacher's row into TEST refused");
await accepts(`update vppsone.class_teachers set staff_profile_id = '${REAL2}' where session_label = '2026-27'`, [], "real to real is fine");
await accepts(`update vppsone.class_teachers set note = 'x'`, [], "an update that touches neither person nor session is never checked");

// A row that was already crossed (written before the guard) can still be edited
// and upserted with the same person; only a change is checked.
await run(`alter table vppsone.class_teachers disable trigger staff_session_match;
  insert into vppsone.class_teachers (id, session_label, staff_profile_id) values ('00000000-0000-4000-8000-0000000000aa', '2026-27', '${TEST}');
  alter table vppsone.class_teachers enable trigger staff_session_match;`);
await accepts(`update vppsone.class_teachers set staff_profile_id = '${TEST}', session_label = '2026-27' where id = '00000000-0000-4000-8000-0000000000aa'`, [], "a same-value rewrite of an old crossed row passes");

for (const [table, column] of [["teaching_assignments", "staff_profile_id"], ["staff_scopes", "staff_profile_id"], ["cover_policies", "staff_profile_id"], ["teacher_tasks", "assigned_staff_id"], ["collection_requests", "assigned_staff_id"]]) {
  await accepts(`insert into vppsone.${table} (session_label, ${column}) values ('2026-27', '${REAL}')`, [], `${table}: real in real`);
  await refuses(`insert into vppsone.${table} (session_label, ${column}) values ('2026-27', '${TEST}')`, [], `${table}: test account in real refused`);
  await refuses(`insert into vppsone.${table} (session_label, ${column}) values ('TEST-2026-27', '${REAL}')`, [], `${table}: real person in TEST refused`);
  await accepts(`insert into vppsone.${table} (session_label, ${column}) values ('TEST-2026-27', null)`, [], `${table}: nobody assigned is fine`);
}

// Tables that reach their session through a parent.
const [realVersion] = await q("insert into vppsone.timetable_versions (session_label) values ('2026-27') returning id");
const [testVersion] = await q("insert into vppsone.timetable_versions (session_label) values ('TEST-2026-27') returning id");
await accepts("insert into vppsone.timetable_slots (version_id, staff_profile_id) values ($1, $2)", [realVersion.id, REAL], "real teacher in the real timetable");
await accepts("insert into vppsone.timetable_slots (version_id, staff_profile_id) values ($1, $2)", [testVersion.id, TEST], "test account in the TEST timetable");
await accepts("insert into vppsone.timetable_slots (version_id, staff_profile_id) values ($1, null)", [realVersion.id], "a free period is fine");
await refuses("insert into vppsone.timetable_slots (version_id, staff_profile_id) values ($1, $2)", [realVersion.id, TEST], "test account in the real timetable refused");
await refuses("insert into vppsone.timetable_slots (version_id, staff_profile_id) values ($1, $2)", [testVersion.id, REAL], "real teacher copied into the TEST timetable refused");
await refuses("update vppsone.timetable_slots set version_id = $1 where version_id = $2 and staff_profile_id is not null", [testVersion.id, realVersion.id], "moving real slots into a TEST version refused");
await accepts("update vppsone.timetable_slots set period = 3", [], "a slot edit that keeps person and version passes");

const [realExam] = await q("insert into vppsone.assessments (session_label) values ('2026-27') returning id");
const [testExam] = await q("insert into vppsone.assessments (session_label) values ('TEST-2026-27') returning id");
for (const table of ["exam_duties", "exam_marks_links"]) {
  await accepts(`insert into vppsone.${table} (assessment_id, staff_profile_id) values ($1, $2)`, [realExam.id, REAL], `${table}: real teacher on a real exam`);
  await accepts(`insert into vppsone.${table} (assessment_id, staff_profile_id) values ($1, $2)`, [testExam.id, TEST], `${table}: test account on a TEST exam`);
  await refuses(`insert into vppsone.${table} (assessment_id, staff_profile_id) values ($1, $2)`, [realExam.id, TEST], `${table}: test account on a real exam refused`);
  await refuses(`insert into vppsone.${table} (assessment_id, staff_profile_id) values ($1, $2)`, [testExam.id, REAL], `${table}: real teacher on a TEST exam refused`);
}

// Grants: the guard is not callable by app roles; the predicate is.
const acl = (await q("select p.proname, p.proacl::text acl from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'vppsone' and p.proname in ('staff_matches_session','guard_staff_session_match') order by 1"));
const guard = acl.find((r) => r.proname === "guard_staff_session_match");
ok(guard && !/anon=|authenticated=|=X\//.test(guard.acl.replace(/postgres=X\/postgres/g, "")), `guard not executable by app roles: ${guard?.acl}`);
const pred = acl.find((r) => r.proname === "staff_matches_session");
ok(pred && !/anon=X/.test(pred.acl) && /authenticated=X/.test(pred.acl), `predicate for authenticated, not anon: ${pred?.acl}`);

await db.close();
if (failures) { console.log(`${failures} FAILED`); process.exit(1); }
console.log("PASS: staff session match");
