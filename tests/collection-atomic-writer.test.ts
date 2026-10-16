import { beforeEach,expect,it,vi } from "vitest";
const x=vi.hoisted(()=>({rpc:vi.fn(),upsert:vi.fn(),error:null as null|{code:string;message:string}}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:vi.fn()}));
vi.mock("@/platform/supabase/server",()=>({createClient:vi.fn()}));
vi.mock("@/modules/collection/data/fields-repo",()=>({listFieldsPublic:vi.fn()}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({rpc:x.rpc,from:()=>{const q={select:()=>q,eq:()=>q,neq:()=>q,maybeSingle:async()=>({data:null,error:x.error}),returns:async()=>({data:[],error:null}),upsert:x.upsert};return q;}})}));
import { recordAnswers } from "@/modules/collection/data/submissions-repo";
import type { CollectionRequest } from "@/modules/collection/domain/requests";
beforeEach(()=>{vi.clearAllMocks();x.error=null;});
it("uses atomic authority for an unmanaged legacy request when task schema exists",async()=>{
  x.rpc.mockResolvedValue({data:1,error:null});x.upsert.mockResolvedValue({error:null});
  const request={id:"request",token:"original-request-token",fields:[{id:"field"}]} as CollectionRequest;
  const answers=[{studentId:"child",fieldId:"field",value:"new",previousValue:"old"}];
  expect(await recordAnswers(request,answers)).toEqual({written:1});
  expect(x.rpc).toHaveBeenCalledWith("record_collection_answers",{p_request:request.id,p_token:request.token,p_answers:answers});expect(x.upsert).not.toHaveBeenCalled();
});
it("allows the compatibility writer only for an explicitly absent additive schema",async()=>{
  const request={id:"request",token:"original",fields:[{id:"field"}]} as CollectionRequest;
  const answers=[{studentId:"child",fieldId:"field",value:"new",previousValue:null}];
  x.error={code:"42501",message:"permission denied for teacher_tasks"};
  await expect(recordAnswers(request,answers)).rejects.toThrow("authority");expect(x.upsert).not.toHaveBeenCalled();
  x.error={code:"42P01",message:'relation "vppsone.teacher_tasks" does not exist'};x.upsert.mockResolvedValue({error:null});
  expect(await recordAnswers(request,answers)).toEqual({written:1});expect(x.upsert).toHaveBeenCalledOnce();expect(x.rpc).not.toHaveBeenCalled();
});
