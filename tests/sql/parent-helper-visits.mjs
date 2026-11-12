/** In-memory PostgreSQL proof of a school visit booked on WhatsApp (D-592,
 * D-593): supabase/migrations/*_parent_helper_visits.sql against synthetic
 * enquiries, hand-offs and helper-chat tables shaped as One's are. No URL,
 * credentials or hosted database accepted: pass a local installed
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
const found = readdirSync(migrations).filter((name) => name.endsWith("_parent_helper_visits.sql"));
assert.equal(found.length, 1, "one _parent_helper_visits.sql migration");

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.parent_replies(id uuid primary key);
create table vppsone.enquiries (
  id uuid primary key default gen_random_uuid(),
  session_label text not null,
  stage text not null default 'enquiry',
  child_name text not null,
  class_label text,
  parent_name text,
  phone text,
  created_at timestamptz not null default now(),
  constraint enquiries_name check (length(btrim(child_name)) between 1 and 120),
  constraint enquiries_stage check (stage in ('enquiry', 'visited', 'form', 'admitted', 'closed'))
);
create table vppsone.parent_helper_chats (
  from_e164 text primary key,
  awaiting text,
  awaiting_until timestamptz,
  constraint parent_helper_chats_awaiting_check check (awaiting is null or awaiting ~ '^(teacher:[a-z0-9]{4,16}|office)$')
);
insert into vppsone.enquiries (session_label, child_name, class_label) values ('TEST-2026-27', 'Asha Test', 'Class 2');
`);
await db.exec(readFileSync(join(migrations, found[0]), "utf8"));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const REPLY = id(100);
const OTHER_REPLY = id(101);
await db.query("insert into vppsone.parent_replies(id) values ($1), ($2)", [REPLY, OTHER_REPLY]);
const rejects = async (sql, params, rule) => {
  await assert.rejects(db.query(sql, params), (error) => String(error.message).includes(rule), rule);
};

const before = (await db.query("select source, visit_on, visit_part, parent_reply_id from vppsone.enquiries")).rows;
assert.deepEqual(before.map((row) => ({ ...row })), [{ source: "office", visit_on: null, visit_part: null, parent_reply_id: null }]);
console.log("PASS: an enquiry from before reads office, with no visit");

// The write the helper makes: PostgREST's upsert with ignoreDuplicates is
// insert ... on conflict (parent_reply_id) do nothing.
const keep = `insert into vppsone.enquiries (session_label, stage, child_name, class_label, parent_name, phone, source, visit_on, visit_part, parent_reply_id)
  values ('TEST-2026-27', 'enquiry', $1, $2, 'Test Parent', '9000000001', 'whatsapp', $3, $4, $5)
  on conflict (parent_reply_id) do nothing returning id`;
assert.equal((await db.query(keep, ["Riya Test", "Class 3", "2026-11-16", "morning", REPLY])).rows.length, 1);
assert.equal((await db.query(keep, ["Riya Test", "Class 3", "2026-11-16", "morning", REPLY])).rows.length, 0);
assert.equal((await db.query(keep, ["-", null, "2026-11-17", "afternoon", OTHER_REPLY])).rows.length, 1);
assert.equal((await db.query("select count(*)::int n from vppsone.enquiries where source = 'whatsapp'")).rows[0].n, 2);
console.log("PASS: one enquiry per hand-off, so a repeated turn adds nothing");

await rejects(
  "insert into vppsone.enquiries (session_label, child_name, visit_on) values ('TEST-2026-27', 'Dev Test', '2026-11-16')",
  [],
  "enquiries_visit_whole",
);
await rejects(
  "insert into vppsone.enquiries (session_label, child_name, visit_part) values ('TEST-2026-27', 'Dev Test', 'morning')",
  [],
  "enquiries_visit_whole",
);
await rejects(
  "insert into vppsone.enquiries (session_label, child_name, visit_on, visit_part) values ('TEST-2026-27', 'Dev Test', '2026-11-16', 'evening')",
  [],
  "enquiries_visit_part_known",
);
await rejects(
  "insert into vppsone.enquiries (session_label, child_name, source) values ('TEST-2026-27', 'Dev Test', 'website')",
  [],
  "enquiries_source_known",
);
console.log("PASS: a visit is a day and a part together, the part is morning or afternoon, and the source is office or whatsapp");

for (let n = 0; n < 3; n += 1) {
  await db.query("insert into vppsone.enquiries (session_label, child_name) values ('TEST-2026-27', $1)", [`Office Test ${n}`]);
}
assert.equal((await db.query("select count(*)::int n from vppsone.enquiries where parent_reply_id is null")).rows[0].n, 4);
console.log("PASS: enquiries typed in at the office (no hand-off) are not held to one");

// The chat may now wait for the child's name and class after a slot.
await db.query("insert into vppsone.parent_helper_chats (from_e164) values ('+919000000001')");
const wait = "update vppsone.parent_helper_chats set awaiting = $1 where from_e164 = '+919000000001'";
for (const ok of ["visit:20261116am", "visit:20261116pm", "teacher:ab12cd34", "office", null]) {
  await db.query(wait, [ok]);
}
for (const bad of ["visit:2026111am", "visit:20261116xx", "visit:20261116", "visit:", "visits:20261116am"]) {
  await rejects(wait, [bad], "parent_helper_chats_awaiting_check");
}
console.log("PASS: the chat waits for visit:<yyyymmdd><am|pm> and nothing looser");

// Removing the hand-off from Messages keeps the enquiry on the board.
await db.query("delete from vppsone.parent_replies where id = $1", [REPLY]);
const after = (await db.query("select count(*)::int n, count(parent_reply_id)::int linked from vppsone.enquiries where source = 'whatsapp'")).rows[0];
assert.deepEqual({ ...after }, { n: 2, linked: 1 });
console.log("PASS: the enquiry outlives its hand-off");

const columns = (await db.query("select column_name from information_schema.columns where table_schema = 'vppsone' and table_name = 'enquiries' order by ordinal_position")).rows.map((row) => row.column_name);
assert.deepEqual(columns.slice(-4), ["visit_on", "visit_part", "source", "parent_reply_id"]);
assert.ok(!columns.some((name) => /words|body|message|text/.test(name)), "no column for the parent's words");
const described = (await db.query(
  "select count(*)::int n from pg_description where objoid = 'vppsone.enquiries'::regclass and objsubid > 0",
)).rows[0].n;
assert.equal(described, 4);
console.log("PASS: four new columns, each saying what it is for, and none for the parent's words");
