import "server-only";
import { m } from "@/messages";
import { rollForRequest } from "@/modules/collection/data/requests-repo";
import { recordAnswers, type IncomingAnswer } from "@/modules/collection/data/submissions-repo";
import { validateField } from "@/modules/collection/domain/fields";
import type { CollectionRequest } from "@/modules/collection/domain/requests";
import type { LinkState } from "@/modules/collection/domain/link-state";
import type { PhotoInput, PhotoSaveResult } from "@/modules/collection/domain/profile-photo";
import { submitPhotoProposal } from "@/modules/collection/data/photo-proposals";
import { createAdminClient } from "@/platform/supabase/admin";
import type { TaskCredential } from "./save";
/** Caller resolves either the current session assignment or the scoped public token. */
export async function submitCollectionPayload(request: CollectionRequest, payload: unknown, task?: TaskCredential): Promise<LinkState> {
  if (!Array.isArray(payload) || payload.length > 40000) return { status: "error", message: m.notSaved };
  const roll = await rollForRequest(request);
  const onRoll = new Map(roll.map(r => [r.studentId, r]));
  const fields = new Map(request.fields.map(f => [f.key, f]));
  const answers = new Map<string, IncomingAnswer>();
  for (const entry of payload) {
    if (!entry || typeof entry !== "object") return { status: "error", message: m.notSaved };
    const { studentId, key, value } = entry;
    const row = onRoll.get(studentId); const field = fields.get(key);
    if (!row || !field || field.key === "student_photo" || (typeof value !== "string" && value !== null)) return { status: "error", message: m.notSaved };
    const checked = validateField(field, value ?? "");
    if (!checked.ok) return { status: "error", message: checked.error };
    answers.set(`${studentId}:${field.id}`, { studentId, fieldId: field.id, value: checked.value, previousValue: row.current[field.key] ?? null });
  }
  try {
    if (task) {
      const result = await createAdminClient().rpc("save_teacher_task", {
        p_id: task.id, p_staff: task.staffId ?? null, p_token: task.token ?? null,
        p: { kind: "collection", request_id: request.id, request_token: request.token, answers: [...answers.values()] },
      });
      if (result.error || result.data?.ok !== true) return { status: "error", message: m.notSaved };
    } else await recordAnswers(request, [...answers.values()]);
  } catch { return { status: "error", message: m.notSaved }; }
  return { status: "saved", message: m.linkSaved };
}

/** Multipart counterpart of the same scoped collection save. No caller path is accepted. */
export async function submitCollectionPhoto(request: CollectionRequest, input: PhotoInput): Promise<PhotoSaveResult> {
  if (!request.fields.some(field => field.key === "student_photo") || !(await rollForRequest(request)).some(row => row.studentId === input.studentId)) return { ok: false, reason: "not_permitted" };
  return submitPhotoProposal(request, input);
}
