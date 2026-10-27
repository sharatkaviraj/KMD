import {
  MAX_DOCUMENT_BYTES,
  type DocumentKind,
} from "@/modules/collection/domain/review";
import { sniffDocumentType } from "@/modules/collection/domain/document-files";

/**
 * The browser half of a Drive upload (D-333): hash the file, ask to begin,
 * send it in order in chunks, and after any dropped request ask the server
 * where it got to before sending again. No React here, so it runs in the
 * tests against a fake server.
 */

export type UploadOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "too_large"
        | "wrong_type"
        | "not_allowed"
        | "mismatch"
        | "expired"
        | "storage_down"
        | "storage_refused"
        | "storage_full"
        | "failed";
      /** Worth pressing the button again with the same file: the upload resumes. */
      resumable: boolean;
    };

type Reply = {
  ok?: boolean;
  state?: "uploading" | "stored";
  offset?: number;
  chunkBytes?: number;
  reason?: string;
  retryable?: boolean;
};

export type UploadInput = {
  documentId: string;
  studentId: string;
  kind: DocumentKind;
  note: string;
  file: Blob & { name: string };
};

export type UploadDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  digest: (bytes: ArrayBuffer) => Promise<ArrayBuffer>;
  onProgress: (sent: number, total: number) => void;
  onRetry?: () => void;
};

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000] as const;

const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");

function outcomeFor(reason: string | undefined): UploadOutcome {
  switch (reason) {
    case "wrong_type":
      return { ok: false, reason: "wrong_type", resumable: false };
    case "size":
      return { ok: false, reason: "too_large", resumable: false };
    case "forbidden":
    case "out_of_scope":
    case "not_yours":
      return { ok: false, reason: "not_allowed", resumable: false };
    case "mismatch":
      return { ok: false, reason: "mismatch", resumable: false };
    case "expired":
    case "failed":
      return { ok: false, reason: "expired", resumable: false };
    case "storage_full":
      return { ok: false, reason: "storage_full", resumable: false };
    case "storage_refused":
    case "provider_off":
      return { ok: false, reason: "storage_refused", resumable: false };
    case "busy":
    case "storage_unavailable":
    case "too_many":
      return { ok: false, reason: "storage_down", resumable: true };
    default:
      return { ok: false, reason: "failed", resumable: true };
  }
}

async function call(deps: UploadDeps, url: string, init: RequestInit): Promise<{ status: number; body: Reply } | null> {
  try {
    const response = await deps.fetch(url, { ...init, credentials: "same-origin", cache: "no-store" });
    const type = response.headers.get("content-type") ?? "";
    // A login page or a proxy error is not an answer from the upload route.
    if (!type.includes("application/json")) return { status: response.status, body: { reason: "forbidden" } };
    return { status: response.status, body: (await response.json()) as Reply };
  } catch {
    return null;
  }
}

export async function uploadToDrive(input: UploadInput, deps: UploadDeps): Promise<UploadOutcome> {
  const total = input.file.size;
  if (total <= 0 || total > MAX_DOCUMENT_BYTES) return { ok: false, reason: "too_large", resumable: false };

  const whole = await input.file.arrayBuffer();
  const contentType = sniffDocumentType(new Uint8Array(whole, 0, Math.min(16, total)));
  if (!contentType) return { ok: false, reason: "wrong_type", resumable: false };
  const sha256 = hex(await deps.digest(whole));

  const base = "/documents/uploads";
  let reply: { status: number; body: Reply } | null = null;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
    if (attempt > 0) {
      deps.onRetry?.();
      await deps.sleep(BACKOFF_MS[attempt - 1]!);
    }
    reply = await call(deps, base, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientRequestId: input.documentId,
        studentId: input.studentId,
        kind: input.kind,
        fileName: input.file.name,
        contentType,
        byteSize: total,
        sha256,
        note: input.note,
      }),
    });
    if (reply && reply.body.ok) break;
    if (reply && !reply.body.retryable) return outcomeFor(reply.body.reason);
  }
  if (!reply || !reply.body.ok) return outcomeFor(reply?.body.reason);

  let state = reply.body;
  let failures = 0;
  while (state.state === "uploading") {
    const offset = state.offset ?? 0;
    const chunk = state.chunkBytes ?? 0;
    deps.onProgress(offset, total);
    if (chunk <= 0) return { ok: false, reason: "failed", resumable: true };

    const sent = await call(deps, `${base}/${input.documentId}?offset=${offset}`, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: whole.slice(offset, Math.min(offset + chunk, total)),
    });

    if (sent && sent.body.ok) {
      state = sent.body;
      failures = 0;
      continue;
    }
    if (sent && sent.body.reason === "offset" && typeof sent.body.offset === "number") {
      // The server already has more (or less) than we thought: carry on from its count.
      state = { ...state, offset: sent.body.offset };
      continue;
    }
    if (sent && !sent.body.retryable) return outcomeFor(sent.body.reason);

    // A dropped connection or a busy Drive: wait, then ask where it got to.
    if (failures >= BACKOFF_MS.length) return outcomeFor(sent?.body.reason ?? "storage_unavailable");
    deps.onRetry?.();
    await deps.sleep(BACKOFF_MS[failures]!);
    failures += 1;
    const status = await call(deps, `${base}/${input.documentId}`, { method: "GET" });
    if (status && status.body.ok) state = status.body;
    else if (status && !status.body.retryable) return outcomeFor(status.body.reason);
  }

  deps.onProgress(total, total);
  return { ok: true };
}
