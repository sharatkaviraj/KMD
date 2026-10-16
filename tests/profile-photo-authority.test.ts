import { beforeEach, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({staff:{id:"00000000-0000-4000-8000-000000000001",role:"teacher"},rpc:vi.fn(),task:vi.fn(),token:vi.fn(),request:vi.fn(),roll:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/auth/current-staff",()=>({assertStaff:async()=>m.staff}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:async()=>{}}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:async()=>"SYNTHETIC"}));
vi.mock("@/modules/teacher-tasks/data/repo",()=>({resolveTask:m.task,resolveTaskToken:m.token}));
vi.mock("@/modules/collection/data/requests-repo",()=>({resolveAssignedRequest:m.request,resolveToken:m.request,rollForRequest:m.roll}));
vi.mock("@/modules/collection/data/rate-limit",()=>({clientIp:async()=>"synthetic",limitByIp:async()=>({allowed:true}),limitByToken:async()=>({allowed:true}),limitUnknownToken:async()=>{}}));
import { photoAuthority } from "@/modules/collection/data/profile-photo-context";
const student="00000000-0000-4000-8000-000000000002",task="00000000-0000-4000-8000-000000000003";
const request={id:"request",token:"synthetic-request-generation",sessionLabel:"SYNTHETIC",fields:[{id:"field",key:"student_photo"}]};
beforeEach(()=>{vi.clearAllMocks();m.staff.role="teacher";m.rpc.mockResolvedValue({data:task,error:null});m.task.mockResolvedValue({id:task,request_id:request.id,assigned_staff_id:m.staff.id,kind:"collection"});m.token.mockResolvedValue({id:task,request_id:request.id,assigned_staff_id:m.staff.id,kind:"collection"});m.request.mockResolvedValue(request);m.roll.mockResolvedValue([{studentId:student}]);});
it("signed-in and public task entry resolve the same canonical request, with separate recovery authority",async()=>{
  const signed=await photoAuthority({kind:"task",id:task},student);
  const publicEntry=await photoAuthority({kind:"task",id:task,token:"synthetic-task-capability"},student);
  expect(signed.request?.id).toBe(publicEntry.request?.id);expect(signed.scope).not.toBe(publicEntry.scope);
  expect(m.task).toHaveBeenCalledWith({id:task,staffId:m.staff.id});expect(m.token).toHaveBeenCalledWith("synthetic-task-capability");
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
