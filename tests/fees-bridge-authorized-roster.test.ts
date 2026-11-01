import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
const state=vi.hoisted(()=>vi.fn());
vi.mock("@/platform/fees-bridge/state",()=>({readFeesBridgeState:state}));
vi.mock("@/platform/env",()=>({getOptionalEnvVar:()=>"synthetic-one-key",getServerSupabaseUrl:()=>"https://one.supabase.co"}));
import {readAuthorizedRosterRows} from "@/platform/fees-bridge/authorized-roster";
const id="00000000-0000-4000-8000-000000000001";
const options={sessionLabel:"2026-27",studentIds:[id],columns:["id","full_name"]};
beforeEach(()=>{vi.stubEnv("FEES_BRIDGE_ENABLED","true");state.mockResolvedValue({});});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
describe("capability-scoped roster reads",()=>{
  it("does not read without an explicit verified capability",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    await expect(readAuthorizedRosterRows({...options,authorize:async()=>false})).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("bounds the request to verified IDs and session and rechecks revocation",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json([{id,full_name:"Synthetic Student",guardian_phone:"not requested"}]));vi.stubGlobal("fetch",fetcher);
    const authorize=vi.fn().mockResolvedValue(true);
    const result=await readAuthorizedRosterRows({...options,authorize});
    expect(result.data).toEqual([{id,full_name:"Synthetic Student"}]);
    const url=fetcher.mock.calls[0][0] as URL;
    expect(url.origin).toBe("https://one.supabase.co");
    expect(url.pathname).toBe("/rest/v1/fees_bridge_students");
    expect(url.searchParams.get("id")).toBe(`in.(${id})`);expect(url.searchParams.get("session_label")).toBe("eq.2026-27");
    expect(authorize).toHaveBeenCalledTimes(2);
  });
  it("rejects extra IDs, unsupported fields and capability revocation during the read",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json([{id,full_name:"Synthetic Student"}])));
    await expect(readAuthorizedRosterRows({...options,columns:["financial_summary"],authorize:async()=>true})).rejects.toThrow();
    const authorize=vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(readAuthorizedRosterRows({...options,authorize})).rejects.toThrow("ended");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json([{id:"00000000-0000-4000-8000-000000000002",full_name:"Outside scope"}])));
    await expect(readAuthorizedRosterRows({...options,authorize:async()=>true})).rejects.toThrow("outside");
  });
});
