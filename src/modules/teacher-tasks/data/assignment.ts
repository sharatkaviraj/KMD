import "server-only";
import { z } from "zod";
import { assertPermission } from "@/platform/auth/current-staff";
import { primary } from "@/platform/i18n/language";
import { FEE_SCHEMA } from "@/platform/env";
import { createAdminClient } from "@/platform/supabase/admin";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { readFeesBridgeState } from "@/platform/fees-bridge/state";
import { fetchAllRows } from "@/platform/supabase/paginate";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { resolveSessionLabel, classLabelMap } from "@/modules/academics/data/academics-repo";
import { listFieldsPublic } from "@/modules/collection/data/fields-repo";
import { planTasks, type TaskStudent, type TaskOwner, type TaskPlan } from "../domain/tasks";

export type AssignmentContext = { session: string; students: TaskStudent[]; owners: TaskOwner[]; fields: { id: string; key: string; labelHi: string; labelEn: string }[]; subjects: { id: string; label: string }[]; papers: { id: string; classId: string; subjectId: string; label: string }[] };
export const assignmentSchema = z.object({
  kind: z.enum(["collection", "marks", "attendance"]), title: z.string().trim().min(1).max(120),
  mode: z.enum(["common", "class", "house", "route", "subject"]), teacherId: z.uuid().optional(), subjectId: z.uuid().optional(),
  selectedIds: z.array(z.uuid()).min(1).max(2000), fieldIds: z.array(z.uuid()).max(30).default([]),
  overrides: z.record(z.string(), z.uuid()).default({}), paperId: z.uuid().optional(),
  day: z.iso.date().optional(), dueDate: z.iso.date().nullable(),
});
export type AssignmentInput = z.infer<typeof assignmentSchema>;
export type AssignmentPreview = TaskPlan & { previewId?: string; digest?: string; dueDate: string | null; fields: string[]; students: { id: string; name: string; classLabel: string }[] };

/** Authorized school-wide read. Values returned to the browser are only missing/present flags. */
export async function assignmentContext(): Promise<AssignmentContext> {
  const viewer=await assertPermission("collection:manage");
  const session = await resolveSessionLabel();
  if (!session) throw new Error("no_session");
  const canonical=usesCanonicalFees(viewer,session);
  if(canonical)await readFeesBridgeState();
  const db = createAdminClient();
  const [roll, fields, labels, profiles, classTeachers, scopes, assignments, subjects, papers] = await Promise.all([
    fetchAllRows<{ student_id: string; class_id: string }>((from,to) => db.from("enrolments").select("student_id,class_id").eq("session_label",session).eq("status","enrolled").order("student_id").range(from,to), "task roster"),
    listFieldsPublic(), classLabelMap(session),
    db.from("staff_profiles").select("id,display_name").eq("is_active",true).or("is_teaching.eq.true,role.eq.teacher").order("display_name").returns<{id:string;display_name:string}[]>(),
    db.from("class_teachers").select("staff_profile_id,class_id,effective_from,effective_to").eq("session_label",session).eq("role","class_teacher").returns<{staff_profile_id:string;class_id:string;effective_from:string;effective_to:string|null}[]>(),
    db.from("staff_scopes").select("staff_profile_id,kind,value").eq("session_label",session).returns<{staff_profile_id:string;kind:string;value:string}[]>(),
    fetchAllRows<{staff_profile_id:string;class_id:string;subject_id:string}>((from,to) => db.from("teaching_assignments").select("staff_profile_id,class_id,subject_id").eq("session_label",session).order("id").range(from,to), "subject assignments"),
    db.from("subjects").select("id,code").returns<{id:string;code:string}[]>(),
    fetchAllRows<{id:string;class_id:string;subject_id:string;class_label:string;subject_code:string;assessments:{label_en:string}}>((from,to) => db.from("assessment_subjects").select("id,class_id,subject_id,class_label,subject_code,assessments!inner(label_en,session_label,status)").eq("assessments.session_label",session).eq("assessments.status","open").order("id").range(from,to).returns<{id:string;class_id:string;subject_id:string;class_label:string;subject_code:string;assessments:{label_en:string}}[]>(), "open papers"),
  ]);
  for (const result of [profiles,classTeachers,scopes,subjects]) if (result.error) throw new Error("assignment_unavailable");
  const active = fields.filter(f => f.isActive);
  const ids = roll.map(r => r.student_id);
  const columns = [...new Set(["id","full_name","house","transport_route_id",...active.flatMap(f => f.feeColumn ? [f.feeColumn] : [])])];
  const [students, records, photos] = await Promise.all([
    fetchInChunks<Record<string,string|null>>(ids,IN_FILTER_CHUNK_SIZE,c => (canonical?db.from("fees_action_students"):db.schema(FEE_SCHEMA).from("students")).select(columns.join(",")).in("id",c).returns<Record<string,string|null>[]>()),
    // Page within each bounded student chunk: students × fields can exceed 1000.
    (async () => { const rows: {student_id:string;field_id:string;value:string|null}[]=[]; for(let i=0;i<ids.length;i+=IN_FILTER_CHUNK_SIZE) rows.push(...await fetchAllRows<{student_id:string;field_id:string;value:string|null}>((from,to) => db.from("student_records").select("student_id,field_id,value").in("student_id",ids.slice(i,i+IN_FILTER_CHUNK_SIZE)).order("student_id").order("field_id").range(from,to),"approved values")); return rows; })(),
    fetchInChunks<{student_id:string}>(ids,IN_FILTER_CHUNK_SIZE,c => db.from("student_photos").select("student_id").is("replaced_at",null).in("student_id",c)),
  ]);
  if (students.error || photos.error) throw new Error("students_unavailable");
  const studentOf = new Map(students.data.map(s => [s.id,s]));
  const recorded = new Map(records.map(r => [`${r.student_id}:${r.field_id}`,r.value]));
  const hasPhoto = new Set(photos.data.map(p => p.student_id));
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  return { session,
    students: roll.map(r => { const s=studentOf.get(r.student_id); if(!s) throw new Error("student_missing"); return { id:r.student_id,name:s.full_name??"-",classId:r.class_id,classLabel:labels.get(r.class_id)??"-",house:s.house||null,routeId:s.transport_route_id||null,hasPhoto:hasPhoto.has(r.student_id),values:Object.fromEntries(active.map(f => { const v=f.key==="student_photo" ? (hasPhoto.has(r.student_id)?"present":null) : recorded.get(`${r.student_id}:${f.id}`) ?? (f.feeColumn?s[f.feeColumn]:null); return [f.key,v?.trim()?"present":null]; })) }; }),
    owners:(profiles.data??[]).map(s => ({id:s.id,name:s.display_name,active:true,classIds:(classTeachers.data??[]).filter(c => c.staff_profile_id===s.id && c.effective_from<=today && (!c.effective_to||c.effective_to>=today)).map(c=>c.class_id),houses:(scopes.data??[]).filter(c=>c.staff_profile_id===s.id&&c.kind==="house").map(c=>c.value),routeIds:(scopes.data??[]).filter(c=>c.staff_profile_id===s.id&&c.kind==="route").map(c=>c.value),subjects:assignments.filter(a=>a.staff_profile_id===s.id).map(a=>({classId:a.class_id,subjectId:a.subject_id}))})),
    fields:active.map(f=>({id:f.id,key:f.key,labelHi:f.labelHi,labelEn:f.labelEn})), subjects:(subjects.data??[]).map(s=>({id:s.id,label:s.code})),
    papers:papers.map(p=>({id:p.id,classId:p.class_id,subjectId:p.subject_id,label:`${p.assessments.label_en} · ${p.class_label} · ${p.subject_code}`})),
  };
}

