import "server-only";
import type { CollectionRequest } from "../domain/requests";
import type { PhotoInput, PhotoSaveResult } from "../domain/profile-photo";
import { createAdminClient } from "@/platform/supabase/admin";
import { preparePhoto, stagePhoto } from "./photo-storage";

export function photoOutcome(data: unknown, error: { code?: string; message?: string } | null): PhotoSaveResult {
  if (error?.code === "P0001" && /^(photos|tasks):[a-z_]+$/.test(error.message ?? "")) return { ok: false, reason: error.message!.split(":")[1] };
  if (error || !data || typeof data !== "object" || !("ok" in data)) return { ok: false, reason: "unknown" };
  if (data.ok === true) return { ok: true };
  if (data.ok === false && "reason" in data && typeof data.reason === "string") return { ok: false, reason: data.reason };
  return { ok: false, reason: "unknown" };
}

/** Only called after the same authorized request resolution as scalar answers. */
export async function submitPhotoProposal(request: CollectionRequest, input: PhotoInput): Promise<PhotoSaveResult> {
  const photo = await preparePhoto(input.bytes);
  if (typeof photo === "string") return { ok: false, reason: photo };
  const path = `proposals/${request.id}/${input.studentId}/${input.commandId}.jpg`;
  const staged = await stagePhoto(path, photo);
  if (staged) return { ok: false, reason: staged };
  try {
    const result = await createAdminClient().rpc("submit_student_photo", { p_request: request.id, p_token: request.token, p: {
      command_id: input.commandId, student_id: input.studentId, session_label: request.sessionLabel,
      storage_path: path, content_type: photo.contentType, byte_size: photo.bytes.byteLength,
      sha256: photo.sha256, width: photo.width, height: photo.height, source: input.source,
      expected_current: input.expectedCurrent, expected_proposal: input.expectedProposal,
    } });
    return photoOutcome(result.data, result.error);
  } catch { return { ok: false, reason: "unknown" }; }
}
