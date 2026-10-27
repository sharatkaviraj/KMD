import "server-only";

import { GoogleAuthError } from "@/platform/google/workload-identity";
import { DriveError } from "@/platform/google/drive";
import { logError } from "@/platform/observability/log";

import { UploadRefusal } from "./drive-upload-flow";

/**
 * The HTTP edges of the Drive upload routes (D-333): same-origin only, bodies
 * read with a hard byte cap, and every failure turned into a status and a
 * reason code the uploader knows how to say in the reader's language.
 */

export type UploadFailureCode =
  | "forbidden"
  | "invalid"
  | "out_of_scope"
  | "provider_off"
  | "too_many"
  | "storage_unavailable"
  | "storage_full"
  | "storage_refused"
  | "busy"
  | UploadRefusal["kind"];

export type UploadFailureBody = { ok: false; reason: UploadFailureCode; retryable: boolean; offset?: number };

const NO_STORE = { "cache-control": "no-store" };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function refuse(reason: UploadFailureCode, status: number, extra: { retryable?: boolean; offset?: number } = {}) {
  const body: UploadFailureBody = { ok: false, reason, retryable: extra.retryable ?? false };
  if (extra.offset !== undefined) body.offset = extra.offset;
  return json(body, status);
}

/**
 * A state-changing request from this site's own pages only. Server Actions
 * get this check from Next; route handlers do not, so it is written here.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) return origin === new URL(request.url).origin;
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** The body, refused past `limit` bytes whatever Content-Length claimed. */
export async function readCapped(request: Request, limit: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > limit) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const parts: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      return null;
    }
    parts.push(next.value);
  }
  const body = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    body.set(part, at);
    at += part.byteLength;
  }
  return body;
}

const REFUSAL_STATUS: Record<UploadRefusal["kind"], number> = {
  not_found: 404,
  not_yours: 403,
  conflict: 409,
  offset: 409,
  size: 413,
  wrong_type: 415,
  expired: 410,
  mismatch: 422,
  failed: 410,
};

/** Any failure from the upload flow, as a response. Google's details go to the log, not the browser. */
export function failureResponse(error: unknown, context: { documentId?: string }): Response {
  if (error instanceof UploadRefusal) {
    return refuse(error.kind, REFUSAL_STATUS[error.kind], { offset: error.offset });
  }

  logError("documents.drive.upload-failed", {
    documentId: context.documentId,
    kind: error instanceof DriveError || error instanceof GoogleAuthError ? error.kind : "other",
    cause: error,
  });

  if (error instanceof DriveError) {
    if (error.kind === "rate_limited") return refuse("busy", 429, { retryable: true });
    if (error.kind === "quota") return refuse("storage_full", 507);
    if (error.kind === "unavailable") return refuse("storage_unavailable", 503, { retryable: true });
    if (error.kind === "session_gone") return refuse("expired", 410);
    return refuse("storage_refused", 503);
  }
  if (error instanceof GoogleAuthError) {
    return error.kind === "unavailable"
      ? refuse("storage_unavailable", 503, { retryable: true })
      : refuse("storage_refused", 503);
  }
  return refuse("storage_unavailable", 503, { retryable: true });
}

const windows = new Map<string, { since: number; count: number }>();

/**
 * A per-person ceiling on new uploads, per function instance. Not a security
 * boundary — Drive's own quota is — but it stops a stuck button from opening
 * sessions in a loop.
 */
export function withinRate(key: string, perMinute: number, now = Date.now()): boolean {
  for (const [name, window] of windows) if (now - window.since > 60_000) windows.delete(name);
  const window = windows.get(key) ?? { since: now, count: 0 };
  if (window.count >= perMinute || windows.size > 2000) return false;
  window.count += 1;
  windows.set(key, window);
  return true;
}