export async function previewAssignment(raw: unknown): Promise<AssignmentPreview> {
  const actor = await assertPermission("collection:manage");
  const input = assignmentSchema.parse(raw);
  const context = await assignmentContext();
  const db=createAdminClient();
  const canonical=usesCanonicalFees(actor,context.session);
  const canonicalStudents=async(classId:string,roster:{data:unknown;error:unknown}):Promise<TaskStudent[]>=>{
    if(roster.error||!Array.isArray(roster.data))throw new Error("roster_unavailable");
    const ids=roster.data as string[];
    const names=await fetchInChunks<{id:string;full_name:string}>(ids,IN_FILTER_CHUNK_SIZE,c=>(canonical?db.from("fees_action_students"):db.schema(FEE_SCHEMA).from("students")).select("id,full_name").eq("class_id",classId).in("id",c));
    const found=new Set(names.data.map(s=>s.id));
    if(names.error||names.data.length!==ids.length||ids.some(id=>!found.has(id)))throw new Error("roster_unavailable");
    return names.data.map(s=>({id:s.id,name:s.full_name,classId,classLabel:context.students.find(c=>c.classId===classId)?.classLabel??"-",house:null,routeId:null,values:{},hasPhoto:false}));
  };
  let chosen = context.students.filter(s=>input.selectedIds.includes(s.id));
  if(chosen.length!==new Set(input.selectedIds).size) throw new Error("selection_changed");
  if(input.kind==="marks") {
    const paper=context.papers.find(p=>p.id===input.paperId);
    if(!paper) throw new Error("paper_changed");
    // A paper is a whole canonical roster, even when requested from one child's profile.
    chosen=await canonicalStudents(paper.classId,await db.rpc("paper_roster",{p_paper:paper.id}));
    input.mode="subject"; input.subjectId=paper.subjectId;
  }
  if(input.kind==="attendance") {
    if(!input.day) throw new Error("day_required");
    input.mode="class";
    const classes=new Set(chosen.map(s=>s.classId));
    chosen=[];
    for(const classId of classes)chosen.push(...await canonicalStudents(classId,await db.rpc("attendance_roster",{p_session:context.session,p_class:classId,p_day:input.day})));
  }
  if(input.kind==="collection" && (!input.fieldIds.length || input.fieldIds.some(id=>!context.fields.some(f=>f.id===id)))) throw new Error("fields_required");
  const plan=planTasks(chosen,context.owners,{...input,selectedIds:chosen.map(s=>s.id)});
  const result: AssignmentPreview={...plan,dueDate:input.dueDate,fields:context.fields.filter(f=>input.fieldIds.includes(f.id)).map(f=>primary({hi:f.labelHi,en:f.labelEn},actor.language)),students:chosen.map(s=>({id:s.id,name:s.name,classLabel:s.classLabel}))};
  if(plan.blocked.length||plan.unassigned.length||!plan.groups.length) return result;
  const {data,error}=await createAdminClient().rpc("prepare_teacher_tasks",{p_actor:actor.id,p:{...input,session:context.session,groups:plan.groups.map(g=>({...g,members:chosen.filter(s=>g.studentIds.includes(s.id)).map(s=>({id:s.id,classId:s.classId,house:s.house,routeId:s.routeId}))}))}});
  if(error) throw new Error("preview_unavailable");
  return {...result,previewId:data.id as string,digest:data.digest as string};
}
