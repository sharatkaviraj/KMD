import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { studentInScope } from "@/modules/collection/data/drive-documents";
import { readStorageSettings } from "@/modules/collection/data/storage-settings";
import { json, readCapped, refuse, sameOrigin, withinRate } from "@/modules/collection/data/upload-http";
import { checkUploadRequest, drivesUploadsFor, sniffDocumentType } from "@/modules/collection/domain/document-files";
import { documentPath } from "@/modules/collection/domain/review";
import { DOCUMENTS_BUCKET } from "@/modules/collection/data/documents-repo";
import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { assertNotPreviewing } from "@/vx/view-as";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Issue a capability for exactly one private object, then verify it before listing. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return refuse("forbidden", 403);
  let actor;
  try { actor = await assertPermission("documents:manage"); await assertNotPreviewing(); }
  catch { return refuse("forbidden", 403); }
  const raw = await readCapped(request, 8192);
  if (!raw) return refuse("invalid", 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return refuse("invalid", 400); }
  if (!body || typeof body !== "object") return refuse("invalid", 400);
  const parsed = checkUploadRequest(body);
  if (!parsed.ok || (body.phase !== "begin" && body.phase !== "finish")) return refuse("invalid", 400);
  const value = parsed.value;
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel || !(await studentInScope(actor, value.studentId, sessionLabel))) return refuse("out_of_scope", 403);
  if (drivesUploadsFor(await readStorageSettings(), actor.id)) return refuse("provider_off", 409);
  if (!withinRate(`bucket:${actor.id}`, 60)) return refuse("too_many", 429, { retryable: true });
  const db = createAdminClient();
  const path = documentPath({ sessionLabel, studentId: value.studentId, id: value.documentId, fileName: value.fileName });
  try {
    if (body.phase === "begin") {
      const { error } = await db.from("student_documents").insert({
        id: value.documentId, client_request_id: value.documentId, session_label: sessionLabel,
        student_id: value.studentId, kind: value.kind, storage_provider: "supabase", storage_path: path,
        upload_state: "uploading", file_name: value.fileName, content_type: value.contentType,
        byte_size: value.byteSize, content_sha256: value.sha256, note: value.note, uploaded_by: actor.id,
      });
      if (error && error.code !== "23505") throw error;
    }
    const { data: row, error } = await db.from("student_documents")
      .select("id, student_id, session_label, kind, storage_provider, storage_path, upload_state, file_name, content_type, byte_size, content_sha256, note, uploaded_by, removed_at, created_at")
      .eq("id", value.documentId).maybeSingle();
    if (error) throw error;
    if (!row || row.uploaded_by !== actor.id || row.student_id !== value.studentId || row.session_label !== sessionLabel ||
        row.storage_provider !== "supabase" || row.storage_path !== path || row.kind !== value.kind || row.file_name !== value.fileName ||
        row.content_type !== value.contentType || Number(row.byte_size) !== value.byteSize || row.content_sha256 !== value.sha256 ||
        row.note !== value.note || row.removed_at) return refuse("conflict", 409);
    if (row.upload_state === "stored") return json({ ok: true, state: "stored" });
    if (row.upload_state !== "uploading") return refuse("failed", 410);
    // Signed upload tokens live for two hours. Stop renewing after one hour,
    // so a later operator can safely clean abandoned uploads after four hours.
    const created = Date.parse(row.created_at);
    if (!Number.isFinite(created) || Date.now() - created > 60 * 60 * 1000) return refuse("expired", 410);
    if (body.phase === "begin") {
      const { data, error: signError } = await db.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path, { upsert: false });
      if (signError || !data) throw signError ?? new Error("Could not sign upload");
      return json({ ok: true, state: "uploading", path, token: data.token });
    }
    const { data: object, error: downloadError } = await db.storage.from(DOCUMENTS_BUCKET).download(path);
    if (downloadError || !object) return refuse("storage_unavailable", 503, { retryable: true });
    if (object.size !== value.byteSize || object.type !== value.contentType) {
      await db.from("student_documents").update({ upload_state: "failed" }).eq("id", value.documentId).eq("upload_state", "uploading");
      return refuse("mismatch", 422);
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if (sniffDocumentType(bytes.subarray(0, 16)) !== value.contentType ||
        createHash("sha256").update(bytes).digest("hex") !== value.sha256) {
      await db.from("student_documents").update({ upload_state: "failed" }).eq("id", value.documentId).eq("upload_state", "uploading");
      return refuse("mismatch", 422);
    }
    const { data: updated, error: updateError } = await db.from("student_documents").update({ upload_state: "stored" })
      .eq("id", value.documentId).eq("upload_state", "uploading").select("id");
    if (updateError) throw updateError;
    if (!updated?.length) {
      const { data: current } = await db.from("student_documents").select("upload_state").eq("id", value.documentId).maybeSingle();
      if (current?.upload_state !== "stored") return refuse("conflict", 409);
    }
    revalidatePath(`/teach/student/${value.studentId}`);
    return json({ ok: true, state: "stored" });
  } catch {
    return refuse("storage_unavailable", 503, { retryable: true });
  }
}
