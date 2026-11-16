/** In-memory PostgreSQL proof that fully entered marks send themselves after
 * the marks due day (D-651): supabase/migrations/*_marks_send_themselves.sql
 * against synthetic neighbours shaped as One's are (exams, papers, marks, the
 * roll, class locks, the exam's activity, stand-ins for pg_cron). No URL,
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
const found = readdirSync(migrations).filter((name) => name.endsWith("_marks_send_themselves.sql"));
assert.equal(found.length, 1, "one marks_send_themselves migration");
const rollOnly = readdirSync(migrations).filter((name) => name.endsWith("_marks_send_themselves_roll_only.sql"));
assert.equal(rollOnly.length, 1, "one roll-only follow-up");
assert.ok(rollOnly[0] > found[0], "the follow-up comes after the job");
const migration = readFileSync(join(migrations, found[0]), "utf8");
const followUp = readFileSync(join(migrations, rollOnly[0]), "utf8");

// It applies without anybody standing by to confirm: nothing is taken away,
// nothing in public is touched, and nothing leaves the database.
for (const sql of [migration, followUp]) {
  const code = sql.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(code, /\b(drop|truncate|rename)\b/i, "adds only");
  assert.doesNotMatch(code, /\bdelete\s+from\b/i, "adds only");
  assert.doesNotMatch(code, /\bpublic\./i, "nothing in public");
  assert.doesNotMatch(code, /net\.http_post|message_sends|whatsapp/i, "sends nothing");
  assert.doesNotMatch(code, /results_published|parent/i, "never reaches parents");
}

const db = new PGlite();
await db.exec(`
create schema vppsone;
create role anon; create role authenticated; create role service_role;
create table vppsone.staff_profiles (id uuid primary key, display_name text not null default 'Staff');
create table vppsone.assessments (id uuid primary key, session_label text not null, status text not null default 'open');
create table vppsone.assessment_subjects (
  id uuid primary key, assessment_id uuid not null references vppsone.assessments(id), class_id uuid not null,
  class_label text not null, subject_code text not null, max_marks numeric(6,2) not null default 80,
  mark_step numeric(4,2) not null default 1, allow_exempt boolean not null default true,
  entry_status text not null default 'open', entry_revision integer not null default 0,
  submitted_by uuid references vppsone.staff_profiles(id), submitted_at timestamptz,
  constraint assessment_subjects_entry_status_known check (entry_status in ('open', 'submitted')),
  constraint assessment_subjects_submitted_together check ((entry_status = 'submitted') = (submitted_at is not null))
);
create table vppsone.marks (
  assessment_subject_id uuid not null references vppsone.assessment_subjects(id), student_id uuid not null,
  value numeric(6,2), absent boolean not null default false, exempt boolean not null default false,
  entered_at timestamptz not null default now() - interval '1 day', primary key (assessment_subject_id, student_id)
);
create table vppsone.exam_plans (assessment_id uuid primary key references vppsone.assessments(id), marks_due_on date);
create table vppsone.exam_class_locks (assessment_id uuid not null, class_id uuid not null, primary key (assessment_id, class_id));
create table vppsone.exam_activity (
  id uuid primary key default gen_random_uuid(), assessment_id uuid, kind text not null, text_en text not null,
  text_hi text, actor_staff_id uuid references vppsone.staff_profiles(id), created_at timestamptz not null default now()
);
create table vppsone.roll (paper_id uuid not null, student_id uuid not null);
create function vppsone.paper_roster(p_paper uuid) returns setof uuid language sql stable as $$
  select student_id from vppsone.roll where paper_id = p_paper
$$;
create function vppsone.school_today() returns date language sql stable as $$ select date '2026-11-16' $$;
-- One's own rule: a locked class takes no change to its papers.
create function vppsone.papers_respect_class_lock() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.entry_revision is distinct from old.entry_revision and exists (
    select 1 from vppsone.exam_class_locks l where l.assessment_id = new.assessment_id and l.class_id = new.class_id
  ) then raise exception 'marks:paper_locked'; end if;
  return new;
end; $$;
create trigger assessment_subjects_class_lock before update on vppsone.assessment_subjects
  for each row execute function vppsone.papers_respect_class_lock();
create schema cron;
create table cron.job (jobname text primary key, schedule text, command text);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job values (p_name, p_schedule, p_command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command;
  select 1::bigint;
$$;
grant usage on schema vppsone to anon, authenticated, service_role;
`);
await db.exec(migration);
await db.exec(followUp);
// Applying them twice changes nothing and fails nowhere.
await db.exec(migration);
await db.exec(followUp);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const all = async (sql, params = []) => (await db.query(sql, params)).rows.map((row) => ({ ...row }));

const TEACHER = id(1);
const EXAM = id(100); // marks were due yesterday
const TODAY_EXAM = id(101); // marks due today: the day is not over
const NO_DUE = id(102); // no due day set
const SWITCHED_OFF = id(103); // the office turned it off for this exam
const DRAFT_EXAM = id(104); // not taking marks
const CLASS = id(200);
const LOCKED_CLASS = id(201);
await db.exec(`
insert into vppsone.staff_profiles (id, display_name) values ('${TEACHER}', 'Test teacher');
insert into vppsone.assessments (id, session_label, status) values
  ('${EXAM}', 'TEST-2026-27', 'open'), ('${TODAY_EXAM}', 'TEST-2026-27', 'open'), ('${NO_DUE}', 'TEST-2026-27', 'open'),
  ('${SWITCHED_OFF}', 'TEST-2026-27', 'open'), ('${DRAFT_EXAM}', 'TEST-2026-27', 'draft');
insert into vppsone.exam_plans (assessment_id, marks_due_on) values
  ('${EXAM}', '2026-11-15'), ('${TODAY_EXAM}', '2026-11-16'), ('${NO_DUE}', null), ('${SWITCHED_OFF}', '2026-11-10'), ('${DRAFT_EXAM}', '2026-11-10');
update vppsone.exam_plans set marks_send_themselves = false where assessment_id = '${SWITCHED_OFF}';
insert into vppsone.exam_class_locks values ('${EXAM}', '${LOCKED_CLASS}');
`);

// Papers: name -> [exam, class, how its marks look]
const papers = {
  complete: [EXAM, CLASS],
  withAbsentAndExempt: [EXAM, CLASS],
  leftTheClass: [EXAM, CLASS], // children who left keep odd old marks the sheet no longer shows
  oneBlank: [EXAM, CLASS],
  missingRow: [EXAM, CLASS],
  typedJustNow: [EXAM, CLASS],
  overMax: [EXAM, CLASS],
  offStep: [EXAM, CLASS],
  exemptNotAllowed: [EXAM, CLASS],
  emptyRoll: [EXAM, CLASS],
  lockedClass: [EXAM, LOCKED_CLASS],
  dueToday: [TODAY_EXAM, CLASS],
  noDueDay: [NO_DUE, CLASS],
  switchedOff: [SWITCHED_OFF, CLASS],
  examNotOpen: [DRAFT_EXAM, CLASS],
  sentByPerson: [EXAM, CLASS],
};
const paperId = {};
let n = 300;
for (const [name, [exam, klass]] of Object.entries(papers)) {
  paperId[name] = id(n++);
  await db.query(
    `insert into vppsone.assessment_subjects (id, assessment_id, class_id, class_label, subject_code) values ($1, $2, $3, 'Class 6', $4)`,
    [paperId[name], exam, klass, name],
  );
  if (name === "emptyRoll") continue;
  for (const k of [1, 2, 3]) {
    const student = id(1000 + n * 10 + k);
    await db.query(`insert into vppsone.roll values ($1, $2)`, [paperId[name], student]);
    if (name === "missingRow" && k === 3) continue;
    const row = { value: 40 + k, absent: false, exempt: false, ago: "1 day" };
    if (name === "withAbsentAndExempt" && k === 2) Object.assign(row, { value: null, absent: true });
    if (name === "withAbsentAndExempt" && k === 3) Object.assign(row, { value: null, exempt: true });
    if (name === "oneBlank" && k === 3) row.value = null;
    if (name === "typedJustNow" && k === 1) row.ago = "30 minutes";
    if (name === "overMax" && k === 1) row.value = 95;
    if (name === "offStep" && k === 1) row.value = 40.5;
    if (name === "exemptNotAllowed" && k === 1) Object.assign(row, { value: null, exempt: true });
    await db.query(
      `insert into vppsone.marks values ($1, $2, $3, $4, $5, now() - $6::interval)`,
      [paperId[name], student, row.value, row.absent, row.exempt, row.ago],
    );
  }
  if (name === "leftTheClass") {
    // Off the roll: a half mark, one over the top, a blank. None of them count.
    for (const [k, value] of [[7, 66.5], [8, 95], [9, null]]) {
      await db.query(`insert into vppsone.marks values ($1, $2, $3, false, false, now() - interval '20 days')`, [paperId[name], id(1000 + n * 10 + k), value]);
    }
  }
}
await db.query(`update vppsone.assessment_subjects set allow_exempt = false where id = $1`, [paperId.exemptNotAllowed]);
await db.query(
  `update vppsone.assessment_subjects set entry_status = 'submitted', submitted_by = $2, submitted_at = '2026-11-14 10:00+05:30', entry_revision = 4 where id = $1`,
  [paperId.sentByPerson, TEACHER],
);

const state = async (name) =>
  one(`select entry_status, entry_revision, submitted_by, submitted_at, sent_itself_at from vppsone.assessment_subjects where id = $1`, [paperId[name]]);

// The ready check, paper by paper.
for (const [name, ready] of Object.entries({
  complete: true, withAbsentAndExempt: true, leftTheClass: true, oneBlank: false, missingRow: false, typedJustNow: false,
  overMax: false, offStep: false, exemptNotAllowed: false, emptyRoll: false,
})) {
  const got = await one(`select vppsone.marks_paper_ready_to_send($1) as ready`, [paperId[name]]);
  assert.equal(got.ready, ready, `${name} ready to send: ${ready}`);
}

const sent = await one(`select vppsone.marks_send_themselves(200) as n`);
assert.equal(sent.n, 3, "three papers go by themselves");

for (const name of ["complete", "withAbsentAndExempt", "leftTheClass"]) {
  const s = await state(name);
  assert.equal(s.entry_status, "submitted", `${name} sent`);
  assert.equal(s.entry_revision, 1, `${name}: an open sheet sees it moved`);
  assert.equal(s.submitted_by, null, `${name}: no person is named as the sender`);
  assert.ok(s.submitted_at, `${name}: when it went`);
  assert.equal(new Date(s.sent_itself_at).getTime(), new Date(s.submitted_at).getTime(), `${name}: reads as sent by itself`);
}
for (const name of ["oneBlank", "missingRow", "typedJustNow", "overMax", "offStep", "exemptNotAllowed", "emptyRoll", "lockedClass", "dueToday", "noDueDay", "switchedOff", "examNotOpen"]) {
  const s = await state(name);
  assert.equal(s.entry_status, "open", `${name} stays with the teacher`);
  assert.equal(s.entry_revision, 0, `${name} untouched`);
  assert.equal(s.sent_itself_at, null, `${name} never marked as sent by itself`);
}
const person = await state("sentByPerson");
assert.equal(person.submitted_by, TEACHER, "a paper a person sent keeps its sender");
assert.equal(person.entry_revision, 4, "and is not touched");
assert.equal(person.sent_itself_at, null);

const activity = await all(`select assessment_id, kind, text_en, text_hi, actor_staff_id from vppsone.exam_activity order by text_en`);
assert.equal(activity.length, 3, "one line in the exam's activity for each paper sent");
for (const line of activity) {
  assert.equal(line.assessment_id, EXAM);
  assert.equal(line.kind, "sent_itself");
  assert.equal(line.actor_staff_id, null, "no person did it");
  assert.match(line.text_en, /^Class 6 (complete|withAbsentAndExempt|leftTheClass) went to the exam office by itself/);
  assert.ok(line.text_hi.length > 10, "said in Hindi too");
}

// Running again sends nothing more and writes no second line.
assert.equal((await one(`select vppsone.marks_send_themselves(200) as n`)).n, 0, "a second run sends nothing");
assert.equal((await one(`select count(*)::int as n from vppsone.exam_activity`)).n, 3, "no line twice");

// The blank is filled, two quiet hours pass: it goes on the next run.
await db.query(`update vppsone.marks set value = 33, entered_at = now() - interval '3 hours' where assessment_subject_id = $1 and value is null`, [paperId.oneBlank]);
assert.equal((await one(`select vppsone.marks_send_themselves(200) as n`)).n, 1, "a paper finished late goes once quiet");
assert.equal((await state("oneBlank")).entry_status, "submitted");

// The office hands it back and the teacher sends it again: it no longer reads as sent by itself.
await db.query(`update vppsone.assessment_subjects set entry_status = 'open', submitted_by = null, submitted_at = null, entry_revision = entry_revision + 1 where id = $1`, [paperId.complete]);
await db.query(`update vppsone.assessment_subjects set entry_status = 'submitted', submitted_by = $2, submitted_at = now() + interval '1 minute', entry_revision = entry_revision + 1 where id = $1`, [paperId.complete, TEACHER]);
const resent = await state("complete");
assert.notEqual(new Date(resent.sent_itself_at).getTime(), new Date(resent.submitted_at).getTime(), "a person's send is not read as by itself");

// A class locked between the check and the send: that paper waits, the run does not fail.
await db.query(`update vppsone.marks set entered_at = now() - interval '1 day' where assessment_subject_id = $1`, [paperId.typedJustNow]);
await db.exec(`
create function vppsone.lock_on_send() returns trigger language plpgsql as $$
begin
  if new.entry_status = 'submitted' and old.entry_status = 'open' then
    insert into vppsone.exam_class_locks values (new.assessment_id, new.class_id) on conflict do nothing;
    raise exception 'marks:paper_locked';
  end if;
  return new;
end; $$;
create trigger lock_on_send before update on vppsone.assessment_subjects for each row execute function vppsone.lock_on_send();
`);
assert.equal((await one(`select vppsone.marks_send_themselves(200) as n`)).n, 0, "a paper refused under the lock is skipped");
assert.equal((await state("typedJustNow")).entry_status, "open");
await db.exec(`drop trigger lock_on_send on vppsone.assessment_subjects;`);

// Service role only, on the hour, inside the database.
for (const fn of ["vppsone.marks_send_themselves(integer)", "vppsone.marks_paper_ready_to_send(uuid)"]) {
  for (const role of ["anon", "authenticated"]) {
    const got = await one(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn]);
    assert.equal(got.ok, false, `${role} cannot run ${fn}`);
  }
  assert.equal((await one(`select has_function_privilege('service_role', $1, 'execute') as ok`, [fn])).ok, true);
}
const job = await one(`select schedule, command from cron.job where jobname = 'marks-send-themselves'`);
assert.equal(job.schedule, "7 * * * *");
assert.equal(job.command, "select vppsone.marks_send_themselves(200);");
assert.equal((await one(`select column_default from information_schema.columns where table_schema = 'vppsone' and table_name = 'exam_plans' and column_name = 'marks_send_themselves'`)).column_default, "true", "on unless the office turns it off");

await db.close();
console.log("PASS marks send themselves: fully entered, quiet papers go after the due day, whatever children who left the class left behind; blanks, misfits, locks, today, switched off and sent ones stay; service role only.");
