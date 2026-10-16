import { notFound } from "next/navigation";
import { clientIp,limitByIp,limitByToken,limitUnknownToken } from "@/modules/collection/data/rate-limit";
import { resolveTaskToken,loadTaskWork } from "@/modules/teacher-tasks/data/repo";
import { TaskAcademicForm,TaskCollectionForm } from "@/modules/teacher-tasks/ui/task-work";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const metadata={title:"VPPS One",robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;const ip=await clientIp();if(!(await limitByIp(ip)).allowed||!(await limitByToken(token)).allowed)notFound();
  const task=await resolveTaskToken(token);if(!task){await limitUnknownToken(ip);notFound();}
  const work=await loadTaskWork({id:task.id,token});if(!work)notFound();
  return <main className="mx-auto min-h-dvh max-w-xl p-4"><h1 className="mb-4 text-xl font-semibold">{task.title}</h1>{work.collection?<TaskCollectionForm id={task.id} token={token} request={{...work.collection.request,token:""}} roll={work.collection.roll} language={work.language}/>:work.academic?<TaskAcademicForm key={`${task.id}:${work.academic.revision}`} token={token} work={work.academic} language={work.language}/>:null}</main>;
}
