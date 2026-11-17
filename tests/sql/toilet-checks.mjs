/** In-memory PostgreSQL proof of the toilet checks migration (D-652):
 * supabase/migrations/20261117112752_toilet_checks.sql, against a synthetic
 * schema. No URL, credentials or hosted database accepted: pass a local
 * installed @electric-sql/pglite directory (CI installs it in a disposable
 * folder). Proves toilets, settings, the weekly chart store (missed checks,
 * replacing an older chart, saying it twice), the fences and the grants.
 */
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migration = await readFile(new URL("../../supabase/migrations/20261117112752_toilet_checks.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../../supabase/migrations/20261117112806_toilet_role_permissions.sql", import.meta.url), "utf8");

const db = new PGlite();
const q = async (sql, params) => (await db.query(sql, params)).rows;
let failures = 0;
const ok = (cond, label) => { console.log(`${cond ? "PASS" : "FAIL"} ${label}`); if (!cond) failures += 1; };
async function refuses(sql, params, code, label) {
  try { await db.query(sql, params); ok(false, `${label} (was accepted)`); }
  catch (error) { ok(String(error.message).includes(code), `${label} -> ${String(error.message).slice(0, 90)}`); }
}

await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema vppsone;
  create table vppsone.staff_profiles (id uuid primary key);
  create table vppsone.role_permissions (role text not null, permission text not null, primary key (role, permission),
    constraint role_permissions_shape check (permission ~ '^[a-z_]+:[a-z_]+$'));
  create function vppsone.is_test_session(p text) returns boolean language sql immutable as $$ select p ~ '^(TEST-|UAT-|DEMO-)' $$;
  create function vppsone.current_is_test_account() returns boolean language sql stable as $$ select false $$;
  create function vppsone.is_real_admin() returns boolean language sql stable as $$ select false $$;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  insert into vppsone.staff_profiles values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
