import {afterEach,beforeEach,expect,it,vi} from "vitest";
import type {MessageSend,MessageTemplate} from "@/modules/collection/domain/messages";
const state=vi.hoisted(()=>({insert:vi.fn(),update:vi.fn(),fetch:vi.fn(),template:{id:"10000000-0000-4000-8000-000000000001",code:"vppsone_teacher_task_en_v1",audience:"staff",is_active:true,variables:["teacher","task","due"],body_hi:"{{1}} {{2}} {{3}}",body_en:"{{1}} {{2}} {{3}}"}}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:async()=>({id:"synthetic-actor"})}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:vi.fn()}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:async()=>"QA"}));
vi.mock("@/modules/collection/data/documents-repo",()=>({}));
vi.mock("@/modules/collection/data/parent-messages-repo",()=>({}));
vi.mock("@/modules/teacher-tasks/data/delivery-routing",()=>({managedTasksForRequests:async()=>new Map()}));
vi.mock("@/platform/env",()=>({getOptionalEnvVar:(k:string)=>({MESSAGE_PROVIDER:"aisensy",AISENSY_API_KEY:"synthetic-key"}[k]),getSiteUrl:()=>"https://vpps.example.test",getVppsOneEnvironment:()=>"dev"}));
vi.mock("@/platform/supabase/server",()=>({createClient:async()=>({from:()=>({select:()=>({order:()=>({returns:async()=>({data:[state.template],error:null})})})})})}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({from:()=>{
  const q={insert:(v:unknown)=>{state.insert(v);return q;},update:(v:unknown)=>{state.update(v);return q;},select:()=>q,eq:()=>q,in:()=>q,is:()=>q,single:async()=>({data:{id:"synthetic-send"},error:null}),then:(resolve:(r:unknown)=>void)=>resolve({data:[{id:"synthetic-send"}],error:null})};return q;
}})}));
import {queueMessageAction} from "@/app/(app)/collection/actions";
import {dispatch,queueSend} from "@/modules/collection/data/messages-repo";
import {providers} from "@/modules/collection/data/message-provider";
beforeEach(()=>{vi.clearAllMocks();state.template.code="vppsone_teacher_task_en_v1";vi.stubGlobal("fetch",state.fetch.mockResolvedValue({ok:true,status:200,json:async()=>({messageId:"synthetic-receipt"})}));});
afterEach(()=>vi.unstubAllGlobals());
it.each(["vppsone_teacher_task_en_v1","vppsone_teacher_task_hi_v1","vppsone_teacher_task_both_v1","vppsone_teacher_task_reminder_en_v1","vppsone_teacher_task_reminder_hi_v1","vppsone_teacher_task_reminder_both_v1","synthetic_prefix_teacher_task_en_v1"])("ordinary generic composition refuses %s without task configuration",async(code)=>{
  state.template.code=code;
  const form=new FormData();form.set("templateId",state.template.id);form.set("toPhone","9000000000");form.set("toName","Synthetic Teacher");
  ["Synthetic Teacher","Synthetic task","-"].forEach(v=>form.append("variables",v));
  expect((await queueMessageAction({status:"idle",message:null},form)).status).toBe("error");
  expect(state.insert).not.toHaveBeenCalled();expect(state.fetch).not.toHaveBeenCalled();
});
it("the generic repository cannot queue a reserved template directly",async()=>{
  await expect(queueSend({queue:{templateId:state.template.id,toPhone:"9000000000",toName:null,studentId:null,requestId:null,staffProfileId:null,variables:[]},template:{code:state.template.code,bodyHi:"Synthetic",bodyEn:"Synthetic",audience:"staff"} as MessageTemplate,sessionLabel:"QA",requestedByStaffId:"synthetic-actor"})).rejects.toThrow();
  expect(state.insert).not.toHaveBeenCalled();
});
it("ordinary unrelated templates remain usable through the same generic action",async()=>{
  state.template.code="synthetic_collection_v1";
  const form=new FormData();form.set("templateId",state.template.id);form.set("toPhone","9000000000");form.set("toName","Synthetic Teacher");
  ["Synthetic Teacher","Synthetic task","-"].forEach(v=>form.append("variables",v));
  expect((await queueMessageAction({status:"idle",message:null},form)).status).toBe("saved");expect(state.insert).toHaveBeenCalledOnce();expect(state.fetch).not.toHaveBeenCalled();
});
it.each([undefined,"forged-task"])("old generic queued task campaign never reaches transport (%s)",async(taskId)=>{
  const send={id:"synthetic-send",templateCode:state.template.code,taskId,audience:"staff",status:"queued",providerMessageId:null} as MessageSend;
  expect(await dispatch(send)).toMatchObject({ok:false,outcome:"rejected"});expect(state.fetch).not.toHaveBeenCalled();expect(state.update).not.toHaveBeenCalled();
});
it("the adapter refuses a reserved campaign with missing task metadata before fetch",async()=>{
  expect(await providers.aisensyProvider.send({templateCode:state.template.code,toPhone:"9000000000",variables:[]} as unknown as MessageSend)).toMatchObject({ok:false,outcome:"rejected"});
  expect(state.fetch).not.toHaveBeenCalled();
});
