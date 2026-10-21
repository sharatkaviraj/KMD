import "server-only";
import { assertPermission, assertStaff } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveLanguage, type Language } from "@/platform/i18n/language";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { fetchInChunks, mapConcurrently } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { can } from "@/platform/auth/permissions";
import { FEE_SCHEMA } from "@/platform/env";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { resolveAssignedRequest, rollForRequest } from "@/modules/collection/data/requests-repo";
import type { CollectionRequest, RollRow } from "@/modules/collection/domain/requests";
import type { AttendanceStatus } from "@/modules/attendance/domain/attendance";
import { mergeTaskSummaries, taskProgress, type TaskKind, type TaskScope, type TaskSummary } from "../domain/tasks";
import type { TaskCredential } from "./save";
import { academicDraftScope, collectionDraftScope } from "./draft-scope";
import { attendanceCalendar } from "@/modules/attendance/data/attendance-repo";
import { isSchoolOpen } from "@/modules/academics/domain/calendar";

export type TaskRow = { id:string; session_label:string; kind:TaskKind; request_id:string|null; paper_id:string|null; class_id:string|null; day:string|null; scope:TaskScope; assigned_staff_id:string; title:string; due_date:string|null; revoked_at:string|null; opened_at:string|null };
const COLUMNS="id,session_label,kind,request_id,paper_id,class_id,day,scope,assigned_staff_id,title,due_date,revoked_at,opened_at";
export type AcademicWork = { kind:"marks"|"attendance"; taskId:string; draftScope:string; session:string; paperId:string|null; classId:string|null; day:string|null; revision:number; submitted:boolean; max:number; step:number; allowExempt:boolean; rows:{id:string;name:string;state:string;value:number|null}[] };
export type TaskWork = { task:TaskRow; language:Language; collection?:{request:CollectionRequest;roll:RollRow[];draftScope:string}; academic?:AcademicWork };

