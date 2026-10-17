// Synthetic actual-migration regression. --baseline demonstrates the original
// refusal gap from the reviewed commit; it never edits the working SQL file.
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const require=createRequire(import.meta.url);
const {PGlite}=require(process.argv[2] && process.argv[2]!=="--baseline" ? process.argv[2] : "../../../sql-test-runtime/node_modules/@electric-sql/pglite");
const db=new PGlite();
try {
  await db.exec(await readFile(new URL("./teacher-tasks-fixture.sql",import.meta.url),"utf8"));
  const file="supabase/migrations/20261016070000_teacher_tasks.sql";
  const sql=process.argv.includes("--baseline")?execFileSync("git",["show",`88c7923:${file}`],{encoding:"utf8"}):await readFile(new URL(`../../${file}`,import.meta.url),"utf8");
  await db.exec(sql);
  const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const [actor,teacher,replacement,child,field,request,task,legacy]=Array.from({length:8},(_,i)=>id(i+1));
  await db.query("insert into vppsone.staff_profiles(id,role,is_active,is_teaching) values($1,'admin',true,false),($2,'teacher',true,true),($3,'teacher',true,true)",[actor,teacher,replacement]);
  await db.exec("insert into vppsone.role_permissions values('admin','collection:manage')");
  await db.query("insert into public.students values($1,'Synthetic',null,null,null)",[child]);
  await db.query("insert into vppsone.enrolments values($1,$2,'QA','enrolled','1')",[child,id(99)]);
  await db.query("insert into vppsone.collection_fields values($1,'note',null,true)",[field]);
  for(const r of [request,legacy]) {
    await db.query("insert into vppsone.collection_requests(id,session_label,assigned_staff_id,token,status) values($1,'QA',$2,'original-request','open')",[r,teacher]);
    await db.query("insert into vppsone.collection_request_members values($1,$2,'1','{}')",[r,child]);
    await db.query("insert into vppsone.collection_request_fields values($1,$2)",[r,field]);
  }
  await db.query(`insert into vppsone.teacher_tasks(id,session_label,kind,request_id,scope,assigned_staff_id,title,source_key,token,created_by) values($1,'QA','collection',$2,'{"kind":"common","value":"selected"}',$3,'Synthetic','synthetic-source','original-task',$4)`,[task,request,teacher,actor]);
  const answers=[{studentId:child,fieldId:field,value:"proposal",previousValue:null}];
  const scalar=async(sql,args)=>(await db.query(sql,args)).rows[0].result;
  const save=(token,requestToken,staff=null)=>scalar("select vppsone.save_teacher_task($1,$2,$3,$4) result",[task,staff,token,{kind:"collection",request_id:request,request_token:requestToken,answers}]);
  assert.equal((await save("original-task","original-request")).ok,true,"collection task must use original-credential-aware canonical writer");
  for(const nextTeacher of [teacher,replacement]) {
    const old=(await db.query("select token from vppsone.teacher_tasks where id=$1",[task])).rows[0].token;
    await db.query("select vppsone.manage_teacher_task($1,$2,$3)",[actor,task,nextTeacher]);
    const current=(await db.query("select token from vppsone.collection_requests where id=$1",[request])).rows[0].token;
    assert.equal((await save(old,current)).ok,false,"old task credential cannot borrow replacement request generation");
    if(nextTeacher===replacement)assert.equal((await save(null,current,teacher)).ok,false,"old authenticated actor cannot borrow reassigned request");
    assert.equal((await save(null,current,nextTeacher)).ok,true);
  }
  const writeLegacy=()=>scalar("select vppsone.record_collection_answers($1,'original-request',$2) result",[legacy,answers]);
  assert.equal(await writeLegacy(),1);
  await db.query("update vppsone.collection_requests set status='closed' where id=$1",[legacy]);
  await assert.rejects(writeLegacy,/not_permitted/);
  await db.query("update vppsone.collection_requests set status='open',token='rotated' where id=$1",[legacy]);
  await assert.rejects(writeLegacy,/not_permitted/);
  console.log("PASS: original task credential survives same-teacher rotation and reassignment; installed unmanaged requests enforce closed/rotated authority.");
} finally {await db.close();}
