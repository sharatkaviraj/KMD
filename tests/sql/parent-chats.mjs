/** In-memory PostgreSQL proof of the chats with parents (D-616):
 * supabase/migrations/*_parent_chats.sql, against synthetic neighbours shaped
 * as One's are (staff, the role matrix, hand-offs, the template registry, and
 * stand-ins for Supabase's storage and pg_cron). No URL, credentials or hosted
 * database accepted: pass a local installed @electric-sql/pglite directory
 * (CI installs it in a disposable folder). Every name and number here is made
 * up (rule 6).
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const migrations = join(import.meta.dirname, "../../supabase/migrations");
const found = readdirSync(migrations).filter((name) => name.endsWith("_parent_chats.sql"));
assert.equal(found.length, 1, "one _parent_chats migration");
const migration = readFileSync(join(migrations, found[0]), "utf8");

// It applies without anybody standing by to confirm: nothing is taken away.
const code = migration.replace(/--[^\n]*/g, "");
assert.doesNotMatch(code, /\b(drop|truncate|rename)\b/i, "adds only");
assert.doesNotMatch(code, /\bdelete\s+from\b/i, "adds only");
assert.doesNotMatch(code, /\bpublic\./i, "creates nothing in public");

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.staff_profiles (id uuid primary key, role text not null, is_test_account boolean not null default false);
create table vppsone.role_permissions (role text not null, permission text not null, primary key (role, permission),
  constraint role_permissions_shape check (permission ~ '^[a-z_]+:[a-z_]+$'));
create table vppsone.parent_replies (id uuid primary key);
create table vppsone.parent_helper_handoffs (id uuid primary key, parent_reply_id uuid references vppsone.parent_replies(id));
create table vppsone.whatsapp_templates (
  key text primary key, provider_name text not null, language_code text not null, feature text not null,
  body_params integer not null default 0, param_names text[] not null default '{}', header text not null default 'none',
  url_button boolean not null default false, label_en text, label_hi text, status text not null default 'not_submitted',
  category text not null default 'utility'
);
-- Stand-ins for Supabase's own schemas.
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
await db.exec(migration);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows.map((row) => ({ ...row }));
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};

const TEACHER = id(1);
const OTHER_TEACHER = id(2);
const ADMIN = id(3);
const ACCOUNTANT = id(4);
const AARAV = id(10);
const RUDRA = id(11);
const PARENT = "+919000000001";
const OTHER_PARENT = "+919000000002";
await db.exec(`
insert into vppsone.staff_profiles (id, role, is_test_account) values
  ('${TEACHER}', 'teacher', true), ('${OTHER_TEACHER}', 'teacher', true), ('${ADMIN}', 'admin', false), ('${ACCOUNTANT}', 'accountant', true);
`);

const open = (parent, desk, teacher, practice, from, students, label = null, language = "hi") =>
  one("select vppsone.parent_chat_open($1, $2, $3, $4, 'TEST-2026-27', $5, $6::uuid[], $7, $8) id", [
    parent, desk, teacher, practice, from, students, label, language,
  ]).then((row) => row.id);
const append = (message) => one("select vppsone.parent_chat_append($1::jsonb) r", [JSON.stringify(message)]).then((row) => row.r);
const chat = (chatId) => one("select * from vppsone.parent_chats where id = $1", [chatId]);

// --- One chat per family per desk ------------------------------------------
const classChat = await open(PARENT, "class", TEACHER, true, "Parent", [AARAV], "Aarav · 6");
assert.equal(await open(PARENT, "class", TEACHER, true, "Test Parent", [RUDRA, AARAV], null, "en"), classChat, "the same family at the same desk keeps one chat");
let row = await chat(classChat);
assert.deepEqual(row.student_ids, [AARAV, RUDRA], "a second child joins, in the order they came, once each");
assert.equal(row.from_name, "Test Parent", "a real name replaces 'Parent'");
assert.equal(row.student_label, "Aarav · 6", "a missing label keeps the one there was");
assert.equal(row.language, "en", "the parent's latest language wins");
assert.equal(await open(PARENT, "class", TEACHER, true, "Parent", [AARAV]), classChat);
assert.equal((await chat(classChat)).from_name, "Test Parent", "'Parent' never replaces a real name");
assert.notEqual(await open(PARENT, "class", OTHER_TEACHER, true, "Parent", [RUDRA]), classChat, "another class teacher is another chat");
const accountsChat = await open(PARENT, "accounts", TEACHER, true, "Parent", [AARAV]);
assert.equal((await chat(accountsChat)).class_teacher_id, null, "only the class desk names a class teacher");
assert.equal(await open(PARENT, "accounts", null, true, "Parent", [AARAV]), accountsChat, "no class teacher still finds the one accounts chat");
assert.notEqual(await open(PARENT, "accounts", null, false, "Parent", [AARAV]), accountsChat, "practice and real never share a chat");
assert.notEqual(await open(OTHER_PARENT, "accounts", null, true, "Parent", [AARAV]), accountsChat, "another number is another family");
const many = await open(OTHER_PARENT, "admin", null, true, "Parent", Array.from({ length: 12 }, (_, n) => id(200 + n)));
assert.equal((await chat(many)).student_ids.length, 8, "at most eight children on a chat");
await rejects(`insert into vppsone.parent_chats (parent_e164, desk, class_teacher_id, session_label) values ('${PARENT}', 'admin', '${TEACHER}', 'TEST-2026-27')`, [], "parent_chats_class_teacher_on_class_desk");
await rejects(`insert into vppsone.parent_chats (parent_e164, desk, session_label) values ('9000000001', 'admin', 'TEST-2026-27')`, [], "parent_e164");
await rejects(`insert into vppsone.parent_chats (parent_e164, desk, session_label, status) values ('${PARENT}', 'admin', 'TEST-2026-27', 'waiting')`, [], "parent_chats_waiting_together");
console.log("PASS: one chat per family per desk; children, name and language join it; practice apart from real");

