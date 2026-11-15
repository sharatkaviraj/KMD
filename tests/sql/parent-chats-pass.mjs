/** In-memory PostgreSQL proof of passing a chat to another desk (D-617):
 * supabase/migrations/*_parent_chats.sql, then *_parent_chats_pass.sql,
 * against synthetic neighbours shaped as One's are (staff, the roster, class
 * teachers, hand-offs, the template registry, stand-ins for Supabase's storage
 * and pg_cron). No URL, credentials or hosted database accepted: pass a local
 * installed @electric-sql/pglite directory (CI installs it in a disposable
 * folder). Every name and number here is made up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const read = (suffix) => {
  const found = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(found.length, 1, `one ${suffix} migration`);
  return readFileSync(join(migrations, found[0]), "utf8");
};
const base = read("_parent_chats.sql");
const pass = read("_parent_chats_pass.sql");

// It applies without anybody standing by to confirm: nothing is taken away,
// and the roster is only read.
const code = pass.replace(/--[^\n]*/g, "");
assert.doesNotMatch(code, /\b(drop|truncate|rename)\b/i, "adds only");
assert.doesNotMatch(code, /\bdelete\s+from\b/i, "adds only");
assert.doesNotMatch(code, /\b(create|alter|insert\s+into|update)\s+(table\s+|function\s+|or\s+replace\s+function\s+)?public\./i, "writes nothing in public");

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.staff_profiles (id uuid primary key, role text not null, display_name text not null default 'Staff',
  is_active boolean not null default true, is_test_account boolean not null default false);
create table vppsone.role_permissions (role text not null, permission text not null, primary key (role, permission));
create table vppsone.parent_replies (id uuid primary key);
create table vppsone.parent_helper_handoffs (id uuid primary key, parent_reply_id uuid references vppsone.parent_replies(id));
create table vppsone.whatsapp_templates (
  key text primary key, provider_name text not null, language_code text not null, feature text not null,
  body_params integer not null default 0, param_names text[] not null default '{}', header text not null default 'none',
  url_button boolean not null default false, label_en text, label_hi text, status text not null default 'not_submitted',
  category text not null default 'utility'
);
create table vppsone.class_teachers (class_id uuid not null, staff_profile_id uuid not null, session_label text not null,
  role text not null default 'class_teacher', effective_from date, effective_to date);
