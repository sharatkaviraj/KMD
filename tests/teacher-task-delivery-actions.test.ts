import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),permission:vi.fn(),preview:vi.fn(),dispatch:vi.fn(),availability:"unavailable"}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:mocks.permission}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:mocks.preview}));
vi.mock("@/platform/env",()=>({getSiteUrl:()=>"https://vpps.example.test"}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
vi.mock("@/modules/collection/data/messages-repo",()=>({dispatchTeacherTaskMessage:mocks.dispatch}));
vi.mock("@/modules/collection/data/message-provider",()=>({taskDeliveryAvailability:()=>mocks.availability}));
import {previewTaskDeliveryAction,confirmTaskDeliveryAction,reconcileTaskDeliveryAction} from "@/app/(app)/teach/tasks/delivery-actions";
const id="10000000-0000-4000-8000-000000000001";
beforeEach(()=>{vi.clearAllMocks();mocks.permission.mockResolvedValue({id:"synthetic-actor"});mocks.availability="unavailable";});
it("review resolves on the server with management permission and preview protection",async()=>{
  mocks.rpc.mockResolvedValue({data:{ok:true,id,phone:"9000000000"},error:null});
  expect(await previewTaskDeliveryAction(id,"initial")).toMatchObject({ok:true,phone:"9000000000"});
  expect(mocks.permission).toHaveBeenCalledWith("collection:manage");expect(mocks.preview).toHaveBeenCalled();
});
it("unavailable real delivery does not enqueue or claim",async()=>{
  expect(await confirmTaskDeliveryAction(id,"a".repeat(32),"api")).toEqual({ok:false,reason:"unavailable"});expect(mocks.rpc).not.toHaveBeenCalled();
});
it("stale reviewed recipients return typed refusal before API or manual dispatch",async()=>{
  mocks.availability="ready";mocks.rpc.mockResolvedValue({data:{ok:false,reason:"changed"},error:null});
  expect(await confirmTaskDeliveryAction(id,"a".repeat(32),"api")).toEqual({ok:false,reason:"changed"});expect(mocks.dispatch).not.toHaveBeenCalled();
  expect(await confirmTaskDeliveryAction(id,"a".repeat(32),"manual")).toEqual({ok:false,reason:"changed"});
});
it("manual unknown gate returns no URL",async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{ok:true,id},error:null}).mockResolvedValueOnce({data:{ok:false,reason:"reconcile"},error:null});
  expect(await confirmTaskDeliveryAction(id,"a".repeat(32),"manual")).toEqual({ok:false,reason:"reconcile"});
});
it("reconciliation carries actor, exact attempt and a bounded human note",async()=>{
  mocks.rpc.mockResolvedValue({data:true,error:null});await reconcileTaskDeliveryAction(id,`attempt:${id}`,"not_sent","Synthetic provider log checked");
  expect(mocks.rpc).toHaveBeenCalledWith("reconcile_teacher_task_delivery",{p_actor:"synthetic-actor",p_id:id,p_attempt:`attempt:${id}`,p_resolution:"not_sent",p_note:"Synthetic provider log checked"});
});
