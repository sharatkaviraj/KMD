"use server";
import { revalidatePath } from "next/cache";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertNotPreviewing } from "@/vx/view-as";
import { createAdminClient } from "@/platform/supabase/admin";
import { getSiteUrl } from "@/platform/env";
import { taskDeliveryAvailability } from "@/modules/collection/data/message-provider";
import { dispatchTeacherTaskMessage } from "@/modules/collection/data/messages-repo";
import type { DeliveryPreview, DeliveryResult } from "@/modules/teacher-tasks/domain/delivery";

const uuid = /^[0-9a-f-]{36}$/i;
export async function previewTaskDeliveryAction(id: string, kind: "initial" | "reminder"): Promise<DeliveryPreview | Extract<DeliveryResult,{ok:false}>> {
  const actor = await assertPermission("collection:manage"); await assertNotPreviewing();
  if (!uuid.test(id) || !["initial","reminder"].includes(kind)) return {ok:false,reason:"changed"};
  const {data,error} = await createAdminClient().rpc("prepare_teacher_task_delivery",{p_actor:actor.id,p_task:id,p_kind:kind});
  if(error || !data) return {ok:false,reason:"unavailable"};
  return data;
}

export async function confirmTaskDeliveryAction(previewId: string, digest: string, mode: "api" | "manual"): Promise<DeliveryResult> {
  const actor = await assertPermission("collection:manage"); await assertNotPreviewing();
  if (!uuid.test(previewId) || !/^[a-f0-9]{32}$/.test(digest) || !["api","manual"].includes(mode)) return {ok:false,reason:"changed"};
  if (mode === "api") { const available=taskDeliveryAvailability(); if(available!=="ready")return {ok:false,reason:available}; }
  const db=createAdminClient();
  const queued=await db.rpc("queue_teacher_task_delivery",{p_actor:actor.id,p_preview:previewId,p_digest:digest});
  if(queued.error || !queued.data) return {ok:false,reason:"reconcile"};
  if(!queued.data.ok)return queued.data;
  let result:DeliveryResult;
  if(mode==="api") result=await dispatchTeacherTaskMessage(actor.id,queued.data.id);
  else {
    const claim=await db.rpc("claim_teacher_task_delivery",{p_actor:actor.id,p_id:queued.data.id,p_attempt:"manual",p_transport:"manual",p_manual:true});
    if(claim.error || !claim.data)return {ok:false,reason:"reconcile"};
    if(!claim.data.ok)return claim.data;
    const link=`${getSiteUrl().replace(/\/$/,"")}${claim.data.path}`;
    result={ok:true,state:"manual_opened",url:`https://wa.me/91${claim.data.phone}?text=${encodeURIComponent(`${claim.data.text}\n${link}`)}`};
  }
  revalidatePath("/inbox"); return result;
}

export async function reconcileTaskDeliveryAction(id:string,attempt:string|null,resolution:"accepted"|"not_sent",note:string):Promise<boolean> {
  const actor=await assertPermission("collection:manage");await assertNotPreviewing();
  if(!uuid.test(id)||(attempt!==null&&!/^attempt:[0-9a-f-]{36}$/i.test(attempt))||!["accepted","not_sent"].includes(resolution)||note.trim().length<5||note.length>500)return false;
  const {data,error}=await createAdminClient().rpc("reconcile_teacher_task_delivery",{p_actor:actor.id,p_id:id,p_attempt:attempt,p_resolution:resolution,p_note:note.trim()});
  revalidatePath("/inbox");return !error&&data===true;
}
