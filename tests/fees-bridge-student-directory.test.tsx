import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StudentsProps } from "@/vx/screens/admin/students";
const state = vi.hoisted(() => ({ canonical: true, test: false, fees: true, session: "2026-27", money: vi.fn(), search: vi.fn(), context: vi.fn(), redirect: vi.fn(), parents: vi.fn() }));
const classId = "00000000-0000-4000-8000-000000000001";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (url:string) => { state.redirect(url); throw new Error("synthetic_redirect"); } }));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async () => ({ id:"office",role:"admin",isActive:true,isTestAccount:state.test,language:"en" }) }));
vi.mock("@/platform/auth/permissions", () => ({ can: (_:unknown, p:string) => p === "fees:view" ? state.fees : true }));
vi.mock("@/platform/fees-bridge/policy", async importOriginal => ({ ...await importOriginal<typeof import("@/platform/fees-bridge/policy")>(), usesCanonicalFees: (_:unknown,session:string) => state.canonical && !state.test && !session.startsWith("TEST-") }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async()=>state.session,classLabelMap:async()=>new Map([["00000000-0000-4000-8000-000000000001","Class 1"]]) }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie:async()=>state.session }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession:async()=>({sessionLabel:state.session}) }));
vi.mock("@/modules/students/data/directory-repo", () => ({ searchStudents:state.search }));
vi.mock("@/modules/students-fees/vx/admin-students", () => ({ studentMoneyList:state.money,parentNamesFor:state.parents }));
vi.mock("@/vx/screens/admin/students-data", () => ({ attendanceForStudents:async()=>new Map() }));
vi.mock("@/modules/teacher-tasks/data/assignment", () => ({ assignmentContext:state.context }));
vi.mock("@/modules/collection/data/fields-repo", () => ({ listFieldsPublic:async()=>[] }));
vi.mock("@/modules/collection/data/approved-photos", () => ({ approvedStudentPhotos:async()=>new Map() }));
vi.mock("@/vx/screens/admin/students", () => ({ StudentsScreen:()=>null }));
vi.mock("@/vx/ui/page", () => ({ VxPage:()=>null,TopBar:()=>null,Section:()=>null }));
vi.mock("@/vx/ui/primitives", () => ({ EmptyState:()=>null }));
import StudentsPage from "@/app/(app)/students/page";
import { canonicalStudentDirectoryUrl } from "@/platform/fees-bridge/student-directory";
async function page(params:Record<string,string|undefined>={}) {
  const result=await StudentsPage({params:Promise.resolve({}),searchParams:Promise.resolve(params)});
  return result.props.children.props as StudentsProps;
}
beforeEach(()=>{
  vi.clearAllMocks();state.canonical=true;state.test=false;state.fees=true;state.session="2026-27";
  state.money.mockResolvedValue({rows:[{id:"child",fullName:"Source Child",admissionNo:"SR-123",classLabel:"Class 1",routeLabel:"",parentName:"Source Parent",phone:"0000000000",overdueAmount:100,outstandingAmount:250,pendingLateFeeAmount:25,totalPaid:750,totalDue:1000,lateFeeTotal:25,status:"active",siblingCount:0,isNew:false,yearClear:false,emi:null,concessions:[],photoUrl:"/api/fees-bridge/students/child/photo?session=2026-27&variant=thumb"}],total:1,counts:{all:1},sessionLabel:"2026-27",page:1,pageSize:50});
  state.search.mockResolvedValue({rows:[{studentId:"child",fullName:"Source Child",admissionNo:"SR-123",classId,rollNo:"5",fatherName:"Source Parent",guardianPhone:"0000000000"}],total:1});
  state.context.mockResolvedValue({students:[{id:"child",hasPhoto:false,values:{}}]});
  state.parents.mockResolvedValue(new Map());
});
describe("real school directory during coexistence",()=>{
  it.each([{view:"school"}, {view:"school",class:classId}])("keeps explicit school browsing on the academic reader for %j",async params=>{
    const props=await page(params);
    expect(state.money).not.toHaveBeenCalled();expect(state.parents).not.toHaveBeenCalled();
    expect(state.search).toHaveBeenCalledWith({text:"",classId:params.class??null,page:1},"2026-27");
    expect(props).toMatchObject({failed:false,view:"school",seesMoney:false,total:1,canCollect:true,canRemind:false});
    expect(props.rows[0]).toMatchObject({name:"Source Child",sr:"SR-123",parent:"Source Parent",phone:"0000000000",rollNo:"5",money:null});
    expect(props.feesDirectoryHref).toBeUndefined();
  });
  it("shows native source money and photos by default without a local parent read",async()=>{
    const props=await page();expect(props).toMatchObject({failed:false,view:"fees",sourceData:true,enrollment:"active",canRemind:false});
    expect(state.parents).not.toHaveBeenCalled();expect(state.search).not.toHaveBeenCalled();expect(state.redirect).not.toHaveBeenCalled();
    expect(props.rows[0]).toMatchObject({parent:"Source Parent",money:{pendingToday:100,notDueYet:150,lateFee:25},photoUrl:"/api/fees-bridge/students/child/photo?session=2026-27&variant=thumb"});
  });
  it("preserves real missing-photo task scope through the academic reader",async()=>{
    const props=await page({view:"school",missing:"photo",q:"Source Parent"});
    expect(props.taskAssignment?.matchingIds).toEqual(["child"]);expect(props.failed).toBe(false);expect(state.money).not.toHaveBeenCalled();
  });
  it("does not expose finance navigation to a reader without fees:view",async()=>{
    state.fees=false;expect((await page({view:"fees",seg:"pending"})).feesDirectoryHref).toBeUndefined();expect(state.redirect).not.toHaveBeenCalled();expect(state.money).not.toHaveBeenCalled();
  });
  it("loads financial filters natively and preserves explicit enrolment scope",async()=>{
    const props=await page({view:"fees",seg:"pending,bus",class:classId,q:"Source Parent",sort:"class",status:"all"});
    expect(state.money).toHaveBeenCalledWith(expect.objectContaining({sessionLabel:"2026-27",query:"Source Parent",classId,filters:["pending","bus"],sort:"class",status:"all"}));
    expect(props).toMatchObject({enrollment:"all",filters:["pending","bus"],sourceData:true});expect(state.redirect).not.toHaveBeenCalled();expect(state.search).not.toHaveBeenCalled();
  });
  it("intersects combined fee and missing-photo tasks without widening and fails closed on a failed fee read",async()=>{
    const props=await page({view:"fees",seg:"pending",missing:"photo"});
    expect(props.taskAssignment?.matchingIds).toEqual(["child"]);expect(state.money).toHaveBeenCalled();expect(state.context).toHaveBeenCalled();expect(state.search).not.toHaveBeenCalled();
    state.money.mockRejectedValue(new Error("synthetic_source_failed"));await expect(page({view:"fees",seg:"pending",missing:"photo"})).rejects.toThrow("synthetic_source_failed");
  });
  it("keeps a genuine academic read failure visible",async()=>{
    state.search.mockRejectedValue(new Error("synthetic_roster_unavailable"));await expect(page({view:"school"})).rejects.toThrow("synthetic_roster_unavailable");
  });
  it("retains the isolated TEST financial directory",async()=>{
    state.test=true;state.session="TEST-2026-27";state.money.mockResolvedValue({rows:[],total:0,counts:{all:0},sessionLabel:state.session});
    const props=await page({view:"fees"});expect(state.money).toHaveBeenCalledOnce();expect(state.search).not.toHaveBeenCalled();expect(props).toMatchObject({view:"fees",seesMoney:true,failed:false,sourceData:false});expect(props.feesDirectoryHref).toBeUndefined();
  });
  it("never constructs a broad or TEST source link from an invalid class/session",()=>{
    const input={sessionLabel:"2026-27",query:"",classId:null,filters:[] as const,sort:"name" as const};
    expect(()=>canonicalStudentDirectoryUrl({...input,classId:"not-a-class"})).toThrow("valid school class");
    expect(()=>canonicalStudentDirectoryUrl({...input,sessionLabel:"TEST-2026-27"})).toThrow("real academic session");
  });
});
