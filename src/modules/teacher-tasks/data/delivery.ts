import "server-only";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { taskDeliveryAvailability } from "@/modules/collection/data/message-provider";
import type { DeliverySummary } from "../domain/delivery";
export async function loadTaskDelivery(id:string) {
  const actor=await assertPermission("collection:manage");
  const {data,error}=await createAdminClient().rpc("teacher_task_delivery_summary",{p_actor:actor.id,p_task:id});
  if(error||!data)throw new Error("delivery_unavailable");
  return {summary:data as DeliverySummary,availability:taskDeliveryAvailability()};
}
