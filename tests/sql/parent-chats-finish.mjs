/** In-memory PostgreSQL proof that a chat with a parent finishes by itself
 * (D-645): supabase/migrations/*_parent_chats.sql, *_parent_chats_pass.sql,
 * then *_parent_chats_finish_by_itself.sql, against synthetic neighbours
 * shaped as One's are (staff, the roster, hand-offs, the template registry,
 * stand-ins for Supabase's storage and pg_cron). No URL, credentials or
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
const read = (suffix) => {
  const found = readdirSync(migrations).filter((name) => name.endsWith(suffix));
  assert.equal(found.length, 1, `one ${suffix} migration`);
  return readFileSync(join(migrations, found[0]), "utf8");
};
const base = read("_parent_chats.sql");
const pass = read("_parent_chats_pass.sql");
const finish = read("_parent_chats_finish_by_itself.sql");

// It applies without anybody standing by to confirm: nothing is taken away,
// nothing in public is touched, and nothing leaves the database.
const code = finish.replace(/--[^\n]*/g, "");
assert.doesNotMatch(code, /\b(drop|truncate|rename)\b/i, "adds only");
assert.doesNotMatch(code, /\bdelete\s+from\b/i, "adds only");
assert.doesNotMatch(code, /\bpublic\./i, "nothing in public");
assert.doesNotMatch(code, /net\.http_post|whatsapp_templates/i, "sends nothing");

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
create function vppsone.school_today() returns date language sql stable as $$ select date '2026-11-16' $$;
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
await db.exec(finish);
// Applying it twice changes nothing and fails nowhere.
await db.exec(finish);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows.map((row) => ({ ...row }));

const TEACHER = id(1);
const ADMIN = id(5);
const AARAV = id(10);
await db.exec(`
insert into vppsone.staff_profiles (id, role, display_name, is_test_account) values
  ('${TEACHER}', 'teacher', 'Test Teacher Six', true),
  ('${ADMIN}', 'admin', 'Test Admin', true);
`);

let parents = 0;
/** A practice chat for a made-up parent, its first message `hoursAgo` hours ago and the school's answer five minutes later. */
const answeredChat = async (hoursAgo, { desk = "class", answer = true } = {}) => {
  parents += 1;
  const parent = `+9155500${String(parents).padStart(5, "0")}`;
  const row = await one("select vppsone.parent_chat_open($1, $2, $3, true, 'TEST-2026-27', 'Test Parent', $4::uuid[], null, 'hi') id", [
    parent,
    desk,
    desk === "class" ? TEACHER : null,
    [AARAV],
  ]);
  await db.query("update vppsone.parent_chats set created_at = now() - interval '30 days', last_message_at = now() - interval '30 days' where id = $1", [row.id]);
  const asked = new Date(Date.now() - hoursAgo * 3_600_000);
  await append({ chat_id: row.id, direction: "in", body: "Test question", wamid: `wamid.f${parents}a`, at: asked.toISOString(), nudge_at: "2099-01-01T00:00:00Z" });
  if (answer) {
    await append({ chat_id: row.id, direction: "out", body: "Test answer", staff_id: TEACHER, at: new Date(asked.getTime() + 5 * 60_000).toISOString() });
  }
  return row.id;
};
const append = (message) => one("select vppsone.parent_chat_append($1::jsonb) r", [JSON.stringify(message)]).then((row) => row.r);
const chat = (chatId) => one("select * from vppsone.parent_chats where id = $1", [chatId]);
const notes = (chatId) => all("select meta from vppsone.parent_chat_messages where chat_id = $1 and direction = 'note' order by at, created_at", [chatId]);
const closeQuiet = () => one("select vppsone.parent_chat_close_quiet(200) n").then((row) => row.n);

// --- The settings: on, twelve hours, and kept within bounds --------------------------
let settings = await one("select finish_by_itself, quiet_hours from vppsone.parent_chat_settings where id = 1");
assert.deepEqual({ ...settings }, { finish_by_itself: true, quiet_hours: 12 });
await assert.rejects(db.query("update vppsone.parent_chat_settings set quiet_hours = 0 where id = 1"), /check/i, "at least an hour");
await assert.rejects(db.query("update vppsone.parent_chat_settings set quiet_hours = 100 where id = 1"), /check/i, "at most three days");
console.log("PASS: finishing by itself is on, after 12 quiet hours, within bounds");

// --- An answered chat, quiet for 13 hours, finishes by itself ------------------------
const quiet = await answeredChat(13);
const recent = await answeredChat(2);
const waiting = await answeredChat(30, { answer: false });
const held = await answeredChat(14);
await append({ chat_id: held, direction: "out", body: "Waits for the parent", staff_id: TEACHER, status: "waiting", at: new Date(Date.now() - 13 * 3_600_000).toISOString() });
const live = await answeredChat(13);
await db.query("update vppsone.parent_chats set live_until = now() + interval '10 minutes' where id = $1", [live]);
const taken = await answeredChat(20, { desk: "accounts" });
await db.query("update vppsone.parent_chats set taken_by = $2, taken_at = now() - interval '20 hours' where id = $1", [taken, ADMIN]);
assert.equal((await chat(quiet)).status, "open", "answered");
assert.equal((await chat(waiting)).status, "waiting", "the parent is waiting");

