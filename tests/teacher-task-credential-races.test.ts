import { beforeEach, expect, it, vi } from "vitest";
const x=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),request:vi.fn(),submit:vi.fn(),roll:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/auth/current-staff",()=>({assertStaff:vi.fn(),assertPermission:vi.fn()}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc:x.rpc,from:x.from})}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:vi.fn()}));
vi.mock("@/modules/collection/data/requests-repo",()=>({resolveAssignedRequest:x.request,rollForRequest:x.roll}));
vi.mock("@/modules/teacher-tasks/data/collection-save",()=>({submitCollectionPayload:x.submit}));
vi.mock("@/modules/collection/data/rate-limit",()=>({clientIp:async()=>"synthetic",limitByIp:async()=>({allowed:true}),limitByToken:async()=>({allowed:true}),limitUnknownToken:vi.fn()}));
import { resolveTask, loadTaskWork } from "@/modules/teacher-tasks/data/repo";
import { POST } from "@/app/t/tasks/[token]/save/route";
const id="10000000-0000-4000-8000-000000000001",token="a".repeat(32);
const task={id,token,kind:"collection",request_id:"request",assigned_staff_id:"teacher",session_label:"QA",scope:{kind:"common",value:"selected"}};
beforeEach(()=>{
  vi.clearAllMocks();x.rpc.mockResolvedValue({data:true,error:null});
  x.from.mockImplementation((table:string)=>{const q={select:()=>q,eq:()=>q,is:()=>q,single:async()=>({data:{preferred_language:"en",token},error:null}),maybeSingle:async()=>({data:table==="teacher_tasks"?task:{id:"request"},error:null})};return q;});
  x.request.mockResolvedValue({id:"request",token:"request-generation",sessionLabel:"QA",fields:[]});x.roll.mockResolvedValue([]);x.submit.mockResolvedValue({status:"saved"});
});
it("refuses a task row whose public capability rotated after the initial access read",async()=>{
  x.from.mockImplementation(()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{...task,token:"b".repeat(32)},error:null})};return q;});
  expect(await resolveTask({id,token})).toBeNull();
});
it("carries the original public task credential all the way to collection submission",async()=>{
  const response=await POST(new Request("http://localhost/save",{method:"POST",body:JSON.stringify({payload:[]})}),{params:Promise.resolve({token})});
  expect(response.status).toBe(200);
  expect(x.submit).toHaveBeenCalledWith(expect.any(Object),[],{id,token});
});
it("does not return a collection context after revocation during roster read",async()=>{
  x.roll.mockImplementation(async()=>{x.rpc.mockResolvedValue({data:false,error:null});return [];});
  expect(await loadTaskWork({id,token})).toBeNull();
});
