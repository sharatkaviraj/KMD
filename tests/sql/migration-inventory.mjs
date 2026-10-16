// Executable catalog evidence from the exact combined, unapplied migrations.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
const { PGlite } = require(process.argv[2] ?? "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const db = new PGlite();
const read = path => readFile(new URL(path, import.meta.url), "utf8");
try {
  await db.exec(await read("./teacher-tasks-fixture.sql"));
  await db.exec(await read("./profile-photos-fixture.sql"));
  await db.exec(await read("../../supabase/migrations/20261004121311_student_photos.sql"));
  const files = ["20261016070000_teacher_tasks.sql", "20261016080000_profile_photos.sql", "20261016090000_teacher_task_delivery.sql"];
  const migrations = [];
  for (const file of files) {
    if (file.includes("delivery")) await db.exec((await read("./teacher-task-delivery-fixture.sql")).replace(/^alter table vppsone.collection_fields.*;\r?\n/m,""));
    const source = await read(`../../supabase/migrations/${file}`);
    await db.exec(source);
    const names = [...source.matchAll(/create(?: or replace)? function vppsone\.([a-z_]+)/g)].map(m=>m[1]);
    const functions = (await db.query(`select p.proname as name,pg_get_function_identity_arguments(p.oid) as arguments,p.prosecdef as security_definer,p.proconfig as configuration,p.proacl::text as acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vppsone' and p.proname=any($1) order by p.proname`,[names])).rows;
    migrations.push({file,sha256:createHash("sha256").update(source).digest("hex"),functions});
  }
  const names=["teacher_tasks","teacher_task_previews","photo_proposals","staff_photos","collection_submissions","message_sends"];
  const catalog = {
    engine: (await db.query("select version() v")).rows[0].v,
    target: "wtgxcptmucjerhufzjcf", excluded: "vgqyilgstjvgohrsiwkb", appliedRemotely: false,
    migrations,
    tables:(await db.query("select c.relname,c.relrowsecurity,c.relacl::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vppsone' and c.relname=any($1) order by c.relname",[names.slice(0,4)])).rows,
    indexes:(await db.query("select tablename,indexname,indexdef from pg_indexes where schemaname='vppsone' and (tablename=any($1) or indexname='message_sends_task_round') order by indexname",[names.slice(0,4)])).rows,
    triggers:(await db.query("select t.tgname,pg_get_triggerdef(t.oid) definition from pg_trigger t where t.tgname in ('teacher_task_review_admin','photo_answer_bound','teacher_task_delivery_guard') order by t.tgname")).rows,
    policies:(await db.query("select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where policyname='message_sends_task_private' or tablename=any($1)",[names.slice(0,4)])).rows,
    messageColumns:(await db.query("select column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='vppsone' and table_name='message_sends' and column_name like 'task_%' order by ordinal_position")).rows,
    taskContracts:(await db.query("select code,variables,has_url_button,is_active from vppsone.message_templates where code like 'vppsone_teacher_task%' order by code")).rows,
  };
  await writeFile(new URL("../../docs/evidence/sampark-workflows/migration-catalog.json",import.meta.url),JSON.stringify(catalog,null,2)+"\n");
  console.log(JSON.stringify(migrations.map(({file,sha256,functions})=>({file,sha256,functions:functions.length})),null,2));
  console.log("PASS: all three exact migrations applied together to synthetic prerequisites; catalog written.");
} finally { await db.close(); }
