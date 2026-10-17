import { beforeEach, expect, it, vi } from "vitest";
const state=vi.hoisted(()=>({role:"office",decide:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:async()=>({id:"synthetic-actor",role:state.role})}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:async()=>"QA"}));
vi.mock("@/modules/collection/data/submissions-repo",()=>({decideSubmissions:state.decide}));
vi.mock("@/modules/collection/data/requests-repo",()=>({}));
vi.mock("@/modules/collection/data/fields-repo",()=>({}));
vi.mock("@/modules/collection/data/messages-repo",()=>({}));
vi.mock("@/modules/collection/data/documents-repo",()=>({}));
vi.mock("@/modules/collection/data/parent-messages-repo",()=>({}));
vi.mock("@/vx/view-as",()=>({assertNotPreviewing:vi.fn()}));
import { decideSubmissionsAction } from "@/app/(app)/collection/actions";
const form=()=>{const f=new FormData();f.set("commandId","40000000-0000-4000-8000-000000000001");f.append("submissionIds","40000000-0000-4000-8000-000000000002");f.set("accept","true");return f;};
beforeEach(()=>{state.role="office";state.decide.mockReset().mockResolvedValue({ok:true,decided:1,recorded:1,confirmed:0,alreadyDecided:0,refused:[]});});
it.each(["office","teacher"])("legacy review action refuses %s before the canonical writer",async role=>{
  state.role=role;expect((await decideSubmissionsAction({status:"idle",message:null},form())).status).toBe("error");expect(state.decide).not.toHaveBeenCalled();
});
it("administrator legacy review retains the original command and canonical writer",async()=>{
  state.role="admin";expect((await decideSubmissionsAction({status:"idle",message:null},form())).status).toBe("saved");expect(state.decide).toHaveBeenCalledWith(expect.objectContaining({commandId:"40000000-0000-4000-8000-000000000001",deciderStaffId:"synthetic-actor",submissionIds:["40000000-0000-4000-8000-000000000002"]}));
});
