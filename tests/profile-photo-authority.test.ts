import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({staff:{id:"00000000-0000-4000-8000-000000000001",role:"teacher"},rpc:vi.fn(),task:vi.fn(),token:vi.fn(),request:vi.fn(),roll:vi.fn(),from:vi.fn(),sign:vi.fn(),allowed:true}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/auth/current-staff",()=>({assertStaff:async()=>m.staff}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:async()=>{}}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc:m.rpc,from:m.from,storage:{from:()=>({createSignedUrl:m.sign})}})}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:async()=>"SYNTHETIC"}));
vi.mock("@/modules/teacher-tasks/data/repo",()=>({resolveTask:m.task,resolveTaskToken:m.token}));
vi.mock("@/modules/collection/data/requests-repo",()=>({resolveAssignedRequest:m.request,resolveToken:m.request,rollForRequest:m.roll}));
vi.mock("@/modules/collection/data/rate-limit",()=>({clientIp:async()=>"synthetic",limitByIp:async()=>({allowed:true}),limitByToken:async()=>({allowed:true}),limitUnknownToken:async()=>{}}));
import { photoAuthority, readPhotoContext } from "@/modules/collection/data/profile-photo-context";
import { assignedRequestGeneration } from "@/modules/teacher-tasks/data/draft-scope";
const student="00000000-0000-4000-8000-000000000002",task="00000000-0000-4000-8000-000000000003";
const request={id:"request",token:"synthetic-request-generation",sessionLabel:"SYNTHETIC",fields:[{id:"field",key:"student_photo"}]};
beforeEach(()=>{
  vi.clearAllMocks();m.staff.role="teacher";m.allowed=true;
  m.rpc.mockImplementation(async(name:string)=>({data:name==="teacher_task_access"?m.allowed:task,error:null}));
  m.task.mockResolvedValue({id:task,request_id:request.id,assigned_staff_id:m.staff.id,kind:"collection"});m.token.mockResolvedValue({id:task,request_id:request.id,assigned_staff_id:m.staff.id,kind:"collection"});m.request.mockResolvedValue(request);m.roll.mockResolvedValue([{studentId:student}]);
  m.sign.mockResolvedValue({data:{signedUrl:"private:synthetic-approved-photo"},error:null});
  m.from.mockImplementation((table:string)=>{
    const data=table==="collection_requests"?{id:request.id}:table==="student_photos"?{id:"portrait",storage_path:"synthetic-approved.jpg"}:null;
    const q={select:()=>q,eq:()=>q,is:()=>q,maybeSingle:async()=>({data,error:null})};return q;
  });
});
it("signed-in and public task entry resolve the same canonical request, with separate recovery authority",async()=>{
  const signed=await photoAuthority({kind:"task",id:task},student);
  const publicEntry=await photoAuthority({kind:"task",id:task,token:"synthetic-task-capability"},student);
  expect(signed.request?.id).toBe(publicEntry.request?.id);expect(signed.scope).not.toBe(publicEntry.scope);
  expect(m.task).toHaveBeenCalledWith({id:task,staffId:m.staff.id});expect(m.token).toHaveBeenCalledWith("synthetic-task-capability");
});
it("opens the existing assigned legacy request with an actor-bound generation and creates no task",async()=>{
  const legacy={...request,id:task};m.request.mockResolvedValue(legacy);
  const credential={kind:"assigned-request" as const,id:task,generation:assignedRequestGeneration(m.staff.id,task,legacy.token)};
  const auth=await photoAuthority(credential,student);expect(auth.request?.id).toBe(task);
  expect(m.request).toHaveBeenCalledWith(task,m.staff.id);expect(m.task).not.toHaveBeenCalled();expect(m.rpc).not.toHaveBeenCalled();
  m.request.mockResolvedValue({...legacy,token:"rotated"});await expect(photoAuthority(credential,student)).rejects.toThrow("not_permitted");
  m.request.mockResolvedValue(legacy);await expect(photoAuthority({...credential,generation:assignedRequestGeneration(student,task,legacy.token)},student)).rejects.toThrow("not_permitted");
  m.request.mockResolvedValue(null);await expect(photoAuthority(credential,student)).rejects.toThrow("not_permitted");
});
it("forces a direct teacher avatar proposal through the canonical scoped self-task wrapper",async()=>{
  const auth=await photoAuthority({kind:"student",id:student});
  expect(m.rpc).toHaveBeenCalledWith("ensure_student_photo_task",{p_actor:m.staff.id,p_student:student,p_session:"SYNTHETIC"});
  expect(auth.credential).toEqual({kind:"task",id:task});expect(auth.request?.id).toBe(request.id);
});
it("derives staff self from the actor and refuses a teacher editing someone else",async()=>{
  expect((await photoAuthority({kind:"staff"},student)).target).toBe(m.staff.id);
  await expect(photoAuthority({kind:"staff",id:student})).rejects.toThrow("not_permitted");
});
it("refuses a public token for another task or a student outside its frozen membership",async()=>{
  await expect(photoAuthority({kind:"task",id:student,token:"synthetic-task-capability"},student)).rejects.toThrow();
  m.roll.mockResolvedValue([]);await expect(photoAuthority({kind:"task",id:task,token:"synthetic-task-capability"},student)).rejects.toThrow();
});
it("revoked assignment and rotated request generations cannot recover old authority",async()=>{
  const before=await photoAuthority({kind:"task",id:task},student);
  m.request.mockResolvedValue({...request,token:"rotated"});expect((await photoAuthority({kind:"task",id:task},student)).scope).not.toBe(before.scope);
  m.task.mockResolvedValue(null);await expect(photoAuthority({kind:"task",id:task},student)).rejects.toThrow();
});
it("preserves direct office policy, without creating or accepting a teacher proposal",async()=>{
  m.staff.role="office";const auth=await photoAuthority({kind:"student",id:student});expect(auth.request).toBeNull();expect(m.rpc).not.toHaveBeenCalled();
});
it("does not adopt the new assignee/request generation when an old task token races with reassignment",async()=>{
  m.token.mockImplementation(async()=>{
    m.allowed=false;
    return {id:task,request_id:request.id,assigned_staff_id:student,kind:"collection"};
  });
  m.request.mockResolvedValue({...request,token:"new-request-generation"});
  await expect(photoAuthority({kind:"task",id:task,token:"old-task-capability"},student)).rejects.toThrow("not_permitted");
  expect(m.rpc).toHaveBeenCalledWith("teacher_task_access",{p_id:task,p_staff:null,p_token:"old-task-capability"});
  expect(m.sign).not.toHaveBeenCalled();
});
it("refuses to return signed context if the original task capability is revoked during the photo read",async()=>{
  const auth=await photoAuthority({kind:"task",id:task,token:"original-task-capability"},student);
  m.sign.mockImplementation(async()=>{m.allowed=false;return {data:{signedUrl:"private:new-generation-photo"},error:null};});
  await expect(readPhotoContext(auth)).rejects.toThrow("not_permitted");
  expect(m.rpc).toHaveBeenLastCalledWith("teacher_task_access",{p_id:task,p_staff:null,p_token:"original-task-capability"});
});
it("refuses context when its pinned request generation no longer exists",async()=>{
  const auth=await photoAuthority({kind:"task",id:task,token:"original-task-capability"},student);
  m.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,is:()=>q,maybeSingle:async()=>({data:null,error:null})};return q;});
  await expect(readPhotoContext(auth)).rejects.toThrow("not_permitted");
  expect(m.sign).not.toHaveBeenCalled();
});
