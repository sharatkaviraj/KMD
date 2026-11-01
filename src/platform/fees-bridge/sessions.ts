import "server-only";
import {assertStaff} from "@/platform/auth/current-staff";
import {createAdminClient} from "@/platform/supabase/admin";
import {usesCanonicalFees} from "./policy";
import {readFeesBridgeState} from "./state";
import type {AvailableSessionRow} from "@/modules/fees/platform/session-context/available-sessions";

/** Session metadata needs staff access, not an implicit cookie-client RLS bypass. */
export async function readBridgeSwitcherRows():Promise<{activeSessionLabel:string;availableSessions:AvailableSessionRow[]}> {
  const staff=await assertStaff();
  if(!usesCanonicalFees(staff))throw new Error("The live academic sessions are unavailable.");
  const state=await readFeesBridgeState();
  const admin=createAdminClient();
  const {data,error}=await admin.from("fees_bridge_sessions").select("id,session_label,status,is_current").returns<AvailableSessionRow[]>();
  if(error || !state.active_session_label)throw new Error("The live academic sessions are unavailable.");
  let available=(data??[]).filter(row=>/^\d{4}-\d{2}$/.test(row.session_label));
  if(staff.role==="admin"){
    const test=await admin.schema("public").from("academic_sessions").select("id,session_label,status,is_current").eq("session_label","TEST-2026-27").returns<AvailableSessionRow[]>();
    if(!test.error)available=[...available,...(test.data??[])];
  }
  return {activeSessionLabel:state.active_session_label,availableSessions:available};
}
