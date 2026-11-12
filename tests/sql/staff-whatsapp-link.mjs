/** In-memory PostgreSQL proof of Link my WhatsApp (D-582):
 * supabase/migrations/*_staff_whatsapp_link.sql against a synthetic schema.
 * No URL, credentials or hosted database accepted: pass a local installed
 * @electric-sql/pglite directory (CI installs it in a disposable folder).
 * Every name and number here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const found = readdirSync(migrations).filter((name) => name.endsWith("_staff_whatsapp_link.sql"));
assert.equal(found.length, 1, "one staff_whatsapp_link migration");
const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.staff_profiles(
  id uuid primary key, display_name text not null, preferred_language text not null default 'hi',
  is_active boolean not null default true, is_test_account boolean not null default false,
  phone text, whatsapp_phone text,
  whatsapp_opt_in_at timestamptz, whatsapp_opt_in_source text,
  whatsapp_opt_in_recorded_by uuid references vppsone.staff_profiles(id) on delete set null,
  whatsapp_opt_out_at timestamptz, updated_at timestamptz default now()
);
alter table vppsone.staff_profiles add constraint staff_profiles_whatsapp_opt_in_source_known check (
  whatsapp_opt_in_source is null or whatsapp_opt_in_source in ('form', 'self', 'admin_recorded'));
alter table vppsone.staff_profiles add constraint staff_profiles_whatsapp_opt_in_together check (
  (whatsapp_opt_in_at is null) = (whatsapp_opt_in_source is null));
create table vppsone.message_test_recipients(phone_e164 text primary key, label text not null, added_at timestamptz not null default now(), added_by uuid);
`);
await db.exec(readFileSync(join(migrations, found[0]), "utf8"));
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [teacher, tester, gone, other] = [1, 2, 3, 4].map(id);
await db.exec(`
insert into vppsone.staff_profiles(id, display_name, preferred_language, is_active, is_test_account, whatsapp_opt_out_at) values
  ('${teacher}', 'Synthetic Teacher', 'en', true, false, now() - interval '2 days'),
  ('${tester}', 'TEST Teacher One', 'hi', true, true, null),
  ('${gone}', 'Synthetic Leaver', 'hi', false, false, null),
  ('${other}', 'Synthetic Other', 'both', true, false, null);
insert into vppsone.message_test_recipients(phone_e164, label) values ('+919000000001', 'synthetic test phone');
insert into vppsone.staff_whatsapp_links(code, staff_profile_id) values
  ('ABCD2345', '${teacher}'), ('ZZZZ9999', '${teacher}'),
  ('TEST2345', '${tester}'), ('TEST7777', '${tester}'),
  ('GXNE2345', '${gone}'), ('WTHR2345', '${other}');
insert into vppsone.staff_whatsapp_links(code, staff_profile_id, created_at, expires_at) values
  ('XKDD2345', '${other}', now() - interval '2 hours', now() - interval '1 hour');
`);
const link = async (code, from) => (await db.query("select * from vppsone.link_staff_whatsapp($1, $2)", [code, from])).rows[0];

// Refused before anything is read.
assert.equal((await link("ABCD2345", "9000000002")).outcome, "bad_number");
assert.equal((await link("ABCD2345", "+447700900000")).outcome, "bad_number");
assert.equal((await link("ABCD2345", null)).outcome, "bad_number");
assert.equal((await link("WHATSAPP-1", "+919000000002")).outcome, "no_code");
assert.equal((await link("ABCD234I", "+919000000002")).outcome, "no_code");
assert.equal((await link("QQQQ2345", "+919000000002")).outcome, "no_code");
console.log("PASS: a bad number or an unknown code changes nothing");

// Linked: the number, the consent ('self'), the code used; written as ten digits. The other open code is the app's to clear.
const done = await link("abcd-2345", "+919000000002");
assert.deepEqual({ ...done }, { outcome: "linked", staff_profile_id: teacher, display_name: "Synthetic Teacher", preferred_language: "en", is_test_account: false });
const row = (await db.query("select whatsapp_phone, whatsapp_opt_in_source, whatsapp_opt_in_recorded_by, whatsapp_opt_out_at, whatsapp_opt_in_at is not null as yes from vppsone.staff_profiles where id = $1", [teacher])).rows[0];
assert.deepEqual({ ...row }, { whatsapp_phone: "9000000002", whatsapp_opt_in_source: "self", whatsapp_opt_in_recorded_by: teacher, whatsapp_opt_out_at: null, yes: true });
const codes = (await db.query("select code, used_from from vppsone.staff_whatsapp_links where staff_profile_id = $1 order by code", [teacher])).rows;
assert.deepEqual(codes.map((r) => ({ ...r })), [{ code: "ABCD2345", used_from: "+919000000002" }, { code: "ZZZZ9999", used_from: null }]);
const rule = (await db.query("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'staff_profiles_whatsapp_opt_in_source_known'")).rows[0].d;
assert.match(rule, /'form'.*'self'.*'admin_recorded'/);
assert.doesNotMatch(rule, /'whatsapp'/);
console.log("PASS: linked writes the ten-digit number and their own yes (self), clears an earlier opt-out, uses the code; the consent rule is untouched");

// The same message again, or another number with a used code.
assert.equal((await link("ABCD2345", "+919000000002")).outcome, "already_linked");
const stolen = await link("ABCD2345", "+919000000003");
assert.deepEqual({ ...stolen }, { outcome: "used", staff_profile_id: null, display_name: null, preferred_language: null, is_test_account: null });
assert.equal((await db.query("select whatsapp_phone from vppsone.staff_profiles where id = $1", [teacher])).rows[0].whatsapp_phone, "9000000002");
console.log("PASS: a repeated message is already_linked, another number on a used code changes nothing and learns nothing");

// Expired, inactive.
const late = await link("XKDD2345", "+919000000004");
assert.equal(late.outcome, "expired");
assert.equal(late.display_name, null);
assert.equal((await link("GXNE2345", "+919000000005")).outcome, "inactive");
assert.equal((await db.query("select count(*)::int n from vppsone.staff_profiles where whatsapp_phone is not null")).rows[0].n, 1);
console.log("PASS: an expired code and a staff member who left change nothing");

// A test account takes only a number on the test list.
const real = await link("TEST2345", "+919000000006");
assert.equal(real.outcome, "not_test_number");
assert.equal((await db.query("select whatsapp_phone from vppsone.staff_profiles where id = $1", [tester])).rows[0].whatsapp_phone, null);
const ok = await link("TEST7777", "+919000000001");
assert.equal(ok.outcome, "linked");
assert.equal(ok.is_test_account, true);
console.log("PASS: a test account links only a test-list number");

// Grants: the browser roles cannot run it or read the codes.
const grants = (await db.query(`select
  has_function_privilege('anon', 'vppsone.link_staff_whatsapp(text, text)', 'execute') as anon_fn,
  has_function_privilege('authenticated', 'vppsone.link_staff_whatsapp(text, text)', 'execute') as auth_fn,
  has_function_privilege('service_role', 'vppsone.link_staff_whatsapp(text, text)', 'execute') as svc_fn,
  has_table_privilege('authenticated', 'vppsone.staff_whatsapp_links', 'select') as auth_read,
  has_table_privilege('anon', 'vppsone.staff_whatsapp_links', 'select') as anon_read,
  has_table_privilege('service_role', 'vppsone.staff_whatsapp_links', 'insert') as svc_write`)).rows[0];
assert.deepEqual({ ...grants }, { anon_fn: false, auth_fn: false, svc_fn: true, auth_read: false, anon_read: false, svc_write: true });
console.log("PASS: only the service role runs the link or touches the codes");

// The shape of a code.
await assert.rejects(db.query("insert into vppsone.staff_whatsapp_links(code, staff_profile_id) values ('ABCD234O', $1)", [other]), /check/);
await assert.rejects(db.query("insert into vppsone.staff_whatsapp_links(code, staff_profile_id) values ('abcd2345', $1)", [other]), /check/);
await assert.rejects(db.query("update vppsone.staff_whatsapp_links set used_at = now() where code = 'WTHR2345'"), /check/);
console.log("PASS: a code is eight characters from the alphabet, and used_at goes with used_from");