// --- The parent writes: the chat waits and a nudge is planned ----------------
const t0 = "2026-11-15T04:00:00Z";
const first = await append({ chat_id: classChat, direction: "in", body: "Can I talk to the class teacher about homework?", wamid: "wamid.parent-1", at: t0 });
assert.equal(first.duplicate, false);
row = await chat(classChat);
assert.equal(row.status, "waiting");
assert.equal(row.waiting_since.toISOString(), "2026-11-15T04:00:00.000Z");
assert.equal(row.nudge_step, "first");
assert.equal(row.next_nudge_at.toISOString(), "2026-11-15T04:02:00.000Z", "the first nudge two minutes on");
assert.equal(row.last_direction, "in");
assert.equal(row.last_preview, "Can I talk to the class teacher about homework?");
const again = await append({ chat_id: classChat, direction: "in", body: "Please reply", wamid: "wamid.parent-1", at: t0 });
assert.equal(again.duplicate, true, "the same WhatsApp message twice is one message");
await append({ chat_id: classChat, direction: "in", body: "Please reply", wamid: "wamid.parent-2", at: "2026-11-15T04:05:00Z" });
row = await chat(classChat);
assert.equal(row.waiting_since.toISOString(), "2026-11-15T04:00:00.000Z", "still waiting since the first message");
assert.equal(row.next_nudge_at.toISOString(), "2026-11-15T04:02:00.000Z", "a second message does not plan a second nudge");
assert.equal(row.last_parent_at.toISOString(), "2026-11-15T04:05:00.000Z");
assert.equal((await one("select count(*)::int n from vppsone.parent_chat_messages where chat_id = $1", [classChat])).n, 2);

// --- A staff reply: the wait ends and the chat is live for 30 minutes ---------
const client = id(500);
const reply = await append({ chat_id: classChat, direction: "out", body: "Of course. Homework is on page 12.", staff_id: TEACHER, staff_name: "Test teacher", status: "sending", client_ref: client, at: "2026-11-15T04:10:00Z" });
assert.equal(reply.duplicate, false);
assert.equal((await append({ chat_id: classChat, direction: "out", body: "Of course. Homework is on page 12.", client_ref: client })).duplicate, true, "a double tap on Send sends once");
row = await chat(classChat);
assert.equal(row.status, "open");
assert.equal(row.waiting_since, null);
assert.equal(row.nudge_step, null);
assert.equal(row.next_nudge_at, null);
assert.equal(row.live_until.toISOString(), "2026-11-15T04:40:00.000Z");
assert.equal(row.last_direction, "out");
await append({ chat_id: classChat, direction: "ai", body: "Veer Patta AI passed this on.", at: "2026-11-15T04:11:00Z" });
assert.equal((await chat(classChat)).status, "open", "Veer Patta AI's line does not change who is waiting");
await append({ chat_id: classChat, direction: "note", kind: "event", body: "taken", at: "2026-11-15T04:12:00Z" });
assert.equal((await chat(classChat)).last_direction, "ai", "a note for staff is not the chat's last line");
await append({ chat_id: classChat, direction: "in", body: "Thank you", wamid: "wamid.parent-3", at: "2026-11-15T04:20:00Z" });
row = await chat(classChat);
assert.equal(row.status, "waiting");
assert.equal(row.waiting_since.toISOString(), "2026-11-15T04:20:00.000Z", "a new wait starts");
assert.equal(row.next_nudge_at.toISOString(), "2026-11-15T04:22:00.000Z");
await db.exec(`update vppsone.parent_chats set status = 'done', waiting_since = null, nudge_step = null, next_nudge_at = null, done_at = now(), done_by = '${TEACHER}' where id = '${classChat}'`);
await append({ chat_id: classChat, direction: "in", body: "One more thing", wamid: "wamid.parent-4", at: "2026-11-15T05:00:00Z" });
row = await chat(classChat);
assert.equal(row.status, "waiting", "a parent writing again opens a finished chat");
assert.equal(row.done_at, null);
console.log("PASS: the parent writing makes the chat wait once; a reply ends the wait and keeps it live; Done reopens");

