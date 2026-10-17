import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({managed:true,provider:vi.fn(),writes:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/modules/teacher-tasks/data/delivery-routing",()=>({managedTasksForRequests:async(ids:string[])=>new Map(state.managed?ids.map(id=>[id,"synthetic-task"]):[])}));
vi.mock("@/platform/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({from:()=>{
  const q={select:()=>q,update:()=>{state.writes();return q;},eq:()=>q,in:()=>q,is:()=>q,then:(resolve:(r:unknown)=>void)=>resolve({data:[{id:"synthetic-send"}],error:null})};return q;
}})}));
vi.mock("@/modules/collection/data/message-provider",()=>({selectProvider:()=>({id:"mock",send:state.provider}),ProviderMisconfigured:class extends Error{}}));
vi.mock("@/modules/collection/data/parent-messages-repo",()=>({}));
import {dispatch} from "@/modules/collection/data/messages-repo";
import type {MessageSend} from "@/modules/collection/domain/messages";
const send={id:"synthetic-send",requestId:"synthetic-request",audience:"staff",status:"queued",providerMessageId:null} as MessageSend;
beforeEach(()=>{state.managed=true;state.writes.mockReset();state.provider.mockReset().mockResolvedValue({ok:true,providerMessageId:"mock:synthetic"});});
it("a legacy row adopted by a task is refused before claiming or sending",async()=>{
  expect(await dispatch(send)).toMatchObject({ok:false,outcome:"rejected"});expect(state.writes).not.toHaveBeenCalled();expect(state.provider).not.toHaveBeenCalled();
});
it("unrelated legacy collection sends keep the existing claim/finish path",async()=>{
  state.managed=false;expect((await dispatch(send)).ok).toBe(true);expect(state.provider).toHaveBeenCalledOnce();
});
