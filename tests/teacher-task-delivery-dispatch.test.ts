import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({availability:"ready",claimed:false,finishFails:false,claimReason:"",calls:[] as string[],outcome:{ok:true,providerMessageId:"synthetic-receipt"} as unknown,send:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc:async(name:string)=>{
  state.calls.push(name);
  if(name==="claim_teacher_task_delivery") {
    if(state.claimReason)return {data:{ok:false,reason:state.claimReason},error:null};
    if(state.claimed)return {data:{ok:false,reason:"reconcile"},error:null};
    state.claimed=true;
    return {data:{ok:true,taskId:"synthetic-task",phone:"9000000000",name:"Synthetic Teacher",campaign:"vppsone_teacher_task_both_v1",params:["Synthetic Teacher","Synthetic task","-"],buttonSuffix:"synthetic-token",path:"/t/tasks/synthetic-token"},error:null};
  }
  return state.finishFails?{data:null,error:{message:"synthetic write timeout"}}:{data:{ok:true},error:null};
}})}));
vi.mock("@/modules/collection/data/message-provider",()=>({taskDeliveryAvailability:()=>state.availability,selectProvider:()=>({id:"aisensy",send:state.send}),ProviderMisconfigured:class extends Error{}}));
vi.mock("@/modules/collection/data/parent-messages-repo",()=>({}));
import {dispatchTeacherTaskMessage} from "@/modules/collection/data/messages-repo";
beforeEach(()=>{state.availability="ready";state.claimed=false;state.finishFails=false;state.claimReason="";state.calls=[];state.send.mockReset().mockResolvedValue({ok:true,providerMessageId:"synthetic-receipt"});});
it("double confirmation reaches transport once after a durable claim",async()=>{
  const result=await Promise.all([dispatchTeacherTaskMessage("synthetic-actor","synthetic-send"),dispatchTeacherTaskMessage("synthetic-actor","synthetic-send")]);
  expect(result.map(r=>r.ok)).toEqual([true,false]);expect(state.send).toHaveBeenCalledOnce();
  expect(state.calls[0]).toBe("claim_teacher_task_delivery");
});
it.each(["changed","complete","reconcile"])("%s at final SQL check blocks transport",async(reason)=>{
  state.claimReason=reason;expect(await dispatchTeacherTaskMessage("synthetic-actor","synthetic-send")).toMatchObject({ok:false,reason});expect(state.send).not.toHaveBeenCalled();
});
it.each(["unavailable","test_mode"])("%s neither claims nor pretends to send",async(reason)=>{
  state.availability=reason;expect(await dispatchTeacherTaskMessage("synthetic-actor","synthetic-send")).toMatchObject({ok:false,reason});expect(state.calls).toEqual([]);expect(state.send).not.toHaveBeenCalled();
});
it("acceptance followed by a failed finish reports unknown and cannot resend",async()=>{
  state.finishFails=true;expect(await dispatchTeacherTaskMessage("synthetic-actor","synthetic-send")).toMatchObject({ok:false,reason:"reconcile"});
  state.finishFails=false;await dispatchTeacherTaskMessage("synthetic-actor","synthetic-send");expect(state.send).toHaveBeenCalledOnce();
});
it("a thrown transport remains unknown with the same durable attempt",async()=>{
  state.send.mockRejectedValue(new Error("synthetic timeout"));
  expect(await dispatchTeacherTaskMessage("synthetic-actor","synthetic-send")).toMatchObject({ok:false,reason:"reconcile"});
  await dispatchTeacherTaskMessage("synthetic-actor","synthetic-send");expect(state.send).toHaveBeenCalledOnce();
});