// --- WhatsApp's ticks, forward only ------------------------------------------
await db.query("update vppsone.parent_chat_messages set wamid = 'wamid.school-1', status = 'sent' where client_ref = $1", [client]);
const tick = (status, error = null) => one("select vppsone.parent_chat_status('wamid.school-1', $1, '2026-11-15T04:11:00Z', $2) moved", [status, error]).then((r) => r.moved);
const statusNow = () => one("select status from vppsone.parent_chat_messages where client_ref = $1", [client]).then((r) => r.status);
assert.equal(await tick("delivered"), true);
assert.equal(await tick("sent"), false, "never back");
assert.equal(await tick("read"), true);
assert.equal(await tick("delivered"), false);
assert.equal(await tick("failed", "too late"), false, "a read message never turns failed");
assert.equal(await statusNow(), "read");
assert.equal(await one("select vppsone.parent_chat_status('wamid.parent-1', 'read', now(), null) moved").then((r) => r.moved), false, "a parent's message has no ticks");
await append({ chat_id: accountsChat, direction: "out", body: "Receipt attached", wamid: "wamid.school-2", status: "sent" });
assert.equal(await one("select vppsone.parent_chat_status('wamid.school-2', 'failed', now(), 'Re-engagement message') moved").then((r) => r.moved), true);
assert.equal(await one("select error from vppsone.parent_chat_messages where wamid = 'wamid.school-2'").then((r) => r.error), "Re-engagement message");
console.log("PASS: ticks only move forward, and only on the school's messages");

// --- Nudges that are due, each taken once --------------------------------------
await db.exec(`update vppsone.parent_chats set next_nudge_at = now() - interval '1 minute' where id = '${classChat}'`);
const due = await all("select vppsone.parent_chat_take_due(10) id");
assert.deepEqual(due.map((r) => r.id), [classChat]);
assert.deepEqual(await all("select vppsone.parent_chat_take_due(10) id"), [], "a taken chat is left alone for ten minutes");
assert.ok((await chat(classChat)).next_nudge_at > new Date(), "held ten minutes on");
console.log("PASS: a due nudge is taken by one run only");

// --- Unread ------------------------------------------------------------------
const unread = async (staff) => Object.fromEntries((await all("select chat_id, unread from vppsone.parent_chat_unread($1, $2::uuid[])", [staff, [classChat, accountsChat]])).map((r) => [r.chat_id, r.unread]));
assert.deepEqual(await unread(TEACHER), { [classChat]: 4, [accountsChat]: 0 });
await db.query("insert into vppsone.parent_chat_reads (chat_id, staff_id, read_at) values ($1, $2, now()) on conflict (chat_id, staff_id) do update set read_at = excluded.read_at", [classChat, TEACHER]);
assert.deepEqual(await unread(TEACHER), { [classChat]: 0, [accountsChat]: 0 });
assert.deepEqual(await unread(ADMIN), { [classChat]: 4, [accountsChat]: 0 }, "each person has their own read mark");
console.log("PASS: unread counts the parent's messages each person has not read");

// --- One-tap links -------------------------------------------------------------
await db.exec(`insert into vppsone.go_links (code, path, session_label, staff_id, purpose, expires_at) values
  ('Ab12Cd34Ef', '/chats?desk=class', 'TEST-2026-27', '${TEACHER}', 'chat_nudge', now() + interval '7 days'),
  ('Old0000000', '/chats', null, null, 'chat_nudge', now() + interval '1 second')`);
