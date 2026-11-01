import {beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({staff:vi.fn(),mode:vi.fn(),permission:vi.fn(),scope:vi.fn(),ready:vi.fn(),from:vi.fn(),rows:{} as Record<string,unknown[]>}));
vi.mock("@/platform/auth/current-staff",()=>({assertStaff:mocks.staff}));
vi.mock("@/platform/auth/permissions",()=>({canAny:mocks.permission}));
vi.mock("@/platform/fees-bridge/policy",()=>({usesCanonicalFees:mocks.mode}));
vi.mock("@/platform/fees-bridge/state",()=>({readFeesBridgeState:mocks.ready}));
vi.mock("@/modules/attendance/data/teaching-repo",()=>({classScopeFor:mocks.scope}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:()=>({from:mocks.from})}));
import {retiredClassLabels,retiredStudentLabels} from "@/platform/fees-bridge/history";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
beforeEach(()=>{
  vi.resetAllMocks();mocks.rows={};mocks.staff.mockResolvedValue({isActive:true,role:"teacher",isTestAccount:false});mocks.mode.mockReturnValue(true);mocks.permission.mockReturnValue(true);mocks.scope.mockResolvedValue({everyClass:false,classIds:["class-a"]});mocks.ready.mockResolvedValue({});
  mocks.from.mockImplementation((table:string)=>{
    const chain={select:vi.fn(),in:vi.fn(),eq:vi.fn(),order:vi.fn(),range:vi.fn(),then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:mocks.rows[table]??[],error:null}).then(resolve)};
    for(const key of ["select","in","eq","order","range"] as const)chain[key].mockReturnValue(chain);
    return chain;
  });
});
describe("historical names",()=>{
  it("returns display fields only for One academic membership in the viewer's classes",async()=>{
    mocks.rows.enrolments=[{student_id:a,class_id:"class-a",session_label:"2026-27"},{student_id:b,class_id:"class-b",session_label:"2026-27"}];
    mocks.rows.fees_bridge_retired_students=[{id:a,session_label:"2026-27",fields:{full_name:"Synthetic retired student",admission_no:"TEST-1",father_name:"Synthetic parent",primary_phone:"never return",fees_pending:123}},{id:b,session_label:"2026-27",fields:{full_name:"Outside class"}}];
    expect(await retiredStudentLabels([a,b],"2026-27")).toEqual([{id:a,full_name:"Synthetic retired student",admission_no:"TEST-1",father_name:"Synthetic parent"}]);
  });
  it("never grants a label by UUID alone or crosses the membership session",async()=>{
    mocks.rows.fees_bridge_retired_students=[{id:a,session_label:"2025-26",fields:{full_name:"Wrong session"}}];
    expect(await retiredStudentLabels([a],"2026-27")).toEqual([]);
    mocks.rows.enrolments=[{student_id:a,class_id:"class-a",session_label:"2026-27"}];
    expect(await retiredStudentLabels([a],"2026-27")).toEqual([]);
  });
  it("preserves current freshness and permission gates",async()=>{
    mocks.permission.mockReturnValue(false);await expect(retiredStudentLabels([a])).rejects.toThrow("not permitted");expect(mocks.from).not.toHaveBeenCalled();
    mocks.permission.mockReturnValue(true);mocks.ready.mockRejectedValue(new Error("stale"));await expect(retiredStudentLabels([a])).rejects.toThrow("stale");expect(mocks.from).not.toHaveBeenCalled();
  });
  it("returns class labels only from authorized real-session membership",async()=>{
    mocks.rows.enrolments=[{student_id:a,class_id:"class-a",session_label:"2026-27"}];
    mocks.rows.fees_bridge_retired_classes=[{id:"class-a",session_label:"2026-27",fields:{class_name:"Class 7",section:"A",sort_order:7}},{id:"class-b",session_label:"2026-27",fields:{class_name:"Outside"}}];
    expect(await retiredClassLabels("2026-27")).toEqual([{id:"class-a",class_name:"Class 7",section:"A",sort_order:7}]);
    expect(await retiredClassLabels("TEST-2026-27")).toEqual([]);
  });
});
