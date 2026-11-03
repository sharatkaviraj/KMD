import {afterEach,describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/platform/env",()=>({getOptionalEnvVar:()=>"synthetic-one-key",getServerSupabaseUrl:()=>"https://one.supabase.co"}));
import {verifyOneTestReceipt} from "@/platform/fees-bridge/test-receipt";
const receipt={id:"00000000-0000-4000-8000-000000000001",receipt_number:"TST-001",payment_date:"2026-11-01",total_amount:500,student:{class:{session_label:"TEST-2026-27"}}};
afterEach(()=>vi.unstubAllGlobals());
describe("public One TEST receipt verification",()=>{
  it("does not use local lookup for a real receipt number",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    expect(await verifyOneTestReceipt("SVP-001")).toEqual({state:"invalid"});expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires the receipt student to belong to TEST, independent of its prefix",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json([{...receipt,student:{class:{session_label:"2026-27"}}}]));vi.stubGlobal("fetch",fetcher);
    expect(await verifyOneTestReceipt("TST-001")).toEqual({state:"invalid"});expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps reversal failure distinct from a valid receipt",async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json([receipt])).mockResolvedValueOnce(new Response("failed",{status:503}));vi.stubGlobal("fetch",fetcher);
    expect(await verifyOneTestReceipt("TST-001")).toEqual({state:"unverifiable",receiptNumber:"TST-001"});
  });
});