create function vppsone.school_today() returns date language sql stable as $$ select date '2026-11-15' $$;
create table public.classes (id uuid primary key, session_label text not null);
create table public.students (id uuid primary key, class_id uuid references public.classes(id));
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job values (p_name, p_schedule, p_command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  select 1::bigint;
$$;
grant usage on schema vppsone to anon, authenticated, service_role;
`);
await db.exec(base);
await db.exec(pass);
// Applying it twice changes nothing and fails nowhere.
await db.exec(pass);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows.map((row) => ({ ...row }));
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};

const TEACHER = id(1);
const OTHER_TEACHER = id(2);
const REAL_TEACHER = id(3);
const ACCOUNTANT = id(4);
const ADMIN = id(5);
const AARAV = id(10);
const RUDRA = id(11);
const MEERA = id(12);
const CLASS_6 = id(20);
const CLASS_2 = id(21);
const CLASS_9 = id(22);
const PARENT = "+919000000001";
await db.exec(`
insert into vppsone.staff_profiles (id, role, display_name, is_test_account) values
  ('${TEACHER}', 'teacher', 'Test Teacher Six', true),
  ('${OTHER_TEACHER}', 'teacher', 'Test Teacher Two', true),
  ('${REAL_TEACHER}', 'teacher', 'Real Teacher', false),
  ('${ACCOUNTANT}', 'accountant', 'Test Accountant', true),
  ('${ADMIN}', 'admin', 'Test Admin', true);
insert into public.classes (id, session_label) values ('${CLASS_6}', 'TEST-2026-27'), ('${CLASS_2}', 'TEST-2026-27'), ('${CLASS_9}', 'TEST-2026-27');
insert into public.students (id, class_id) values ('${AARAV}', '${CLASS_6}'), ('${RUDRA}', '${CLASS_2}'), ('${MEERA}', '${CLASS_9}');
insert into vppsone.class_teachers (class_id, staff_profile_id, session_label, effective_from, effective_to) values
  ('${CLASS_6}', '${OTHER_TEACHER}', 'TEST-2026-27', '2026-04-01', '2026-09-30'),
  ('${CLASS_6}', '${TEACHER}', 'TEST-2026-27', '2026-10-01', null),
  ('${CLASS_2}', '${OTHER_TEACHER}', 'TEST-2026-27', null, null),
  ('${CLASS_9}', '${REAL_TEACHER}', 'TEST-2026-27', null, null);
`);

const open = (desk, teacher, students = [AARAV]) =>
  one("select vppsone.parent_chat_open($1, $2, $3, true, 'TEST-2026-27', 'Test Parent', $4::uuid[], null, 'hi') id", [PARENT, desk, teacher, students]).then((row) => row.id);
// A new chat as if it had been opened before its first message, so each message's own moment leads.
const openNew = async (desk, teacher, students = [AARAV]) => {
  const chatId = await open(desk, teacher, students);
  await db.query("update vppsone.parent_chats set created_at = '2026-11-01T00:00:00Z', last_message_at = '2026-11-01T00:00:00Z' where id = $1", [chatId]);
  return chatId;
};
const append = (message) => one("select vppsone.parent_chat_append($1::jsonb) r", [JSON.stringify(message)]).then((row) => row.r);
const chat = (chatId) => one("select * from vppsone.parent_chats where id = $1", [chatId]);
const passTo = (chatId, desk, teacher = null, wantsAdmin = false, note = null) =>
  one("select vppsone.parent_chat_pass($1, $2, $3, $4, $5, 'Test Teacher Six', $6) id", [chatId, desk, teacher, wantsAdmin, TEACHER, note]).then((row) => row.id);
const messages = (chatId) => all("select direction, kind, body, meta from vppsone.parent_chat_messages where chat_id = $1 order by at, created_at", [chatId]);

// --- Each child's class teacher, of the chat's own kind --------------------------
const family = await openNew("class", TEACHER, [MEERA, AARAV, RUDRA]);
assert.deepEqual(
  await all("select student_id, staff_id, staff_name from vppsone.parent_chat_class_teachers($1)", [family]),
  [
    { student_id: AARAV, staff_id: TEACHER, staff_name: "Test Teacher Six" },
    { student_id: RUDRA, staff_id: OTHER_TEACHER, staff_name: "Test Teacher Two" },
  ],
  "today's class teacher, in the chat's order; a real teacher never for a practice chat",
);
await db.exec(`update vppsone.staff_profiles set is_active = false where id = '${OTHER_TEACHER}'`);
assert.equal((await all("select * from vppsone.parent_chat_class_teachers($1)", [family])).length, 1, "nobody who has left");
await db.exec(`update vppsone.staff_profiles set is_active = true where id = '${OTHER_TEACHER}'`);
console.log("PASS: the class teachers a chat can go to are today's, and of the chat's own kind");

// --- A chat moves when the family has none at that desk ---------------------------------
await append({ chat_id: family, direction: "in", body: "Has the fee been received?", wamid: "wamid.p1", at: "2026-11-15T04:00:00Z" });
const moved = await passTo(family, "accounts", TEACHER, false, "Please check the receipt");
assert.equal(moved, family, "the same chat, at its new desk");
let row = await chat(family);
assert.equal(row.desk, "accounts");
assert.equal(row.class_teacher_id, null, "only the class desk names a teacher");
assert.equal(row.status, "waiting", "still waiting for the school");
assert.equal(row.waiting_since.toISOString(), "2026-11-15T04:00:00.000Z", "since the parent wrote");
assert.equal(row.nudge_step, "first", "the new desk is told");
assert.ok(row.next_nudge_at <= new Date(), "at once");
let lines = await messages(family);
assert.deepEqual(lines.map((line) => line.direction), ["in", "note"]);
assert.equal(lines[1].body, "Please check the receipt");
assert.deepEqual(lines[1].meta, { event: "passed", from: "class", to: "accounts", from_teacher: TEACHER, to_teacher: null, joined: false });
assert.equal(await passTo(family, "accounts"), family, "already there: nothing to do");
assert.equal((await messages(family)).length, 2, "and no line for it");
await rejects("select vppsone.parent_chat_pass($1, 'class', null, false, null, null, null)", [family], "needs its teacher");
await rejects("select vppsone.parent_chat_pass($1, 'office', null, false, null, null, null)", [family], "unknown desk");
console.log("PASS: a chat moves to a desk the family has no chat at, and that desk is told at once");

// --- A chat joins the family's chat at that desk ----------------------------------------
const classChat = await openNew("class", TEACHER, [AARAV]);
await append({ chat_id: classChat, direction: "in", body: "Aarav will be late tomorrow", wamid: "wamid.p2", at: "2026-11-15T03:00:00Z" });
await append({ chat_id: classChat, direction: "out", body: "Noted, thank you", staff_id: TEACHER, at: "2026-11-15T03:05:00Z" });
assert.equal((await chat(classChat)).status, "open");
const joined = await passTo(classChat, "accounts", null, false, "About the bus fee as well");
assert.equal(joined, family, "it joins the accounts chat already there");
lines = await messages(family);
assert.deepEqual(lines.map((line) => line.body), [
  "Aarav will be late tomorrow",
  "Noted, thank you",
  "Has the fee been received?",
  "Please check the receipt",
  "About the bus fee as well",
], "every message, in the order it happened");
assert.equal(lines.at(-1).meta.joined, true);
row = await chat(family);
assert.equal(row.status, "waiting", "the family is still waiting at accounts");
assert.equal(row.waiting_since.toISOString(), "2026-11-15T04:00:00.000Z");
assert.equal(row.last_staff_at.toISOString(), "2026-11-15T03:05:00.000Z", "who answered, from either chat");
const left = await chat(classChat);
assert.equal(left.status, "done");
assert.equal(left.merged_into, family);
assert.equal(left.waiting_since, null);
assert.equal(left.next_nudge_at, null);
assert.equal((await messages(classChat)).length, 0, "nothing stays behind");
assert.equal(await passTo(classChat, "admin"), null, "a chat that joined another cannot be passed again");
console.log("PASS: a chat passed where the family has one joins it, in time order, and closes");

// --- A finished chat at the new desk waits again when the passed one was waiting ----------
const admin = await openNew("admin", null, [AARAV]);
await append({ chat_id: admin, direction: "in", body: "Thank you", wamid: "wamid.p3", at: "2026-11-14T10:00:00Z" });
await db.exec(`update vppsone.parent_chats set status = 'done', waiting_since = null, nudge_step = null, next_nudge_at = null, done_at = now() where id = '${admin}'`);
assert.equal(await passTo(family, "admin", null, true, null), admin);
row = await chat(admin);
assert.equal(row.status, "waiting", "the parent is waiting, so the chat waits");
assert.equal(row.waiting_since.toISOString(), "2026-11-15T04:00:00.000Z", "since the parent first waited");
assert.equal(row.wants_admin, true, "the principal was asked for");
assert.equal(row.done_at, null);
assert.equal(row.last_preview, "Has the fee been received?", "the newest line, whichever chat it came from");
assert.equal((await messages(admin)).at(-1).body, null, "a pass without a note says only who passed it");
console.log("PASS: the wait carries over to the chat it joins, and a wish for the principal is kept");

// --- The old desk is wanted again: its row starts afresh -----------------------------------
const again = await open("class", TEACHER, [AARAV]);
assert.equal(again, classChat, "the same family at the same desk keeps one row");
assert.equal((await chat(classChat)).merged_into, null, "it is a chat of its own again");
await append({ chat_id: classChat, direction: "in", body: "New question", wamid: "wamid.p4" });
assert.equal((await chat(classChat)).status, "waiting");
console.log("PASS: a chat that joined another starts afresh when its desk is needed again");

// --- The rules still hold on every row --------------------------------------------------
const broken = await one(`select count(*)::int n from vppsone.parent_chats
  where (status = 'waiting') <> (waiting_since is not null) or (nudge_step is null) <> (next_nudge_at is null)`);
assert.equal(broken.n, 0);
for (const fn of ["vppsone.parent_chat_pass(uuid, text, uuid, boolean, uuid, text, text)", "vppsone.parent_chat_class_teachers(uuid)"]) {
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await one(`select has_function_privilege('${role}', '${fn}', 'execute') ok`)).ok, false, `${role} cannot run ${fn}`);
  }
  assert.equal((await one(`select has_function_privilege('service_role', '${fn}', 'execute') ok`)).ok, true);
}
assert.ok(await one("select 1 ok from pg_indexes where indexname = 'parent_chat_messages_reply'"));
console.log("PASS: service role only; every row keeps the chats' own rules");

console.log("parent chats, passing: all checks passed");
