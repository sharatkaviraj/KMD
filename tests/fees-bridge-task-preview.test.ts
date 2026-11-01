import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const m=vi.hoisted(()=>({staff:vi.fn(),db:vi.fn(),session:vi.fn(),labels:vi.fn(),ready:vi.fn(),queries:[] as {schema:string;table:string;filters:Record<string,unknown>}[],rosterIds:[] as string[],rpc:vi.fn(),narrowMissing:false,testMode:false}));
vi.mock("@/platform/auth/current-staff",()=>({assertPermission:m.staff}));
vi.mock("@/platform/env",()=>({FEE_SCHEMA:"public"}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:m.db}));
vi.mock("@/platform/fees-bridge/state",()=>({readFeesBridgeState:m.ready}));
vi.mock("@/modules/academics/data/academics-repo",()=>({resolveSessionLabel:m.session,classLabelMap:m.labels}));
vi.mock("@/modules/collection/data/fields-repo",()=>({listFieldsPublic:async()=>[]}));
import {previewAssignment} from "@/modules/teacher-tasks/data/assignment";
const id="00000000-0000-4000-8000-000000000001",classId="00000000-0000-4000-8000-000000000002",teacher="00000000-0000-4000-8000-000000000003",subject="00000000-0000-4000-8000-000000000004",paper="00000000-0000-4000-8000-000000000005";
const input={kind:"marks",title:"Synthetic marks",mode:"subject",selectedIds:[id],fieldIds:[],overrides:{},paperId:paper,dueDate:null};
beforeEach(()=>{
  vi.resetAllMocks();vi.stubEnv("FEES_BRIDGE_ENABLED","true");vi.stubEnv("VERCEL_ENV","production");m.queries=[];m.rosterIds=[id];m.narrowMissing=false;m.testMode=false;
  m.staff.mockResolvedValue({id:teacher,isActive:true,isTestAccount:false,role:"admin",language:"en"});m.session.mockResolvedValue("2026-27");m.labels.mockResolvedValue(new Map([[classId,"Class 7 A"]]));m.ready.mockResolvedValue({});
  m.rpc.mockImplementation(async(name:string)=>({data:name==="prepare_teacher_tasks"?{id:"synthetic-preview",digest:"synthetic-digest"}:m.rosterIds,error:null}));
  const from=(table:string,schema="vppsone")=>{
    const query={schema,table,filters:{} as Record<string,unknown>};m.queries.push(query);
    const rows=()=>{
      if(table==="students"&&schema==="public"&&!m.testMode)return [];
      if(table==="fees_action_students"||table==="students")return m.narrowMissing&&query.filters.class_id?[ ]:[{id,full_name:"Synthetic source pupil",class_id:classId,house:null,transport_route_id:null}];
      if(table==="enrolments")return [{student_id:id,class_id:classId}];
      if(table==="staff_profiles")return [{id:teacher,display_name:"Synthetic teacher"}];
      if(table==="class_teachers")return [{staff_profile_id:teacher,class_id:classId,effective_from:"2026-01-01",effective_to:null}];
      if(table==="teaching_assignments")return [{staff_profile_id:teacher,class_id:classId,subject_id:subject}];
      if(table==="subjects")return [{id:subject,code:"EN"}];
      if(table==="assessment_subjects")return [{id:paper,class_id:classId,subject_id:subject,class_label:"Class 7 A",subject_code:"EN",assessments:{label_en:"Synthetic exam"}}];
      return [];
    };
    const chain={select:vi.fn(),eq:vi.fn(),or:vi.fn(),order:vi.fn(),range:vi.fn(),in:vi.fn(),is:vi.fn(),returns:vi.fn(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:rows(),error:null}).then(resolve)};
    for(const key of ["select","or","order","range","in","is","returns"] as const)chain[key].mockReturnValue(chain);
    chain.eq.mockImplementation((key:string,value:unknown)=>{query.filters[key]=value;return chain;});return chain;
  };
  m.db.mockReturnValue({from:(table:string)=>from(table),schema:(schema:string)=>({from:(table:string)=>from(table,schema)}),rpc:m.rpc});
});
afterEach(()=>vi.unstubAllEnvs());
describe("canonical source task preview",()=>{
  it("builds a real marks preview from current-action identities with exact class scope",async()=>{
    const result=await previewAssignment(input);expect(result.previewId).toBe("synthetic-preview");expect(result.students).toEqual([{id,name:"Synthetic source pupil",classLabel:"Class 7 A"}]);
    expect(m.queries.filter(q=>q.table==="fees_action_students")).toHaveLength(2);expect(m.queries.some(q=>q.table==="fees_action_students"&&q.filters.class_id===classId)).toBe(true);expect(m.queries.some(q=>q.schema==="public"&&q.table==="students")).toBe(false);
  });
  it("refuses changed current class membership before saving a preview",async()=>{
    m.narrowMissing=true;await expect(previewAssignment(input)).rejects.toThrow("roster_unavailable");expect(m.rpc.mock.calls.some(([name])=>name==="prepare_teacher_tasks")).toBe(false);
  });
  it("preserves isolated TEST names in the local engine",async()=>{
    m.testMode=true;
    m.staff.mockResolvedValue({id:teacher,isActive:true,isTestAccount:true,role:"admin",language:"en"});m.session.mockResolvedValue("TEST-2026-27");
    expect((await previewAssignment(input)).previewId).toBe("synthetic-preview");expect(m.queries.some(q=>q.table==="fees_action_students")).toBe(false);expect(m.queries.some(q=>q.schema==="public"&&q.table==="students"&&q.filters.class_id===classId)).toBe(true);
  });
});
