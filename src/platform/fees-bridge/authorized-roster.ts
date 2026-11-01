import "server-only";
import { getOptionalEnvVar, getServerSupabaseUrl } from "@/platform/env";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { assertBridgeSession, feesBridgeEnabled } from "./policy";
import { readFeesBridgeState } from "./state";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS=new Set(["id","full_name","admission_no","father_name","mother_name","guardian_phone","primary_phone","class_id","roll_no","status"]);

/**
 * A token/task read, explicitly separated from authenticated staff reads.
 * Callers revalidate the capability and derive member IDs server-side before
 * passing this scope. No unauthenticated request gets an implicit fallback.
 * Only this small identity column set is available; no arbitrary table/RPC.
 */
export async function readAuthorizedRosterRows(options:{
  sessionLabel:string;studentIds:readonly string[];columns:readonly string[];
  authorize:()=>Promise<boolean>;
}):Promise<{data:Record<string,string|null>[];error:null}> {
  if(!feesBridgeEnabled() || !(await options.authorize()))throw new Error("The roster capability is unavailable.");
  const ids=[...new Set(options.studentIds)];
  if(ids.some(id=>!UUID.test(id)) || options.columns.some(column=>!COLUMNS.has(column)))throw new Error("This roster scope is not supported.");
  const test=isTestSessionLabel(options.sessionLabel);
  if(!test){assertBridgeSession(options.sessionLabel);await readFeesBridgeState();}
  const key=getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY");
  if(!key)throw new Error("The scoped roster reader is not configured.");
  const data:Record<string,string|null>[]=[];
  for(let start=0;start<ids.length;start+=100){
    const url=new URL(`/rest/v1/${test?"students":"fees_bridge_students"}`,getServerSupabaseUrl());
    url.searchParams.set("select",[...new Set(["id",...options.columns]),...(test?["_scope:classes!students_class_id_fkey!inner(session_label)"]:[])].join(","));
    url.searchParams.set("id",`in.(${ids.slice(start,start+100).join(",")})`);
    url.searchParams.set(test?"_scope.session_label":"session_label",`eq.${options.sessionLabel}`);
    const response=await fetch(url,{headers:{apikey:key,Authorization:`Bearer ${key}`,"Accept-Profile":test?"public":"vppsone"},cache:"no-store",redirect:"error"});
    if(!response.ok)throw new Error("The scoped roster is unavailable.");
    const rows:unknown=await response.json();
    if(!Array.isArray(rows))throw new Error("The scoped roster is unavailable.");
    for(const row of rows){
      if(!row || typeof row!=="object" || !ids.includes(row.id))throw new Error("The roster response is outside its authorized scope.");
      data.push(Object.fromEntries([...new Set(["id",...options.columns])].map(column=>[column,row[column] == null ? null : String(row[column])])));
    }
  }
  // A capability revoked while the bounded read was running must not return
  // names; the caller's existing save guard also rechecks it independently.
  if(!(await options.authorize()))throw new Error("The roster capability has ended.");
  return {data,error:null};
}
