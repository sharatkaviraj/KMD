import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({cookies:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("next/headers",()=>({cookies:mocks.cookies}));
vi.mock("@/platform/auth/test-accounts",()=>({isQaEmail:(email:string|null)=>email?.endsWith("@qa.vpps.local"),qaToolsEnabled:()=>true}));
vi.mock("@/modules/smoke/domain/pool",()=>({isSmokeEmail:()=>false}));
vi.mock("@/platform/auth/smoke-lab",()=>({smokeLabEnabled:()=>false}));
import { schoolNow } from "@/platform/auth/qa-clock";

describe("promoted QA-domain accounts use the real school clock",()=>{
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-01T05:00:00Z"));
    mocks.cookies.mockReset().mockResolvedValue({get:()=>({value:"2026-10-12T10:15"})});
  });
  afterEach(()=>vi.useRealTimers());
  it("ignores a retained QA clock cookie after the account becomes real",async()=>{
    expect((await schoolNow({email:"approved@qa.vpps.local",isTestAccount:false})).toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it("does not infer TEST status from an address",async()=>{
    expect((await schoolNow({email:"approved@qa.vpps.local"})).toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(mocks.cookies).not.toHaveBeenCalled();
  });
  it("retains the authorized TEST clock behavior",async()=>{
    expect((await schoolNow({email:"test@qa.vpps.local",isTestAccount:true})).toISOString()).toBe("2026-10-12T04:45:00.000Z");
  });
});
