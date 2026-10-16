// No connection string or .env: canonical record writer in disposable PGlite.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const db = new PGlite();
const sql = path => readFile(new URL(path, import.meta.url), "utf8");
const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
try {
  await db.exec(await sql("./teacher-tasks-fixture.sql"));
  await db.exec(`
    create type vppsone.record_source as enum('teacher','office','import');
    alter table vppsone.student_records add column id uuid default gen_random_uuid(), add column session_label text,
      add column source vppsone.record_source, add column source_submission_id uuid, add column recorded_by uuid,
      add column updated_at timestamptz default now();
    alter table vppsone.collection_submissions add column decided_at timestamptz, add column decision_note text;
    create function vppsone.staff_can_any(text[]) returns boolean language sql as $$select true$$;
    create function vppsone.reads_every_class() returns boolean language sql as $$select true$$;
    create function vppsone.flag_enabled(text) returns boolean language sql as $$select false$$;
  `);
  await db.exec(await sql("../../supabase/migrations/20261004100729_record_writer_and_history.sql"));
  await db.exec(await sql("../../supabase/migrations/20261016070000_teacher_tasks.sql"));
  const [admin, office, teacher, request, child, field, answer] = [1,2,3,4,5,6,7].map(id);
  await db.query("insert into vppsone.staff_profiles(id,role,is_active) values($1,'admin',true),($2,'office',true),($3,'teacher',true)",[admin,office,teacher]);
  await db.exec("insert into vppsone.role_permissions values('admin','collection:manage'),('office','collection:manage')");
  await db.query("insert into vppsone.collection_requests(id,session_label,assigned_staff_id,status,token) values($1,'QA',$2,'open','synthetic-legacy-capability')",[request,teacher]);
  await db.query("insert into vppsone.collection_fields(id,key,is_active) values($1,'note',true)",[field]);
  await db.query("insert into vppsone.collection_submissions(id,request_id,student_id,field_id,value,status,submitted_at) values($1,$2,$3,$4,'proposed detail','pending',now())",[answer,request,child,field]);
  const count = async table => (await db.query(`select count(*)::int n from vppsone.${table}`)).rows[0].n;
  assert.equal(await count("teacher_tasks"),0, "legacy /r request has no managed task");
  const command = (actor,decision,n) => ({command_id:id(n),actor_staff_id:actor,session_label:"QA",payload_hash:`synthetic-${n}`,decision,submission_ids:[answer]});
  const decide = payload => db.query("select vppsone.accept_submissions($1) result",[payload]);
  await assert.rejects(()=>decide(command(office,"accept",10)),/admin_review_required/);
  await assert.rejects(()=>decide(command(office,"reject",11)),/admin_review_required/);
  assert.equal(await count("student_records"),0);
  assert.equal(await count("student_record_history"),0);
  assert.equal(await count("record_commands"),0);
  assert.equal((await db.query("select status from vppsone.collection_submissions")).rows[0].status,"pending");
  const accepted = command(admin,"accept",12);
  assert.equal((await decide(accepted)).rows[0].result.recorded,1);
  assert.equal((await decide(accepted)).rows[0].result.replayed,true);
  assert.equal(await count("student_record_history"),1);
  assert.equal((await db.query("select source,actor_staff_id from vppsone.student_record_history")).rows[0].actor_staff_id,admin);
  await db.query("update vppsone.collection_submissions set status='pending' where id=$1",[answer]);
  assert.equal((await db.query("select status from vppsone.collection_submissions")).rows[0].status,"accepted");
  // An unrelated office/direct record write keeps its existing policy and provenance.
  assert.equal((await db.query("select vppsone.write_student_value($1,$2,'QA','office detail','office',null,'synthetic-direct',null,$3,$4) result",[child,field,id(13),office])).rows[0].result,"written");
  assert.equal(await count("student_record_history"),2);
  console.log("PASS: actual canonical accept_submissions/write_student_value; legacy teacher /r without task refuses office acceptance/rejection atomically; admin write and exact replay; decided proposal cannot reopen; unrelated office direct writer preserved.");
} finally { await db.close(); }
