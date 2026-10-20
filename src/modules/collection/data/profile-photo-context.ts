import "server-only";
import { createHash } from "node:crypto";
import { assertStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { assertNotPreviewing } from "@/vx/view-as";
import { createAdminClient } from "@/platform/supabase/admin";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { resolveTask, resolveTaskToken } from "@/modules/teacher-tasks/data/repo";
import { clientIp, limitByIp, limitByToken, limitUnknownToken } from "./rate-limit";
import { resolveAssignedRequest, resolveToken, rollForRequest } from "./requests-repo";
import type { CollectionRequest } from "../domain/requests";
import type { PhotoCredential, PhotoEditorContext } from "../domain/profile-photo";
import { PHOTOS_BUCKET } from "./photo-storage";
import { assignedRequestGeneration } from "@/modules/teacher-tasks/data/draft-scope";

export const PHOTO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type PhotoAuthority = { actorId: string; target: string; session: string; credential: PhotoCredential; request: CollectionRequest | null; scope: string; staff: boolean };

/** Keep the caller's capability, never authority borrowed from a later assignee.
 * Run after all context reads/signing as well, so a rotation during a read cannot
 * return data from the replacement generation. No photo reads follow that check.
 */
async function assertCurrentPhotoRequest(auth: PhotoAuthority): Promise<void> {
  if (!auth.request) return;
  const db = createAdminClient();
  if (auth.credential.kind === "task") {
    const access = await db.rpc("teacher_task_access", {
      p_id: auth.credential.id,
      p_staff: auth.credential.token ? null : auth.actorId,
      p_token: auth.credential.token ?? null,
    });
    if (access.error || access.data !== true) throw new Error("not_permitted");
  } else if (auth.credential.kind === "request") {
    if (auth.credential.token !== auth.request.token) throw new Error("not_permitted");
    const current = await resolveToken(auth.credential.token);
    if (!current || current.id !== auth.request.id || current.token !== auth.request.token) throw new Error("not_permitted");
  } else if (auth.credential.kind === "assigned-request") {
    const current = await resolveAssignedRequest(auth.credential.id, auth.actorId);
    if (!current || current.token !== auth.request.token || auth.credential.generation !== assignedRequestGeneration(auth.actorId,current.id,current.token)) throw new Error("not_permitted");
  } else throw new Error("not_permitted");
  const generation = await db.from("collection_requests").select("id")
    .eq("id", auth.request.id).eq("token", auth.request.token)
    .eq("status", "open").is("archived_at", null).maybeSingle();
  if (generation.error || !generation.data) throw new Error("not_permitted");
}

export async function photoAuthority(credential: PhotoCredential, studentId?: string): Promise<PhotoAuthority> {
  if (!credential || typeof credential !== "object") throw new Error("not_permitted");
  const db = createAdminClient();
  let request: CollectionRequest | null = null;
  let actorId = "public";
  let target = studentId ?? "";
  let session = "";
  if (credential.kind === "request" || (credential.kind === "task" && credential.token)) {
    const token = credential.token!;
    const ip = await clientIp();
    if (!(await limitByIp(ip)).allowed || !(await limitByToken(token)).allowed) throw new Error("rate_limit");
    if (credential.kind === "request") request = await resolveToken(token);
    else {
      const task = await resolveTaskToken(token);
      if (task && task.id === credential.id && task.kind === "collection") request = await resolveAssignedRequest(task.request_id!, task.assigned_staff_id);
    }
    if (!request) { await limitUnknownToken(ip); throw new Error("not_permitted"); }
  } else {
    const actor = await assertStaff();
    await assertNotPreviewing();
    actorId = actor.id;
    if (credential.kind === "staff") {
      target = credential.id ?? actor.id;
      if (!PHOTO_UUID.test(target) || (target !== actor.id && !can(actor, "staff:manage"))) throw new Error("not_permitted");
    } else if (credential.kind === "student") {
      target = credential.id;
      if (!PHOTO_UUID.test(target)) throw new Error("not_permitted");
      session = await resolveSessionLabel() ?? "";
      if (!session) throw new Error("unavailable");
      if (!((actor.role === "admin" || actor.role === "office") && can(actor, "collection:manage"))) {
        const result = await db.rpc("ensure_student_photo_task", { p_actor: actor.id, p_student: target, p_session: session });
        if (result.error || typeof result.data !== "string") throw new Error("not_permitted");
        credential = { kind: "task", id: result.data };
      }
    }
    if (credential.kind === "assigned-request") {
      if (!PHOTO_UUID.test(credential.id)) throw new Error("not_permitted");
      request = await resolveAssignedRequest(credential.id, actor.id);
      if (!request || credential.generation !== assignedRequestGeneration(actor.id,request.id,request.token)) throw new Error("not_permitted");
    } else if (credential.kind === "task") {
      const task = await resolveTask({ id: credential.id, staffId: actor.id });
      if (task?.kind === "collection") request = await resolveAssignedRequest(task.request_id!, actor.id);
      if (!request) throw new Error("not_permitted");
    } else if (credential.kind !== "staff" && credential.kind !== "student") throw new Error("not_permitted");
  }
  if (request) {
    if (!PHOTO_UUID.test(target) || !request.fields.some(f => f.key === "student_photo") || !(await rollForRequest(request)).some(r => r.studentId === target)) throw new Error("not_permitted");
    session = request.sessionLabel;
  }
  const scope = createHash("sha256").update(JSON.stringify([actorId,credential.kind,target,session,request?.id,request?.token])).digest("hex");
  const authority = { actorId, target, session, credential, request, scope, staff: credential.kind === "staff" };
  await assertCurrentPhotoRequest(authority);
  return authority;
}

export async function signedPhoto(path: string | null): Promise<string | null> {
  if (!path) return null;
  const signed = await createAdminClient().storage.from(PHOTOS_BUCKET).createSignedUrl(path, 300);
  if (signed.error) throw new Error("unavailable");
  return signed.data.signedUrl;
}

export async function readPhotoContext(auth: PhotoAuthority): Promise<PhotoEditorContext> {
  await assertCurrentPhotoRequest(auth);
  const db = createAdminClient();
  let currentId: string | null = null, currentPath: string | null = null;
  if (auth.staff) {
    const row = await db.from("staff_photos").select("command_id,payload").eq("staff_id", auth.target).is("replaced_at", null).maybeSingle<{ command_id: string; payload: { storage_path: string } }>();
    if (row.error) throw new Error("unavailable");
    currentId = row.data?.command_id ?? null; currentPath = row.data?.payload.storage_path ?? null;
  } else {
    const row = await db.from("student_photos").select("id,storage_path").eq("student_id", auth.target).is("replaced_at", null).maybeSingle<{ id: string; storage_path: string }>();
    if (row.error) throw new Error("unavailable");
    currentId = row.data?.id ?? null; currentPath = row.data?.storage_path ?? null;
  }
  let proposalId: string | null = null, proposalUrl: string | null = null, decided = false;
  let outcome: "accepted" | "rejected" | null = null, note: string | null = null;
  if (auth.request) {
    const field = auth.request.fields.find(f => f.key === "student_photo")!;
    const answer = await db.from("collection_submissions").select("value,status").eq("request_id", auth.request.id).eq("student_id", auth.target).eq("field_id", field.id).maybeSingle<{ value: string; status: string }>();
    if (answer.error) throw new Error("unavailable");
    proposalId = answer.data?.value ?? null; decided = Boolean(answer.data && answer.data.status !== "pending");
    if (proposalId && decided) {
      const decision = await db.from("photo_proposals").select("decision,decision_note").eq("command_id", proposalId).eq("request_id", auth.request.id).eq("student_id", auth.target).maybeSingle<{ decision: string; decision_note: string | null }>();
      if (decision.error) throw new Error("unavailable");
      outcome = decision.data?.decision === "accepted" ? "accepted" : decision.data?.decision === "rejected" ? "rejected" : null;
      note = decision.data?.decision_note ?? null;
    }
    if (proposalId && !decided) {
      const proposal = await db.from("photo_proposals").select("payload").eq("command_id", proposalId).eq("request_id", auth.request.id).eq("student_id", auth.target).single<{ payload: { storage_path: string } }>();
      if (proposal.error) throw new Error("unavailable");
      proposalUrl = await signedPhoto(proposal.data.payload.storage_path);
    }
  }
  const currentUrl = await signedPhoto(currentPath);
  await assertCurrentPhotoRequest(auth);
  return { scope: auth.scope, studentId: auth.staff ? undefined : auth.target, currentId, currentUrl, proposalId, proposalUrl, decided, proposal: Boolean(auth.request), outcome, note };
}
