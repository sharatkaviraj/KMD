import { beforeEach, expect, it, vi } from "vitest";
import type { StudentsProps } from "@/vx/screens/admin/students";
import type { MoneyListRow } from "@/modules/students-fees/vx/admin-students";
const mocks = vi.hoisted(() => ({ money: vi.fn(), search: vi.fn(), context: vi.fn(), seesMoney: true }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async () => ({ id:"office",role:"admin",language:"en" }) }));
vi.mock("@/platform/auth/permissions", () => ({ can: (_:unknown, permission:string) => permission === "fees:view" ? mocks.seesMoney : true }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async()=>"QA",classLabelMap:async()=>new Map([["c","Class 1"]]) }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie:async()=>"QA" }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession:async()=>({sessionLabel:"QA"}) }));
vi.mock("@/modules/students/data/directory-repo", () => ({ searchStudents:mocks.search }));
vi.mock("@/modules/students-fees/vx/admin-students", () => ({ studentMoneyList:mocks.money,parentNamesFor:async()=>new Map() }));
vi.mock("@/vx/screens/admin/students-data", () => ({ attendanceForStudents:async()=>new Map() }));
vi.mock("@/modules/teacher-tasks/data/assignment", () => ({ assignmentContext:mocks.context }));
vi.mock("@/modules/collection/data/fields-repo", () => ({ listFieldsPublic:async()=>[{id:"field",key:"phone",isActive:true,labelHi:"फोन",labelEn:"Phone"}] }));
vi.mock("@/vx/screens/admin/students", () => ({ StudentsScreen:()=>null }));
vi.mock("@/vx/ui/page", () => ({ VxPage:()=>null,TopBar:()=>null,Section:()=>null }));
vi.mock("@/vx/ui/primitives", () => ({ EmptyState:()=>null }));
import StudentsPage from "@/app/(app)/students/page";
const row = (id:string):MoneyListRow => ({ id,fullName:`Child ${id}`,admissionNo:`SR-${id}`,classLabel:"Class 1",routeLabel:"Bus A",parentName:"Parent R",phone:"0000000000",overdueAmount:100,outstandingAmount:200,pendingLateFeeAmount:5,totalPaid:300,totalDue:500,lateFeeTotal:5,status:"active",siblingCount:2,isNew:true,yearClear:false,emi:{status:"due",monthly:50,nextDue:"2026-10-20"},concessions:["RTE"] });
const counts={all:150,pending:80};
async function page(params:Record<string,string>) {
  const result=await StudentsPage({params:Promise.resolve({}),searchParams:Promise.resolve(params)});
  return result.props.children.props as StudentsProps;
}
beforeEach(()=>{
  vi.clearAllMocks();mocks.seesMoney=true;
  mocks.context.mockResolvedValue({students:[{id:"a",name:"Child a",classId:"c",hasPhoto:false,values:{}},{id:"excluded-by-fee",name:"Another",classId:"c",hasPhoto:false,values:{}}]});
  mocks.money.mockResolvedValue({rows:[row("a")],total:1,sessionLabel:"QA",counts});
});
it.each(["123","Parent R"])("intersects No photo with canonical %s search and fee filters, retaining details and view", async q=>{
  const props=await page({q,seg:"pending",view:"fees",missing:"photo"});
  expect(mocks.money).toHaveBeenCalledWith(expect.objectContaining({query:q,filters:["pending"],page:1}));
  expect(props.taskAssignment?.matchingIds).toEqual(["a"]);
  expect(props.rows[0]).toMatchObject({sr:"SR-a",parent:"Parent R",phone:"0000000000",route:"Bus A",facts:{siblings:2,isNew:true,emi:{monthly:50},concessions:["RTE"]}});
  expect(props.rows[0].money).not.toBeNull();expect(props.view).toBe("fees");expect(props.filters).toEqual(["pending"]);expect(props.counts).toEqual(counts);
});
it("reads the entire canonical match in pages before intersecting and selecting all",async()=>{
  const rows=Array.from({length:120},(_,i)=>row(String(i)));
  mocks.money.mockImplementation(async({page}:{page:number})=>({rows:rows.slice((page-1)*50,page*50),total:120,counts,sessionLabel:"QA"}));
  mocks.context.mockResolvedValue({students:rows.map((r,i)=>({id:r.id,hasPhoto:i%2===1,values:{}}))});
  const props=await page({missing:"photo",page:"2",view:"fees"});
  expect(mocks.money).toHaveBeenCalledTimes(3);expect(props.total).toBe(60);expect(props.rows).toHaveLength(10);
  expect(props.rows[0].id).toBe("100");expect(props.taskAssignment?.matchingIds).toHaveLength(60);
  expect(props.counts?.all).toBe(120);
});
it("preserves the school directory SR/parent/roll data",async()=>{
  mocks.seesMoney=false;mocks.search.mockResolvedValue({rows:[{studentId:"a",fullName:"Child a",admissionNo:"123",classId:"c",rollNo:"4",fatherName:"Parent R",guardianPhone:"0000000000"}],total:1});
  const props=await page({q:"Parent R",missing:"phone"});
  expect(mocks.search).toHaveBeenCalledWith({text:"Parent R",classId:null,page:1},"QA");
  expect(props.rows[0]).toMatchObject({sr:"123",rollNo:"4",parent:"Parent R",phone:"0000000000"});
  expect(props.view).toBe("school");expect(props.taskAssignment?.matchingIds).toEqual(["a"]);
});
it("does not silently broaden a failed fee query into the school roll",async()=>{
  mocks.money.mockRejectedValue(new Error("canonical query failed"));
  await expect(page({seg:"pending",view:"fees",missing:"photo"})).rejects.toThrow("canonical query failed");
  expect(mocks.search).not.toHaveBeenCalled();
});
