import "server-only";
import { cache } from "react";
import { createAdminClient } from "@/platform/supabase/admin";

export type FeesBridgeState = {
  enabled:boolean;live_read_ready:boolean;last_revision:number|string;
  active_session_label:string|null;captured_at:string|null;applied_at:string|null;
  last_checked_at:string|null;last_error_code:string|null;
};

export type BridgeHealthStatus="ready"|"not_ready"|"stale"|"error";

/**
 * How old the last successful check may be. The roster is copied from Fees
 * once a night (20:30 UTC, 02:00 IST: owner's decision, 6 Nov 2026, D-457),
 * so a day plus two hours of slack. One missed night shows the stale banner
 * by 04:00 IST the next morning. The same figure is in the four SQL readers
 * migration 20261106162701 rewrote; change both together.
 */
export const BRIDGE_FRESH_FOR_MS=26*60*60_000;
export function bridgeHealthStatus(state:FeesBridgeState|null,now=Date.now()):BridgeHealthStatus {
  if(!state || !state.enabled || !state.live_read_ready || !/^\d+$/.test(String(state.last_revision)) || BigInt(state.last_revision)<=BigInt(0))return "not_ready";
  if(state.last_error_code)return "error";
  const checked=Date.parse(state.last_checked_at ?? "");
  if(!Number.isFinite(checked) || now-checked>BRIDGE_FRESH_FOR_MS || checked>now+60_000)return "stale";
  return "ready";
}

export const readFeesBridgeHealth = cache(async ():Promise<{state:FeesBridgeState|null;status:BridgeHealthStatus}> => {
  const {data,error} = await createAdminClient().from("fees_bridge_state")
    .select("enabled,live_read_ready,last_revision,active_session_label,captured_at,applied_at,last_checked_at,last_error_code")
    .eq("id",true).maybeSingle<FeesBridgeState>();
  return {state:data,status:error?"error":bridgeHealthStatus(data)};
});

export const readFeesBridgeState = cache(async ():Promise<FeesBridgeState> => {
  const health=await readFeesBridgeHealth();
  if(health.status!=="ready" || !health.state){
    throw new Error("The school roster is not ready. Open Fees for current financial records.");
  }
  return health.state;
});