/** No capability or peer list is returned by this read. Rechecked on every save. */
export async function resolveTask(auth: TaskCredential): Promise<TaskRow|null> {
  if(!/^[0-9a-f-]{36}$/i.test(auth.id)) return null;
  const db=createAdminClient();
  const {data:allowed,error}=await db.rpc("teacher_task_access",{p_id:auth.id,p_staff:auth.staffId??null,p_token:auth.token??null});
  if(error||allowed!==true) return null;
  const row=await db.from("teacher_tasks").select(`${COLUMNS},token`).eq("id",auth.id).maybeSingle<TaskRow & {token:string}>();
  if(row.error) throw new Error("task_unavailable");
  if(!row.data || (auth.token && row.data.token!==auth.token) || (auth.staffId && row.data.assigned_staff_id!==auth.staffId))return null;
  const current=await db.rpc("teacher_task_access",{p_id:auth.id,p_staff:auth.staffId??null,p_token:auth.token??null});
  if(current.error||current.data!==true)return null;
  const {token: capability,...task}=row.data;
  void capability;
  return task;
}
export async function resolveTaskToken(token:string):Promise<TaskRow|null> {
  if(!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const {data,error}=await createAdminClient().from("teacher_tasks").select("id").eq("token",token).maybeSingle<{id:string}>();
  return error||!data?null:resolveTask({id:data.id,token});
}
export async function loadTaskWork(auth:TaskCredential):Promise<TaskWork|null> {
  const task=await resolveTask(auth); if(!task) return null;
  const db=createAdminClient();
  const {data:staff,error:staffError}=await db.from("staff_profiles").select("preferred_language").eq("id",task.assigned_staff_id).single<{preferred_language:string}>();
  if(staffError) throw new Error("task_unavailable");
  const language=resolveLanguage(staff.preferred_language);
  await db.rpc("mark_teacher_task_opened",{p_id:task.id,p_staff:auth.staffId??null,p_token:auth.token??null,p_request_token:null});
  if(task.kind==="collection" && task.request_id) {
    const request=await resolveAssignedRequest(task.request_id,task.assigned_staff_id);
    if(!request) return null;
    const roll=await rollForRequest(request);
    const draftScope=collectionDraftScope({requestId:request.id,actorId:auth.staffId??null,taskToken:auth.token??null,requestToken:request.token,session:request.sessionLabel,studentIds:roll.map(r=>r.studentId),fieldIds:request.fields.map(f=>f.id)});
    const generation=await db.from("collection_requests").select("id").eq("id",request.id).eq("token",request.token).eq("status","open").is("archived_at",null).maybeSingle();
    const current=await db.rpc("teacher_task_access",{p_id:auth.id,p_staff:auth.staffId??null,p_token:auth.token??null});
    if(generation.error||!generation.data||current.error||current.data!==true)return null;
    return {task,language,collection:{request,roll,draftScope}};
  }
  const roster=task.kind==="marks"?await db.rpc("paper_roster",{p_paper:task.paper_id}):await db.rpc("attendance_roster",{p_session:task.session_label,p_class:task.class_id,p_day:task.day});
  if(roster.error) throw new Error("roster_unavailable");
  const ids=(roster.data??[]) as string[];
  const capability=await db.from("teacher_tasks").select("token").eq("id",task.id).single<{token:string}>();
  if(capability.error) throw new Error("task_unavailable");
  if(auth.token && capability.data.token!==auth.token) return null;
  const draftScope=academicDraftScope({taskId:task.id,actorId:auth.staffId??null,token:capability.data.token,session:task.session_label,scope:task.scope,studentIds:ids});
  const names=await fetchInChunks<{id:string;full_name:string}>(ids,IN_FILTER_CHUNK_SIZE,c=>db.schema(FEE_SCHEMA).from("students").select("id,full_name").in("id",c));
  if(names.error) throw new Error("names_unavailable");
  const nameOf=new Map(names.data.map(s=>[s.id,s.full_name]));
  const academic:AcademicWork={kind:task.kind as "marks"|"attendance",taskId:task.id,draftScope,session:task.session_label,paperId:task.paper_id,classId:task.class_id,day:task.day,revision:0,submitted:false,max:100,step:1,allowExempt:false,rows:ids.map(id=>({id,name:nameOf.get(id)??"-",state:task.kind==="marks"?"blank":"present",value:null}))};
  if(task.kind==="marks") {
    const {data:paper,error}=await db.from("assessment_subjects").select("entry_revision,entry_status,max_marks,mark_step,allow_exempt").eq("id",task.paper_id!).single<{entry_revision:number;entry_status:string;max_marks:number;mark_step:number;allow_exempt:boolean}>();
    if(error) throw new Error("paper_unavailable");
    const marks=await fetchAllRows<{student_id:string;value:number|null;absent:boolean;exempt:boolean}>((from,to)=>db.from("marks").select("student_id,value,absent,exempt").eq("assessment_subject_id",task.paper_id!).order("student_id").range(from,to),"marks");
    academic.revision=paper.entry_revision; academic.submitted=paper.entry_status==="submitted";academic.max=Number(paper.max_marks);academic.step=Number(paper.mark_step);academic.allowExempt=paper.allow_exempt;
    for(const row of academic.rows) {const mark=marks.find(m=>m.student_id===row.id);if(mark){row.state=mark.absent?"absent":mark.exempt?"exempt":mark.value===null?"blank":"value";row.value=mark.value===null?null:Number(mark.value);}}
  } else {
    const {data:register,error}=await db.from("attendance_registers").select("id,revision").eq("session_label",task.session_label).eq("class_id",task.class_id!).eq("day",task.day!).is("period",null).maybeSingle<{id:string;revision:number}>();
    if(error) throw new Error("register_unavailable");
    if(register){academic.revision=register.revision;academic.submitted=register.revision>0;
      const marks=await fetchAllRows<{student_id:string;status:AttendanceStatus}>((from,to)=>db.from("attendance_marks").select("student_id,status").eq("register_id",register.id).order("student_id").range(from,to),"attendance");
      for(const row of academic.rows) row.state=marks.find(m=>m.student_id===row.id)?.status??"present";
    }
  }
  return {task,language,academic};
}

async function summary(t:TaskRow, office:boolean):Promise<TaskSummary> {
  const db=createAdminClient();
  let state:TaskSummary["state"]="waiting", expected=0,answered=0,rejected=0;
  if(t.kind==="collection") {
    const [members,fields,answers]=await Promise.all([
      db.from("collection_request_members").select("student_id",{count:"exact",head:true}).eq("request_id",t.request_id!),
      db.from("collection_request_fields").select("field_id",{count:"exact",head:true}).eq("request_id",t.request_id!),
      fetchAllRows<{status:string}>((from,to)=>db.from("collection_submissions").select("status").eq("request_id",t.request_id!).order("id").range(from,to),"task progress"),
    ]);
    if(members.error||fields.error) throw new Error("progress_unavailable");
    expected=(members.count??0)*(fields.count??0);answered=answers.length;rejected=answers.filter(a=>a.status==="rejected").length;
    state=taskProgress({kind:"collection",expected,answered,approved:answers.filter(a=>a.status==="accepted").length,rejected:answers.filter(a=>a.status==="rejected").length});
  } else if(t.kind==="marks") {
    const r=await db.from("assessment_subjects").select("entry_status").eq("id",t.paper_id!).single<{entry_status:string}>();if(r.error)throw new Error("progress_unavailable");state=taskProgress({kind:"marks",submitted:r.data.entry_status==="submitted"});
  } else {
    const r=await db.from("attendance_registers").select("revision").eq("class_id",t.class_id!).eq("session_label",t.session_label).eq("day",t.day!).is("period",null).maybeSingle<{revision:number}>();if(r.error)throw new Error("progress_unavailable");state=taskProgress({kind:"attendance",revision:r.data?.revision??0});
  }
  const access=await db.rpc("teacher_task_access",{p_id:t.id,p_staff:t.assigned_staff_id,p_token:null});
  if(access.error)throw new Error("authority_unavailable");
  if(t.revoked_at)state="revoked";else if(!access.data)state="to-assign";
  const staff=await db.from("staff_profiles").select("display_name").eq("id",t.assigned_staff_id).maybeSingle<{display_name:string}>();
  return {id:t.id,kind:t.kind,title:t.title,sourceKey:t.kind==="collection"?`collection:${t.request_id}`:t.kind==="marks"?`marks:${t.paper_id}`:`attendance:${t.session_label}:${t.class_id}:${t.day}`,teacherId:t.assigned_staff_id,teacherName:staff.data?.display_name??null,dueDate:t.due_date,state,expected,answered,rejected,href:office?`/inbox?task=${t.id}`:`/teach/tasks/${t.id}`,openedAt:t.opened_at};
}
/**
 * A teacher's (or the office's) task list. `now` is the reader's school clock
 * (the lab clock for a test account), so "today's attendance" is the school's
 * today; on a closed day there is no attendance task (smoke 20 Oct: My tasks
 * asked for attendance on Dussehra, dated by the real day). `only` keeps the
 * kinds a caller shows, so Today reads just the office's requests.
 */
export async function listTeacherTasks(office=false, opts:{now?:Date;only?:TaskKind[]}={}):Promise<TaskSummary[]> {
  const wants=(k:TaskKind)=>!opts.only||opts.only.includes(k);
  const actor=office?await assertPermission("collection:manage"):await assertStaff();
  const session=await resolveSessionLabel();if(!session)return [];
  const db=createAdminClient();
  const rows=await fetchAllRows<TaskRow>((from,to)=>{let q=db.from("teacher_tasks").select(COLUMNS).eq("session_label",session);if(!office)q=q.eq("assigned_staff_id",actor.id);if(opts.only)q=q.in("kind",opts.only);return q.order("created_at",{ascending:false}).order("id").range(from,to);},"teacher tasks");
  const tasks=await mapConcurrently(rows,4,t=>summary(t,office));
  if(!office) {
    // Existing requests/papers/registers remain canonical and appear without minting tokens.
    const legacy=await fetchAllRows<{id:string;title_en:string;due_date:string|null}>((from,to)=>db.from("collection_requests").select("id,title_en,due_date").eq("session_label",session).eq("assigned_staff_id",actor.id).eq("status","open").is("archived_at",null).order("id").range(from,to),"assigned requests");
    for(const r of wants("collection")?legacy:[]) {
      if(tasks.some(t=>t.sourceKey===`collection:${r.id}`))continue;
      const request=await resolveAssignedRequest(r.id,actor.id); if(!request)continue;
      const roll=await rollForRequest(request);const expected=roll.length*request.fields.length;
      const answers=await fetchAllRows<{status:string}>((from,to)=>db.from("collection_submissions").select("status").eq("request_id",r.id).order("id").range(from,to),"task progress");
      tasks.push({id:`collection-${r.id}`,sourceKey:`collection:${r.id}`,kind:"collection",title:r.title_en,teacherId:actor.id,teacherName:actor.displayName,dueDate:r.due_date,state:taskProgress({kind:"collection",expected,answered:answers.length,approved:answers.filter(a=>a.status==="accepted").length,rejected:answers.filter(a=>a.status==="rejected").length}),expected,answered:answers.length,rejected:answers.filter(a=>a.status==="rejected").length,href:`/teach/tasks/collection-${r.id}`,openedAt:null});
    }
    if(wants("marks")){
    const assignments=await fetchAllRows<{class_id:string;subject_id:string}>((from,to)=>db.from("teaching_assignments").select("class_id,subject_id").eq("session_label",session).eq("staff_profile_id",actor.id).order("id").range(from,to),"teaching assignments");
    const papers=await fetchAllRows<{id:string;class_id:string;subject_id:string;class_label:string;subject_code:string;entry_status:string}>((from,to)=>db.from("assessment_subjects").select("id,class_id,subject_id,class_label,subject_code,entry_status,assessments!inner(session_label,status)").eq("assessments.session_label",session).eq("assessments.status","open").order("id").range(from,to),"assigned marks");
    for(const p of papers.filter(p=>can(actor,"marks:write")&&assignments.some(a=>a.class_id===p.class_id&&a.subject_id===p.subject_id))) tasks.push({id:`paper-${p.id}`,sourceKey:`marks:${p.id}`,kind:"marks",title:`${p.class_label} · ${p.subject_code}`,teacherId:actor.id,teacherName:actor.displayName,dueDate:null,state:taskProgress({kind:"marks",submitted:p.entry_status==="submitted"}),expected:0,answered:0,href:`/teach/marks?paper=${p.id}`,openedAt:null});
    }
    if(wants("attendance")){
    const day=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(opts.now??new Date());
    const calendar=await attendanceCalendar(session).catch(()=>null);
    const open=calendar?isSchoolOpen(day,calendar):true;
    const ct=await db.from("class_teachers").select("class_id").eq("session_label",session).eq("staff_profile_id",actor.id).eq("role","class_teacher").lte("effective_from",day).or(`effective_to.is.null,effective_to.gte.${day}`).returns<{class_id:string}[]>();
    if(ct.error)throw new Error("classes_unavailable");
    for(const c of open&&can(actor,"attendance:mark")?ct.data:[]) {const r=await db.from("attendance_registers").select("revision").eq("session_label",session).eq("class_id",c.class_id).eq("day",day).is("period",null).maybeSingle<{revision:number}>();if(r.error)throw new Error("register_unavailable");tasks.push({id:`attendance-${c.class_id}`,sourceKey:`attendance:${session}:${c.class_id}:${day}`,kind:"attendance",title:day,teacherId:actor.id,teacherName:actor.displayName,dueDate:day,state:taskProgress({kind:"attendance",revision:r.data?.revision??0}),expected:0,answered:0,href:`/teach/attendance?class=${c.class_id}&day=${day}`,openedAt:null});}
    }
  }
  return mergeTaskSummaries(tasks).filter(t=>office||!["to-assign","revoked"].includes(t.state));
}
