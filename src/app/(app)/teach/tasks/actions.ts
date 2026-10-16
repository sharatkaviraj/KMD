"use server";
import { revalidatePath } from "next/cache";
import { assertPermission, assertStaff } from "@/platform/auth/current-staff";
import { assertNotPreviewing } from "@/vx/view-as";
import { createAdminClient } from "@/platform/supabase/admin";
import { assignmentContext, previewAssignment } from "@/modules/teacher-tasks/data/assignment";
import { resolveTask } from "@/modules/teacher-tasks/data/repo";
import { resolveAssignedRequest } from "@/modules/collection/data/requests-repo";
import { submitCollectionPayload } from "@/modules/teacher-tasks/data/collection-save";
import { saveTaskAcademicWork } from "@/modules/teacher-tasks/data/save";
import type { LinkState } from "@/modules/collection/domain/link-state";
import { m } from "@/messages";

export async function taskAssignmentContextAction() { await assertPermission("collection:manage"); return assignmentContext(); }
export async function previewTeacherTasksAction(input: unknown) { await assertPermission("collection:manage"); await assertNotPreviewing(); return previewAssignment(input); }
export async function createTeacherTasksAction(previewId:string,digest:string):Promise<{id:string;reused:boolean;teacherId:string}[]> {
  const actor=await assertPermission("collection:manage"); await assertNotPreviewing();
  if(!/^[0-9a-f-]{36}$/i.test(previewId)||!/^[a-f0-9]{32}$/.test(digest))throw new Error("bad_preview");
  const {data,error}=await createAdminClient().rpc("create_teacher_tasks",{p_actor:actor.id,p_preview:previewId,p_digest:digest});
  if(error)throw new Error(error.message.includes("recipient_changed")?"existing_assignment":"assignment_changed");
  revalidatePath("/inbox");revalidatePath("/teach/tasks");return data;
}
export async function manageTeacherTaskAction(id:string,teacherId:string|null) {
  const actor=await assertPermission("collection:manage");await assertNotPreviewing();
  const {error}=await createAdminClient().rpc("manage_teacher_task",{p_actor:actor.id,p_id:id,p_teacher:teacherId});
  if(error)throw new Error("assignment_changed");revalidatePath("/inbox");revalidatePath("/teach/tasks");
}
export async function teacherTaskLinkAction(id:string):Promise<string> {
  await assertPermission("collection:manage");await assertNotPreviewing();
  const {data,error}=await createAdminClient().from("teacher_tasks").select("token").eq("id",id).is("revoked_at",null).single<{token:string}>();
  if(error)throw new Error("link_unavailable"); return `/t/tasks/${data.token}`;
}
export async function saveTeacherTaskAction(id:string,work:{kind:"marks"|"attendance";session?:string;payload:unknown}) {
  const actor=await assertStaff();await assertNotPreviewing();
  const task=await resolveTask({id,staffId:actor.id});
  if(!task||task.kind!==work.kind)return {ok:false,reason:"not_permitted"};
  const result=await saveTaskAcademicWork({id,staffId:actor.id},{...work,session:task.session_label});
  if(result.ok){revalidatePath("/teach/tasks");revalidatePath("/teach/marks");revalidatePath("/teach/attendance");revalidatePath("/inbox");}
  return result;
}
export async function saveTeacherCollectionAction(id:string,_previous:LinkState,form:FormData):Promise<LinkState> {
  const actor=await assertStaff();await assertNotPreviewing();
  const task=id.startsWith("collection-")?null:await resolveTask({id,staffId:actor.id});
  const requestId=id.startsWith("collection-")?id.slice(11):task?.request_id;
  const request=requestId?await resolveAssignedRequest(requestId,actor.id):null;
  if(!request)return {status:"error",message:m.linkClosed};
  let payload:unknown;try{payload=JSON.parse(String(form.get("payload")??""));}catch{return {status:"error",message:m.notSaved};}
  const result=await submitCollectionPayload(request,payload);revalidatePath("/teach/tasks");revalidatePath("/inbox");return result;
}

export async function restartTeacherTaskAction(id:string):Promise<string> {
  const actor=await assertPermission("collection:manage");await assertNotPreviewing();
  const {data,error}=await createAdminClient().rpc("restart_teacher_task",{p_actor:actor.id,p_id:id});
  if(error)throw new Error("assignment_changed");
  revalidatePath("/inbox");revalidatePath("/teach/tasks");return data.id;
}
