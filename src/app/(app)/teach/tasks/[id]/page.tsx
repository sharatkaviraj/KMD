import { notFound } from "next/navigation";
import { requirePermission } from "@/platform/auth/current-staff";
import { resolveAssignedRequest, rollForRequest } from "@/modules/collection/data/requests-repo";
import { loadTaskWork } from "@/modules/teacher-tasks/data/repo";
import { TaskAcademicForm, TaskCollectionForm } from "@/modules/teacher-tasks/ui/task-work";
import {createAdminClient} from "@/platform/supabase/admin";
export const runtime="nodejs";
export default async function Page({params}:{params:Promise<{id:string}>}) {
  const {id}=await params;const staff=await requirePermission("attendance:view", `/teach/tasks/${id}`);
  if(id.startsWith("collection-")){const request=await resolveAssignedRequest(id.slice(11),staff.id);if(!request)notFound();await createAdminClient().rpc("mark_teacher_task_opened",{p_id:request.id,p_staff:staff.id,p_token:null,p_request_token:null});return <main className="mx-auto max-w-xl p-4"><h1 className="mb-4 text-xl font-semibold">{request.titleEn}</h1><TaskCollectionForm id={id} request={{...request,token:""}} roll={await rollForRequest(request)} language={staff.language}/></main>;}
  const work=await loadTaskWork({id,staffId:staff.id});if(!work)notFound();
  return <main className="mx-auto max-w-xl p-4"><h1 className="mb-4 text-xl font-semibold">{work.task.title}</h1>{work.collection?<TaskCollectionForm id={id} request={{...work.collection.request,token:""}} roll={work.collection.roll} language={staff.language}/>:work.academic?<TaskAcademicForm key={`${id}:${work.academic.revision}`} work={work.academic} language={staff.language}/>:null}</main>;
}
