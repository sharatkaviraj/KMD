import {describe,it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/platform/supabase/admin",()=>({createAdminClient:vi.fn()}));
import {bridgeHealthStatus,type FeesBridgeState} from "@/platform/fees-bridge/state";
const now=Date.parse("2026-11-01T04:00:00Z");
const healthy:FeesBridgeState={enabled:true,live_read_ready:true,last_revision:"5",active_session_label:"2026-27",captured_at:null,applied_at:null,last_checked_at:"2026-11-01T03:59:00Z",last_error_code:null};
describe("nightly roster freshness",()=>{
  it("requires publication, a source revision and a recent successful check",()=>{
    expect(bridgeHealthStatus(healthy,now)).toBe("ready");
    // Copied once a night: last night's check is still current the next afternoon.
    expect(bridgeHealthStatus({...healthy,last_checked_at:"2026-10-31T20:30:05Z"},now)).toBe("ready");
    for(const state of [null,{...healthy,enabled:false},{...healthy,live_read_ready:false},{...healthy,last_revision:0},{...healthy,last_revision:"garbled"}])expect(bridgeHealthStatus(state,now)).toBe("not_ready");
  });
  it("rejects stale, future or missing check times and explicit worker errors",()=>{
    for(const checked of [null,"bad","2026-10-31T01:59:00Z","2026-11-01T04:05:00Z"])expect(bridgeHealthStatus({...healthy,last_checked_at:checked},now)).toBe("stale");
    expect(bridgeHealthStatus({...healthy,last_error_code:"source_unavailable"},now)).toBe("error");
  });
});