const opened = await one("select * from vppsone.go_link_open('Ab12Cd34Ef')");
assert.deepEqual({ ...opened }, { path: "/chats?desk=class", session_label: "TEST-2026-27", staff_id: TEACHER, purpose: "chat_nudge" });
await one("select * from vppsone.go_link_open('Ab12Cd34Ef')");
assert.equal((await one("select uses from vppsone.go_links where code = 'Ab12Cd34Ef'")).uses, 2, "each open is counted");
await db.exec("update vppsone.go_links set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where code = 'Old0000000'");
assert.equal(await one("select * from vppsone.go_link_open('Old0000000')"), undefined, "an expired link opens nothing");
assert.equal(await one("select * from vppsone.go_link_open('Nope000000')"), undefined);
for (const [path, why] of [["//evil.example", "another site"], ["https://evil.example", "a full address"], ["/chats now", "a space"], ["/chats\\x", "a backslash"]]) {
  await rejects("insert into vppsone.go_links (code, path, purpose, expires_at) values ('Bad0000000', $1, 'chat_nudge', now() + interval '1 day')", [path], "go_links_path_check");
  void why;
}
await rejects("insert into vppsone.go_links (code, path, purpose, expires_at) values ('short', '/chats', 'chat_nudge', now() + interval '1 day')", [], "go_links_code_check");
console.log("PASS: a link opens only One's own pages, is counted, and expires");

// --- Who may touch any of it -----------------------------------------------------
for (const table of ["parent_chats", "parent_chat_messages", "parent_chat_reads", "parent_chat_nudges", "go_links", "parent_chat_settings"]) {
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await one(`select has_table_privilege('${role}', 'vppsone.${table}', 'select') ok`)).ok, false, `${role} cannot read ${table}`);
  }
  assert.equal((await one(`select has_table_privilege('service_role', 'vppsone.${table}', 'insert') ok`)).ok, true);
  assert.equal((await one(`select relrowsecurity ok from pg_class where oid = 'vppsone.${table}'::regclass`)).ok, true, `${table} has RLS on`);
}
for (const fn of [
  "vppsone.parent_chat_open(text, text, uuid, boolean, text, text, uuid[], text, text)",
  "vppsone.parent_chat_append(jsonb)",
  "vppsone.parent_chat_status(text, text, timestamptz, text)",
  "vppsone.parent_chat_take_due(integer)",
  "vppsone.parent_chat_unread(uuid, uuid[])",
  "vppsone.go_link_open(text)",
]) {
  for (const role of ["anon", "authenticated"]) {
    assert.equal((await one(`select has_function_privilege('${role}', '${fn}', 'execute') ok`)).ok, false, `${role} cannot run ${fn}`);
  }
  assert.equal((await one(`select has_function_privilege('service_role', '${fn}', 'execute') ok`)).ok, true);
}
const bucket = await one("select * from storage.buckets where id = 'parent-chat-files'");
assert.equal(bucket.public, false);
assert.equal(Number(bucket.file_size_limit), 16 * 1024 * 1024);
assert.ok(bucket.allowed_mime_types.includes("image/jpeg") && bucket.allowed_mime_types.includes("application/pdf"));
const policy = await one("select permissive, roles::text roles, qual, with_check from pg_policies where policyname = 'parent_chat_files_server_only'");
assert.equal(policy.permissive, "RESTRICTIVE");
assert.match(policy.qual, /parent-chat-files/);
console.log("PASS: service role only; the files bucket is private and closed to browsers");

// --- Its rows: roles, templates, settings, the job ---------------------------------
assert.deepEqual(
  (await all("select role || ' ' || permission p from vppsone.role_permissions order by 1")).map((r) => r.p),
  ["academic_coordinator chats:reply", "accountant chats:reply", "admin chats:all", "admin chats:reply", "exam_coordinator chats:reply", "fee_collector chats:reply", "office chats:reply", "teacher chats:reply"],
);
assert.deepEqual(
  (await all("select key, body_params, url_button, status from vppsone.whatsapp_templates order by key")).map((r) => `${r.key} ${r.body_params} ${r.url_button} ${r.status}`),
  [
    "vpps_parent_school_message_en_v1 2 false not_submitted",
    "vpps_parent_school_message_hi_v1 2 false not_submitted",
    "vpps_staff_open_one_en_v1 2 true not_submitted",
    "vpps_staff_open_one_hi_v1 2 true not_submitted",
  ],
);
assert.deepEqual({ ...(await one("select enabled, nudges, live_minutes, first_nudge_minutes from vppsone.parent_chat_settings")) }, { enabled: true, nudges: true, live_minutes: 30, first_nudge_minutes: 2 });
const job = await one("select schedule, command from cron.job where jobname = 'parent-chats'");
assert.equal(job.schedule, "*/2 * * * *");
assert.match(job.command, /\/api\/jobs\/parent-chats/);
assert.match(job.command, /WHATSAPP_QUEUE_CRON_SECRET/);
assert.match(job.command, /where exists/);
console.log("PASS: chats:reply for every desk role and chats:all for the admin; four templates to submit; the job runs only when a nudge is due");

console.log("parent chats: all checks passed");
