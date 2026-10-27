import { createClient } from "@/platform/supabase/client";
import { MAX_DOCUMENT_BYTES } from "@/modules/collection/domain/review";
import { sniffDocumentType } from "@/modules/collection/domain/document-files";
import type { UploadDeps, UploadInput, UploadOutcome } from "./chunked-upload";

/** The file goes directly to one private object; the server checks it before publishing. */
export async function uploadToBucket(input: UploadInput, deps: UploadDeps): Promise<UploadOutcome> {
  if (!input.file.size || input.file.size > MAX_DOCUMENT_BYTES) return { ok: false, reason: "too_large", resumable: false };
  const bytes = await input.file.arrayBuffer();
  const contentType = sniffDocumentType(new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)));
  if (!contentType) return { ok: false, reason: "wrong_type", resumable: false };
  const digest = await deps.digest(bytes);
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  const payload = { clientRequestId: input.documentId, studentId: input.studentId, kind: input.kind,
    fileName: input.file.name, contentType, byteSize: input.file.size, sha256, note: input.note };
  async function request(phase: "begin" | "finish") {
    const response = await deps.fetch("/documents/bucket-upload", { method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json", "x-vppsone-upload": "1" }, body: JSON.stringify({ ...payload, phase }) });
    return response.json() as Promise<{ ok: boolean; state?: string; path?: string; token?: string; reason?: string }>;
  }
  try {
    const start = await request("begin");
    if (!start.ok) {
      if (start.reason === "expired" || start.reason === "failed") return { ok: false, reason: "expired", resumable: false };
      if (start.reason === "forbidden" || start.reason === "out_of_scope") return { ok: false, reason: "not_allowed", resumable: false };
      // Signing can fail because a prior attempt stored the object before its response was lost.
      const resumed = await request("finish");
      if (resumed.ok) return { ok: true };
      if (resumed.reason === "expired" || resumed.reason === "failed") return { ok: false, reason: "expired", resumable: false };
      return { ok: false, reason: resumed.reason === "mismatch" ? "mismatch" : "storage_down", resumable: resumed.reason !== "mismatch" };
    }
    if (start.state === "stored") return { ok: true };
    if (!start.path || !start.token) return { ok: false, reason: "failed", resumable: true };
    const { error } = await createClient().storage.from("vppsone-documents").uploadToSignedUrl(start.path, start.token, new Blob([bytes], { type: contentType }), { contentType, upsert: false });
    // A retry may see an existing object after the original response was lost.
    // Finish always verifies the bytes, including after an upload error.
    deps.onProgress(input.file.size, input.file.size);
    const finish = await request("finish");
    if (finish.ok) return { ok: true };
    if (finish.reason === "expired" || finish.reason === "failed") return { ok: false, reason: "expired", resumable: false };
    if (finish.reason === "mismatch") return { ok: false, reason: "mismatch", resumable: false };
    if (finish.reason === "forbidden" || finish.reason === "out_of_scope") return { ok: false, reason: "not_allowed", resumable: false };
    return { ok: false, reason: error ? "storage_refused" : "storage_down", resumable: true };
  } catch { return { ok: false, reason: "storage_down", resumable: true }; }
}