`);
await db.exec(migration);
await db.exec(grants);

const ACTOR = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const id = (n) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;

ok((await q("select count(*)::int n from vppsone.role_permissions where permission like 'toilets:%'"))[0].n === 6, "six role rows (admin and office)");
const bucket = (await q("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'toilet-charts'"))[0];
ok(bucket && bucket.public === false && Number(bucket.file_size_limit) === 5242880 && bucket.allowed_mime_types.join() === "image/jpeg", "private JPEG bucket, 5 MB");
ok((await q("select count(*)::int n from pg_policies where tablename = 'objects' and policyname = 'toilet_charts_server_only' and permissive = 'RESTRICTIVE'"))[0].n === 1, "storage fence is restrictive");
ok((await q("select count(*)::int n from pg_policies where policyname = 'test_session_fence' and tablename like 'toilet%'"))[0].n === 3, "TEST fence on all three tables");

// Toilets: one name once per session, a removed name can come back.
const [boys] = await q("insert into vppsone.toilets (session_label, name, used_by, created_by) values ('2026-27', 'Boys, ground floor', 'boys', $1) returning id", [ACTOR]);
await refuses("insert into vppsone.toilets (session_label, name) values ('2026-27', ' boys, ground floor ')", [], "toilets_one_name", "same name twice refused");
const [testToilet] = await q("insert into vppsone.toilets (session_label, name) values ('TEST-2026-27', 'Boys, ground floor') returning id");
ok(Boolean(testToilet.id), "the TEST year has its own toilet of the same name");
await refuses("insert into vppsone.toilets (session_label, name, used_by) values ('2026-27', 'Girls', 'children')", [], "check", "unknown 'used by' refused");
await refuses("insert into vppsone.toilets (session_label, name) values ('2026-27', '   ')", [], "check", "blank name refused");

// Settings.
await q("insert into vppsone.toilet_settings (session_label) values ('2026-27')");
const s = (await q("select morning_at::text m, afternoon_at::text a, checklist from vppsone.toilet_settings"))[0];
ok(s.m === "09:00:00" && s.a === "13:00:00" && s.checklist === null, "default times 9:00 and 1:00, One's own tick list");
await refuses("update vppsone.toilet_settings set morning_at = '14:00'", [], "check", "morning after afternoon refused");
await refuses("update vppsone.toilet_settings set checklist = '[]'::jsonb", [], "check", "empty tick list refused");

// Charts: a Monday only, the week's photo set, missed checks inside the week.
await refuses("insert into vppsone.toilet_charts (id, session_label, toilet_id, week_start, pages) values ($1, '2026-27', $2, '2026-11-18', '{a}')", [id(1), boys.id], "check", "a week that does not start on Monday refused");
await refuses("insert into vppsone.toilet_charts (id, session_label, toilet_id, week_start, pages) values ($1, 'TEST-2026-27', $2, '2026-11-16', '{a}')", [id(1), boys.id], "foreign key", "a chart naming another session's toilet refused");
await refuses("insert into vppsone.toilet_charts (id, session_label, toilet_id, week_start, pages) values ($1, '2026-27', $2, '2026-11-16', '{}')", [id(1), boys.id], "check", "a chart with no page refused");

await q("insert into vppsone.toilet_charts (id, session_label, toilet_id, week_start, pages, uploaded_by) values ($1, '2026-27', $2, '2026-11-16', '{p1,p2}', $3)", [id(1), boys.id, ACTOR]);
await refuses("select vppsone.toilet_chart_store($1, '2026-27', $2, '[]'::jsonb, null)", [id(1), OTHER], "toilets:not_found", "only the uploader stores their upload");
await refuses("select vppsone.toilet_chart_store($1, 'TEST-2026-27', $2, '[]'::jsonb, null)", [id(1), ACTOR], "toilets:not_found", "another session cannot store it");
await refuses("select vppsone.toilet_chart_store($1, '2026-27', $2, $3::jsonb, null)", [id(1), ACTOR, JSON.stringify([{ day: "2026-11-23", slot: "morning" }])], "toilets:bad_request", "a missed check outside the week refused");
await refuses("select vppsone.toilet_chart_store($1, '2026-27', $2, $3::jsonb, null)", [id(1), ACTOR, JSON.stringify([{ day: "2026-11-17", slot: "evening" }])], "toilets:bad_request", "an unknown slot refused");
await refuses("select vppsone.toilet_chart_store($1, '2026-27', $2, $3::jsonb, null)", [id(1), ACTOR, JSON.stringify([{ day: "2026-11-17", slot: "morning" }, { day: "2026-11-17", slot: "morning" }])], "toilets:bad_request", "the same check twice refused");
ok((await q("select upload_state from vppsone.toilet_charts where id = $1", [id(1)]))[0].upload_state === "uploading", "a refused store leaves the upload as it was");

const first = (await q("select vppsone.toilet_chart_store($1, '2026-27', $2, $3::jsonb, ' Tap was leaking ') r", [id(1), ACTOR, JSON.stringify([{ day: "2026-11-21", slot: "afternoon" }, { day: "2026-11-17", slot: "morning" }])]))[0].r;
ok(first.again === false, "stored");
const row = (await q("select upload_state, missed, note, stored_at is not null s from vppsone.toilet_charts where id = $1", [id(1)]))[0];
ok(row.upload_state === "stored" && row.s && row.note === "Tap was leaking", "stored with its note trimmed");
ok(JSON.stringify(row.missed) === JSON.stringify([{ day: "2026-11-17", slot: "morning" }, { day: "2026-11-21", slot: "afternoon" }]), "missed checks kept in day order");
const again = (await q("select vppsone.toilet_chart_store($1, '2026-27', $2, '[]'::jsonb, null) r", [id(1), ACTOR]))[0].r;
ok(again.again === true, "saying it twice is harmless");
ok((await q("select jsonb_array_length(missed) n from vppsone.toilet_charts where id = $1", [id(1)]))[0].n === 2, "the second say changed nothing");

// A new upload for the same week takes its place; the old one stays.
await q("insert into vppsone.toilet_charts (id, session_label, toilet_id, week_start, pages, uploaded_by) values ($1, '2026-27', $2, '2026-11-16', '{p3}', $3)", [id(2), boys.id, OTHER]);
await q("select vppsone.toilet_chart_store($1, '2026-27', $2, '[]'::jsonb, null)", [id(2), OTHER]);
const both = await q("select id, replaced_at is not null replaced, replaced_by from vppsone.toilet_charts order by created_at, id");
ok(both.length === 2 && both[0].replaced && both[0].replaced_by === id(2) && !both[1].replaced, "the older chart is set aside, not deleted");
ok((await q("select count(*)::int n from vppsone.toilet_charts where toilet_id = $1 and week_start = '2026-11-16' and upload_state = 'stored' and replaced_at is null and removed_at is null", [boys.id]))[0].n === 1, "one chart per toilet per week");

// A removed toilet takes no new chart.
await q("insert into vppsone.toilet_charts (id, session_label, toilet_id, week_start, pages, uploaded_by) values ($1, '2026-27', $2, '2026-11-09', '{p4}', $3)", [id(3), boys.id, ACTOR]);
await q("update vppsone.toilets set removed_at = now() where id = $1", [boys.id]);
await refuses("select vppsone.toilet_chart_store($1, '2026-27', $2, '[]'::jsonb, null)", [id(3), ACTOR], "toilets:not_found", "a removed toilet takes no new chart");
const [again2] = await q("insert into vppsone.toilets (session_label, name) values ('2026-27', 'Boys, ground floor') returning id");
ok(Boolean(again2.id), "a removed toilet's name can be used again");

// Grants.
ok((await q("select has_table_privilege('authenticated', 'vppsone.toilet_charts', 'select') p"))[0].p === false, "staff accounts cannot read charts through the API");
ok((await q("select has_table_privilege('anon', 'vppsone.toilets', 'select') p"))[0].p === false, "anon cannot read toilets");
ok((await q("select has_function_privilege('authenticated', 'vppsone.toilet_chart_store(uuid, text, uuid, jsonb, text)', 'execute') p"))[0].p === false, "the store writer is service role only");
ok((await q("select has_function_privilege('service_role', 'vppsone.toilet_chart_store(uuid, text, uuid, jsonb, text)', 'execute') p"))[0].p === true, "service role may store");

await db.close();
if (failures) { console.error(`${failures} failed`); process.exit(1); }
console.log("PASS: toilet checks migration");
