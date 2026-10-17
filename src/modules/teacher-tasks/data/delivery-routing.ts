import "server-only";
import {createAdminClient} from "@/platform/supabase/admin";
import {fetchInChunks} from "@/platform/helpers/chunk";
import {IN_FILTER_CHUNK_SIZE} from "@/platform/helpers/in-filter";
/** Route legacy request issuance to the managed task, retaining historic rows. */
export async function managedTasksForRequests(requestIds:string[]):Promise<Map<string,string>> {
  if(!requestIds.length)return new Map();
  const db=createAdminClient();
  const rows=await fetchInChunks<{id:string;request_id:string}>([...new Set(requestIds)],IN_FILTER_CHUNK_SIZE,ids=>db.from("teacher_tasks").select("id,request_id").in("request_id",ids));
  if(rows.error)throw new Error("task_delivery_routing_unavailable");
  return new Map(rows.data.map(r=>[r.request_id,r.id]));
}
