import "server-only";
import {assertStaff} from "@/platform/auth/current-staff";
import {canAny} from "@/platform/auth/permissions";
import {canAccessSession,isTestSessionLabel} from "@/platform/auth/test-session-policy";
import {classScopeFor} from "@/modules/attendance/data/teaching-repo";
import {scopeIncludes} from "@/modules/attendance/domain/class-scope";
import {createAdminClient} from "@/platform/supabase/admin";
import {fetchAllPages,fetchInChunks} from "@/platform/helpers/chunk";
import {IN_FILTER_CHUNK_SIZE} from "@/platform/helpers/in-filter";
import {usesCanonicalFees} from "./policy";
import {readFeesBridgeState} from "./state";

type AcademicIdentity={student_id:string;class_id:string;session_label:string};
type RetiredRow={id:string;session_label:string;fields:Record<string,unknown>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=(value:unknown)=>typeof value==="string"?value:null;

/** One-owned history establishes membership; source tombstones supply display labels only. */
async function authorizedHistory(studentIds:readonly string[]|null,sessionLabel?:string):Promise<AcademicIdentity[]> {
  const staff=await assertStaff();
  if(!usesCanonicalFees(staff,sessionLabel))return [];
  if(!canAny(staff,["attendance:view","reports:view","students:view"]))throw new Error("Historical student records are not permitted.");
  if(sessionLabel && (!canAccessSession(staff,sessionLabel)||isTestSessionLabel(sessionLabel)))return [];
  await readFeesBridgeState();
  const admin=createAdminClient();
  const query=(ids:readonly string[]|null)=>{
    let result=admin.from("enrolments").select("student_id,class_id,session_label");
    if(ids)result=result.in("student_id",[...ids]);
    if(sessionLabel)result=result.eq("session_label",sessionLabel);
    return result;
  };
  const {data,error}=studentIds
    ? await fetchInChunks<AcademicIdentity>(studentIds.filter(id=>UUID.test(id)),IN_FILTER_CHUNK_SIZE,ids=>query(ids))
    : await fetchAllPages<AcademicIdentity>((from,to)=>query(null).order("student_id").order("class_id").range(from,to));
  if(error)throw new Error("Historical academic membership is unavailable.");
  const rows=(data??[]).filter(row=>canAccessSession(staff,row.session_label)&&!isTestSessionLabel(row.session_label));
  const scopes=new Map(await Promise.all([...new Set(rows.map(row=>row.session_label))].map(async session=>[session,await classScopeFor(staff,session)] as const)));
  return rows.filter(row=>scopeIncludes(scopes.get(row.session_label)!,row.class_id));
}

export type HistoricalStudentLabel={id:string;full_name:string;admission_no:string|null;father_name:string|null};
export async function retiredStudentLabels(studentIds:readonly string[],sessionLabel?:string):Promise<HistoricalStudentLabel[]> {
  if(studentIds.length===0)return [];
  const membership=await authorizedHistory(studentIds,sessionLabel);
  const ids=[...new Set(membership.map(row=>row.student_id))];
  const permitted=new Set(membership.map(row=>`${row.student_id}:${row.session_label}`));
  if(ids.length===0)return [];
  const {data,error}=await fetchInChunks<RetiredRow>(ids,IN_FILTER_CHUNK_SIZE,chunk=>createAdminClient().from("fees_bridge_retired_students").select("id,session_label,fields").in("id",chunk));
  if(error)throw new Error("Historical student labels are unavailable.");
  return data.flatMap(row=>{
    const name=text(row.fields.full_name);
    return permitted.has(`${row.id}:${row.session_label}`)&&name&&!isTestSessionLabel(row.session_label)?[{id:row.id,full_name:name,admission_no:text(row.fields.admission_no),father_name:text(row.fields.father_name)}]:[];
  });
}

/** Never used by active class choices, financial queries or any save authorization. */
export async function retiredClassLabels(sessionLabel:string):Promise<{id:string;class_name:string;section:string|null;sort_order:number|null}[]> {
  const membership=await authorizedHistory(null,sessionLabel);
  const ids=[...new Set(membership.map(row=>row.class_id))];
  if(ids.length===0)return [];
  const {data,error}=await fetchInChunks<RetiredRow>(ids,IN_FILTER_CHUNK_SIZE,chunk=>createAdminClient().from("fees_bridge_retired_classes").select("id,session_label,fields").in("id",chunk));
  if(error)throw new Error("Historical class labels are unavailable.");
  return data.flatMap(row=>{
    const name=text(row.fields.class_name);
    return ids.includes(row.id)&&row.session_label===sessionLabel&&name&&!isTestSessionLabel(row.session_label)?[{id:row.id,class_name:name,section:text(row.fields.section),sort_order:typeof row.fields.sort_order==="number"?row.fields.sort_order:null}]:[];
  });
}
