/** In-memory PostgreSQL proof of Sign in with a WhatsApp code (D-585):
 * supabase/migrations/*_staff_sign_in_codes.sql against a synthetic schema.
 * No URL, credentials or hosted database accepted: pass a local installed
 * @electric-sql/pglite directory (CI installs it in a disposable folder).
 * Every name and number here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const found = readdirSync(migrations).filter((name) => name.endsWith("_staff_sign_in_codes.sql"));
assert.equal(found.length, 1, "one staff_sign_in_codes migration");
const db = new PGlite();
await db.exec(`
create schema vppsone; create schema private;
create role anon; create role authenticated; create role service_role;
create function private.whatsapp_phone_key(p_phone text) returns text language sql immutable set search_path to '' as $f$
  select case when length(digits) >= 10 then right(digits, 10) end
  from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as digits) as cleaned
$f$;
create table vppsone.staff_profiles(
  id uuid primary key, user_id uuid, display_name text not null,
  is_active boolean not null default true, is_test_account boolean not null default false,
  phone text, whatsapp_phone text
);
create table vppsone.runtime_flags(key text primary key, enabled boolean, value jsonb);
insert into vppsone.runtime_flags values ('whatsapp_owner_test_number', true, '"+919000000001"');
`);
await db.exec(readFileSync(join(migrations, found[0]), "utf8"));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [owner, teacher, twinA, twinB, tester, leaver, noLogin, phoneOnly] = [1, 2, 3, 4, 5, 6, 7, 8].map(id);
await db.exec(`
insert into vppsone.staff_profiles(id, user_id, display_name, is_active, is_test_account, phone, whatsapp_phone) values
  ('${owner}', '${id(101)}', 'Synthetic Owner', true, false, null, '9000000001'),
  ('${teacher}', '${id(102)}', 'Synthetic Teacher', true, false, '9111111111', '9000000002'),
  ('${twinA}', '${id(103)}', 'Synthetic Twin A', true, false, null, '9000000003'),
  ('${twinB}', '${id(104)}', 'Synthetic Twin B', true, false, '+91 90000 00003', null),
  ('${tester}', '${id(105)}', 'TEST Teacher', true, true, null, '9000000005'),
  ('${leaver}', '${id(106)}', 'Synthetic Leaver', false, false, null, '9000000006'),
  ('${noLogin}', null, 'Synthetic No Login', true, false, null, '9000000007'),
  ('${phoneOnly}', '${id(108)}', 'Synthetic Phone Only', true, false, '090000 00008', null);
`);

const hash = (rowId, code) => createHash("sha256").update(`${rowId}:${code}`).digest("hex");
let client = 0;
const freshClient = () => createHash("sha256").update(`client-${++client}`).digest("hex").slice(0, 32);
const ask = async (phone, clientKey = freshClient(), code = "123456", language = "en") => {
  const rowId = randomUUID();
  const row = (await db.query("select * from vppsone.request_staff_sign_in_code($1, $2, $3, $4, $5)", [rowId, phone, clientKey, hash(rowId, code), language])).rows[0];
  return { ...row, rowId };
};
const check = async (rowId, code) => ({ ...(await db.query("select * from vppsone.verify_staff_sign_in_code($1, $2)", [rowId, hash(rowId, code)])).rows[0] });
const age = (phoneKey, seconds) => db.query("update vppsone.staff_sign_in_codes set created_at = created_at - make_interval(secs => $2), expires_at = expires_at - make_interval(secs => $2) where phone_key = $1", [phoneKey, seconds]);
const setMode = (mode) => db.query("update vppsone.staff_sign_in_settings set mode = $1", [mode]);

// Starts at owner_only.
assert.equal((await db.query("select mode from vppsone.staff_sign_in_settings")).rows[0].mode, "owner_only");

// Refused before anything is written.
for (const bad of ["12345", "+44 7700 900000", "5000000001", "0091 90000 00001 2", null]) {
  assert.equal((await ask(bad)).outcome, "bad_number", `bad number ${bad}`);
}
await assert.rejects(db.query("select * from vppsone.request_staff_sign_in_code($1, '9000000001', 'not-hex', $2, 'en')", [randomUUID(), "a".repeat(64)]));
await assert.rejects(db.query("select * from vppsone.request_staff_sign_in_code($1, '9000000001', $2, 'not-a-hash', 'en')", [randomUUID(), "ab".repeat(16)]));
assert.equal(Number((await db.query("select count(*) n from vppsone.staff_sign_in_codes")).rows[0].n), 0);
console.log("PASS: a malformed number, client key or hash writes nothing");

// owner_only: the owner's number gets a code, any other staff number does not, and the answer row looks the same.
const ownerAsk = await ask("+91 90000 00001");
assert.deepEqual({ outcome: ownerAsk.outcome, staff_profile_id: ownerAsk.staff_profile_id, phone_key: ownerAsk.phone_key }, { outcome: "send", staff_profile_id: owner, phone_key: "9000000001" });
const teacherAsk = await ask("9000000002");
assert.deepEqual({ outcome: teacherAsk.outcome, staff_profile_id: teacherAsk.staff_profile_id, phone_key: teacherAsk.phone_key }, { outcome: "not_allowed", staff_profile_id: null, phone_key: null });
const stored = (await db.query("select outcome, code_hash is not null as has_code, send_status from vppsone.staff_sign_in_codes order by outcome")).rows.map((r) => ({ ...r }));
assert.deepEqual(stored, [{ outcome: "not_allowed", has_code: false, send_status: "none" }, { outcome: "send", has_code: true, send_status: "pending" }]);
console.log("PASS: owner_only sends to the owner's number only; another staff number is recorded with no code");

// The code: wrong, then right; once only.
assert.deepEqual(await check(ownerAsk.rowId, "000000"), { outcome: "wrong", staff_profile_id: null, user_id: null, tries_left: 4 });
assert.deepEqual(await check(ownerAsk.rowId, "123456"), { outcome: "ok", staff_profile_id: owner, user_id: id(101), tries_left: null });
assert.equal((await check(ownerAsk.rowId, "123456")).outcome, "used");
console.log("PASS: a wrong code counts a try, the right code signs in once, and never again");

// A row with no code answers exactly like a wrong code, then locks after five.
for (let tries = 4; tries >= 1; tries -= 1) assert.deepEqual(await check(teacherAsk.rowId, "123456"), { outcome: "wrong", staff_profile_id: null, user_id: null, tries_left: tries });
assert.equal((await check(teacherAsk.rowId, "123456")).outcome, "locked");
assert.equal((await check(teacherAsk.rowId, "123456")).outcome, "locked");
assert.equal((await check(randomUUID(), "123456")).outcome, "no_code");
console.log("PASS: a number that got no code answers as a wrong code; five tries lock it; an unknown id is no_code");

await setMode("all_staff");
// Unknown, shared, test-only, inactive and login-less numbers: a row, never a code.
const outcomes = {};
for (const [label, phone] of [["unknown", "9000000099"], ["shared", "9000000003"], ["test", "9000000005"], ["leaver", "9000000006"], ["no login", "9000000007"]]) {
  outcomes[label] = (await ask(phone)).outcome;
}
assert.deepEqual(outcomes, { unknown: "no_match", shared: "shared_number", test: "no_match", leaver: "no_match", "no login": "no_match" });
assert.equal(Number((await db.query("select count(*) n from vppsone.staff_sign_in_codes where outcome <> 'send' and code_hash is not null")).rows[0].n), 0);
console.log("PASS: unknown, shared, test-account, inactive and no-login numbers never get a code");

// all_staff: the WhatsApp number wins over the phone; a phone-only record works by its phone.
assert.equal((await ask("9111111111")).outcome, "no_match");
await age("9000000002", 31);
const teacherNow = await ask("919000000002", freshClient(), "654321", "hi");
assert.equal(teacherNow.outcome, "send");
assert.equal((await db.query("select language from vppsone.staff_sign_in_codes where id = $1", [teacherNow.rowId])).rows[0].language, "hi");
assert.equal((await ask("09000000008")).outcome, "send");
console.log("PASS: all_staff matches the WhatsApp number (or the phone when there is none), in the asker's language");

// 30 seconds apart; the newest code replaces the older one.
const tooSoon = await ask("9000000002");
assert.equal(tooSoon.outcome, "limited");
assert.ok(tooSoon.retry_after_seconds >= 1 && tooSoon.retry_after_seconds <= 30);
await age("9000000002", 31);
const second = await ask("9000000002", freshClient(), "777777");
assert.equal(second.outcome, "send");
assert.equal((await check(teacherNow.rowId, "654321")).outcome, "locked");
assert.equal((await check(second.rowId, "777777")).outcome, "ok");
console.log("PASS: 30 seconds between codes, and only the newest code works");

// Expired.
await age("9000000008", 31);
const late = await ask("9000000008", freshClient(), "222222");
await age("9000000008", 601);
assert.equal((await check(late.rowId, "222222")).outcome, "expired");
console.log("PASS: a code older than 10 minutes is expired");

// 3 per number in 15 minutes (counted for every number, matched or not).
for (const phone of ["9000000098", "9000000002"]) {
  await db.query("delete from vppsone.staff_sign_in_codes where phone_key = $1", [phone]);
  for (let n = 0; n < 3; n += 1) {
    assert.notEqual((await ask(phone)).outcome, "limited");
    await age(phone, 31);
  }
  const fourth = await ask(phone);
  assert.equal(fourth.outcome, "limited", phone);
  assert.ok(fourth.retry_after_seconds > 700 && fourth.retry_after_seconds <= 900);
}
console.log("PASS: a fourth code in 15 minutes is refused, the same for a staff number and an unknown one");

// 8 asks from one address in 15 minutes.
const busyClient = freshClient();
for (let n = 0; n < 8; n += 1) assert.notEqual((await ask(`90000001${String(n).padStart(2, "0")}`, busyClient)).outcome, "limited");
assert.equal((await ask("9000000150", busyClient)).outcome, "limited");
console.log("PASS: a ninth ask from one address in 15 minutes is refused");

// The person changes after the code was sent.
await db.query("delete from vppsone.staff_sign_in_codes where phone_key = '9000000002'");
const moved = await ask("9000000002", freshClient(), "333333");
await db.query("update vppsone.staff_profiles set whatsapp_phone = '9000000222' where id = $1", [teacher]);
assert.equal((await check(moved.rowId, "333333")).outcome, "not_staff");
await db.query("update vppsone.staff_profiles set whatsapp_phone = '9000000002' where id = $1", [teacher]);
await db.query("delete from vppsone.staff_sign_in_codes where phone_key = '9000000002'");
const switchedOff = await ask("9000000002", freshClient(), "444444");
await setMode("off");
assert.equal((await check(switchedOff.rowId, "444444")).outcome, "off");
assert.equal((await ask("9000000001")).outcome, "off");
console.log("PASS: a changed number or the switch going off after the code was sent refuses it");

// 120 codes an hour for the school.
await setMode("all_staff");
await db.exec("delete from vppsone.staff_sign_in_codes where phone_key = '9000000001'");
await db.exec(`insert into vppsone.staff_sign_in_codes (id, phone_key, client_key, outcome, staff_profile_id, code_hash)
  select gen_random_uuid(), '9000000002', repeat('ab', 16), 'send', '${teacher}', repeat('0', 64) from generate_series(1, 120)`);
assert.equal((await ask("9000000001")).outcome, "busy");
console.log("PASS: the 121st code in an hour for the whole school is refused");

// Service role only.
const grants = (await db.query(`select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'vppsone' and table_name in ('staff_sign_in_codes', 'staff_sign_in_settings') and grantee in ('anon', 'authenticated', 'PUBLIC')`)).rows;
assert.deepEqual(grants, []);
for (const role of ["anon", "authenticated"]) {
  for (const fn of ["request_staff_sign_in_code(uuid, text, text, text, text)", "verify_staff_sign_in_code(uuid, text)"]) {
    assert.equal((await db.query(`select has_function_privilege('${role}', 'vppsone.${fn}', 'execute') ok`)).rows[0].ok, false, `${role} ${fn}`);
  }
}
assert.equal((await db.query("select has_function_privilege('service_role', 'vppsone.verify_staff_sign_in_code(uuid, text)', 'execute') ok")).rows[0].ok, true);
console.log("PASS: only the service role can read the codes or call either function");
