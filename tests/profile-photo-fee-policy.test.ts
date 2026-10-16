import { beforeEach, expect, it, vi } from "vitest";
import { can, type StaffRole } from "@/platform/auth/permissions";
const mocks=vi.hoisted(()=>({require:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/platform/auth/current-staff",()=>({requirePermission:mocks.require,getCurrentStaff:vi.fn()}));
vi.mock("next/navigation",()=>({redirect:vi.fn()}));
import { requireAnyStaffPermission } from "@/modules/fees/platform/session";
beforeEach(()=>{mocks.require.mockReset();});
const person=(role:StaffRole)=>({id:"synthetic",userId:"synthetic",displayName:"Synthetic staff",shortName:"TEST",role,language:"en",isActive:true,email:null,preferredStart:null,isTeaching:role==="teacher"});
it("the reachable fee-photo guard first denies a native teacher without fees:view",async()=>{
  expect(can(person("teacher"),"fees:view")).toBe(false);
  mocks.require.mockImplementation((permission:string)=>{if(!can(person("teacher"),permission as "fees:view"))throw new Error("Denied native fee permission");});
  await expect(requireAnyStaffPermission(["students:write","students:edit_basic"])).rejects.toThrow("Denied native fee permission");
  expect(mocks.require).toHaveBeenCalledWith("fees:view",undefined);
});
it("office maps to fee view_only and cannot use the old photo writer",async()=>{
  mocks.require.mockResolvedValue(person("office"));
  await expect(requireAnyStaffPermission(["students:write","students:edit_basic"])).rejects.toThrow("required permissions");
});
it("the existing legitimate admin fee-photo permission remains",async()=>{
  mocks.require.mockResolvedValue(person("admin"));
  expect((await requireAnyStaffPermission(["students:write","students:edit_basic"])).appRole).toBe("admin");
});
