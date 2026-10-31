"use server";
import { revalidatePath } from "next/cache";
import { assertStaff } from "@/platform/auth/current-staff";
import {
  assertNotTestAccount,
  assertPhotoProposalVisible,
  assertStudentVisible,
  passesFence,
} from "@/platform/auth/test-session-access";
import { assertNotPreviewing } from "@/vx/view-as";
import { createAdminClient } from "@/platform/supabase/admin";
import { photoAuthority, readPhotoContext, PHOTO_UUID } from "@/modules/collection/data/profile-photo-context";
import { photoOutcome } from "@/modules/collection/data/photo-proposals";
import { placePhoto } from "@/modules/collection/data/photos-repo";
import { preparePhoto, stagePhoto } from "@/modules/collection/data/photo-storage";
import { submitCollectionPhoto } from "@/modules/teacher-tasks/data/collection-save";
import { rejectionNote, type PhotoCredential, type PhotoSaveResult } from "@/modules/collection/domain/profile-photo";

/*
 * The Phase 3 fence on a photo, after `photoAuthority` has said who may act:
 *  - a parent's link (`actorId === "public"`) has nobody signed in; the
 *    request's own roll already ties the child to the request's session;
 *  - a signed-in person working on a CHILD may only reach one whose own
 *    session they may open (a test account never a real child);
 *  - a staff photo has no session, so changing somebody else's is a
 *    school-wide write a test account may not make.
 * Written out in each action, because tests/architecture.test.ts reads the
 * action's own body for the check.
 */

export async function openPhotoEditorAction(credential: PhotoCredential, studentId?: string) {
  try {
    const auth = await photoAuthority(credential, studentId);
    const fenced =
      auth.actorId === "public" ||
      (auth.staff
        ? auth.target === auth.actorId || (await passesFence(() => assertNotTestAccount(null)))
        : await passesFence(() => assertStudentVisible(null, auth.target)));
    if (!fenced) return { ok: false as const };
    return { ok: true as const, context: await readPhotoContext(auth), credential: auth.credential };
  } catch { return { ok: false as const }; }
}

export async function saveProfilePhotoAction(credential: PhotoCredential, form: FormData): Promise<PhotoSaveResult> {
  let auth;
  try { auth = await photoAuthority(credential, String(form.get("studentId") ?? "")); } catch { return { ok: false, reason: "not_permitted" }; }
  if (form.get("scope") !== auth.scope) return { ok: false, reason: "not_permitted" };
  const target = auth.target;
  const fenced =
    auth.actorId === "public" ||
    (auth.staff
      ? target === auth.actorId || (await passesFence(() => assertNotTestAccount(null)))
      : await passesFence(() => assertStudentVisible(null, target)));
  if (!fenced) return { ok: false, reason: "not_permitted" };
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

export async function reviewPhotoAction(proposalId: string, accept: boolean, note?: string): Promise<PhotoSaveResult> {
  const actor = await assertStaff();
  await assertNotPreviewing();
  if (actor.role !== "admin" || !PHOTO_UUID.test(proposalId) || typeof accept !== "boolean") return { ok: false, reason: "not_permitted" };
  // Sending a photograph back says why (U03): the teacher reads it as "Changes requested".
  const reason = accept ? null : rejectionNote(note);
  if (!accept && !reason) return { ok: false, reason: "reason_required" };
  // The photograph's child decides (Phase 3 fence): a test admin never
  // approves a real child's photo.
  if (!(await passesFence(() => assertPhotoProposalVisible(actor, proposalId)))) {
    return { ok: false, reason: "not_permitted" };
  }
  try {
    const result = await createAdminClient().rpc("review_student_photo", { p_actor: actor.id, p_proposal: proposalId, p_accept: accept, p_note: reason });
    const outcome = photoOutcome(result.data, result.error);
    if (outcome.ok) revalidatePath("/", "layout");
    return outcome;
  } catch { return { ok: false, reason: "unknown" }; }
}