assert.equal(await closeQuiet(), 2, "the quiet chat and the forgotten take-over");
let row = await chat(quiet);
assert.equal(row.status, "done");
assert.equal(row.done_reason, "quiet");
assert.equal(row.done_by, null, "no person finished it");
assert.ok(row.done_at, "when");
assert.equal(row.live_until, null);
assert.equal(row.next_nudge_at, null, "no nudge");
await assert.rejects(db.query("update vppsone.parent_chats set done_reason = 'teacher' where id = $1", [quiet]), /check/i, "only thanks or quiet");
assert.deepEqual(await notes(quiet), [{ meta: { event: "finished_itself", reason: "quiet", hours: 12, handed_back: false } }]);

row = await chat(taken);
assert.equal(row.status, "done");
assert.equal(row.taken_by, null, "the take-over ends: the desk has its chat back");
assert.equal(row.taken_at, null);
assert.deepEqual(await notes(taken), [{ meta: { event: "finished_itself", reason: "quiet", hours: 12, handed_back: true } }]);

for (const [chatId, status, why] of [
  [recent, "open", "two hours is not quiet"],
  [waiting, "waiting", "a parent who is waiting is never closed"],
  [held, "open", "an answer still waiting for the parent keeps the chat"],
  [live, "open", "somebody is answering right now"],
]) {
  assert.equal((await chat(chatId)).status, status, why);
  assert.equal((await notes(chatId)).length, 0, why);
}
console.log("PASS: answered chats quiet for 12 hours finish by themselves, a take-over goes back; waiting, held and live ones stay");

// --- Once only, and the parent writing opens it again --------------------------------
assert.equal(await closeQuiet(), 0, "nothing more to finish");
assert.equal((await notes(quiet)).length, 1, "one line, once");
await append({ chat_id: quiet, direction: "in", body: "One more test question", wamid: "wamid.fagain", nudge_at: "2099-01-01T00:00:00Z" });
row = await chat(quiet);
assert.equal(row.status, "waiting", "the parent wrote: it waits for the school again");
assert.equal(row.done_at, null);
assert.equal(row.nudge_step, "first", "and the desk is told, as before");
console.log("PASS: a chat finishes once, and opens again the moment the parent writes");

// --- A finished chat an admin still holds goes back to its desk once quiet --------------
const heldDone = await answeredChat(14, { desk: "accounts" });
const heldFresh = await answeredChat(1, { desk: "admin" });
for (const chatId of [heldDone, heldFresh]) {
  await db.query(
    "update vppsone.parent_chats set status = 'done', done_at = now(), done_by = $2, live_until = null, taken_by = $2, taken_at = now() where id = $1",
    [chatId, ADMIN],
  );
}
assert.equal(await closeQuiet(), 1, "only the quiet one");
row = await chat(heldDone);
assert.equal(row.status, "done", "still finished");
assert.equal(row.done_by, ADMIN, "by the person who finished it");
assert.equal(row.taken_by, null, "and its desk has it back");
assert.deepEqual(await notes(heldDone), [{ meta: { event: "handed_back_itself", hours: 12 } }]);
assert.equal((await chat(heldFresh)).taken_by, ADMIN, "an hour is not quiet");
assert.equal(await closeQuiet(), 0, "once");
console.log("PASS: a finished chat an admin forgot to hand back goes back to its desk after the quiet hours");

// --- The switch and the hours ---------------------------------------------------------
const later = await answeredChat(15);
await db.exec("update vppsone.parent_chat_settings set finish_by_itself = false where id = 1");
assert.equal(await closeQuiet(), 0, "switched off: nothing finishes");
await db.exec("update vppsone.parent_chat_settings set finish_by_itself = true, enabled = false where id = 1");
assert.equal(await closeQuiet(), 0, "chats off: nothing finishes");
await db.exec("update vppsone.parent_chat_settings set enabled = true, quiet_hours = 24 where id = 1");
assert.equal(await closeQuiet(), 0, "15 hours is not quiet when the school says 24");
await db.exec("update vppsone.parent_chat_settings set quiet_hours = 12 where id = 1");
assert.equal(await closeQuiet(), 1);
assert.equal((await chat(later)).done_reason, "quiet");
console.log("PASS: the switch and the hours are read from the settings row");

// --- A chat that joined another is left alone ------------------------------------------
const joinedAway = await answeredChat(40);
const into = await answeredChat(1, { desk: "admin" });
await db.query("update vppsone.parent_chats set merged_into = $2 where id = $1", [joinedAway, into]);
assert.equal(await closeQuiet(), 0, "it is part of another chat now");
console.log("PASS: a chat that joined another is not finished on its own");

// --- The rules still hold on every row, the job is set, service role only --------------
const broken = await one(`select count(*)::int n from vppsone.parent_chats
  where (status = 'waiting') <> (waiting_since is not null) or (nudge_step is null) <> (next_nudge_at is null)`);
assert.equal(broken.n, 0);
const job = await one("select schedule, command from cron.job where jobname = 'parent-chats-quiet'");
assert.equal(job.schedule, "*/10 * * * *");
assert.match(job.command, /parent_chat_close_quiet\(200\)/);
const fn = "vppsone.parent_chat_close_quiet(integer)";
for (const role of ["anon", "authenticated"]) {
  assert.equal((await one(`select has_function_privilege('${role}', '${fn}', 'execute') ok`)).ok, false, `${role} cannot run it`);
}
assert.equal((await one(`select has_function_privilege('service_role', '${fn}', 'execute') ok`)).ok, true);
console.log("PASS: every ten minutes, service role only; every row keeps the chats' own rules");

console.log("parent chats, finishing by themselves: all checks passed");
