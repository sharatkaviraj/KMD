"use server";
import { revalidatePath } from "next/cache";
import { assertStaff } from "@/platform/auth/current-staff";
import { assertNotPreviewing } from "@/vx/view-as";
import { createAdminClient } from "@/platform/supabase/admin";
import { photoAuthority, readPhotoContext, PHOTO_UUID } from "@/modules/collection/data/profile-photo-context";
import { photoOutcome } from "@/modules/collection/data/photo-proposals";
import { placePhoto } from "@/modules/collection/data/photos-repo";
import { preparePhoto, stagePhoto } from "@/modules/collection/data/photo-storage";
import { submitCollectionPhoto } from "@/modules/teacher-tasks/data/collection-save";
import type { PhotoCredential, PhotoSaveResult } from "@/modules/collection/domain/profile-photo";

export async function openPhotoEditorAction(credential: PhotoCredential, studentId?: string) {
  try {
    const auth = await photoAuthority(credential, studentId);
    return { ok: true as const, context: await readPhotoContext(auth), credential: auth.credential };
  } catch { return { ok: false as const }; }
}

export async function saveProfilePhotoAction(credential: PhotoCredential, form: FormData): Promise<PhotoSaveResult> {
  let auth;
  try { auth = await photoAuthority(credential, String(form.get("studentId") ?? "")); } catch { return { ok: false, reason: "not_permitted" }; }
  if (form.get("scope") !== auth.scope) return { ok: false, reason: "not_permitted" };
  const commandId = String(form.get("commandId") ?? "");
  const expectedCurrent = String(form.get("expectedCurrent") ?? "") || null;
  const expectedProposal = String(form.get("expectedProposal") ?? "") || null;
  const file = form.get("photo");
  const source = form.get("source") === "camera" ? "camera" : "file";
  if (!PHOTO_UUID.test(commandId) || (expectedCurrent && !PHOTO_UUID.test(expectedCurrent)) || (expectedProposal && !PHOTO_UUID.test(expectedProposal)) || !(file instanceof Blob) || file.size > 8 * 1024 * 1024) return { ok: false, reason: "bad_request" };
  const bytes = await file.arrayBuffer();
  let result: PhotoSaveResult;
  if (auth.request) {
    result = await submitCollectionPhoto(auth.request, { commandId, studentId: auth.target, expectedCurrent, expectedProposal, bytes, source });
  } else if (auth.staff) {
    const photo = await preparePhoto(bytes);
    if (typeof photo === "string") return { ok: false, reason: photo };
    const path = `staff/${auth.target}/${commandId}.jpg`;
    const staged = await stagePhoto(path, photo);
    if (staged) return { ok: false, reason: staged };
    try {
      const response = await createAdminClient().rpc("save_staff_photo", { p_actor: auth.actorId, p_staff: auth.target, p: {
        command_id: commandId, storage_path: path, content_type: photo.contentType, byte_size: photo.bytes.byteLength,
        sha256: photo.sha256, width: photo.width, height: photo.height, expected_current: expectedCurrent,
      } });
      result = photoOutcome(response.data, response.error);
    } catch { result = { ok: false, reason: "unknown" }; }
  } else {
    result = await placePhoto({ commandId, studentId: auth.target, actorStaffId: auth.actorId, sessionLabel: auth.session, bytes, contentType: file.type, width: null, height: null, source, sourceRef: null, expectedCurrent });
  }
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function reviewPhotoAction(proposalId: string, accept: boolean): Promise<PhotoSaveResult> {
  const actor = await assertStaff();
  await assertNotPreviewing();
  if (actor.role !== "admin" || !PHOTO_UUID.test(proposalId) || typeof accept !== "boolean") return { ok: false, reason: "not_permitted" };
  try {
    const result = await createAdminClient().rpc("review_student_photo", { p_actor: actor.id, p_proposal: proposalId, p_accept: accept });
    const outcome = photoOutcome(result.data, result.error);
    if (outcome.ok) revalidatePath("/", "layout");
    return outcome;
  } catch { return { ok: false, reason: "unknown" }; }
}
