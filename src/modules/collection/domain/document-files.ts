import { t, type Localized } from "@/platform/i18n/language";

import {
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  documentKinds,
  type DocumentKind,
} from "./review";

/**
 * The rules for a document's bytes, whichever store holds them (D-333).
 *
 * Pure, so the browser uploader, the upload routes and the tests agree on one
 * copy of each rule.
 */

export type AllowedDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];

/**
 * One upload request's worth of bytes.
 *
 * Vercel refuses a function request body over 4.5 MB on every plan, so a
 * 10 MB document cannot arrive in one request. Drive's resumable protocol
 * wants every chunk but the last to be a multiple of 256 KiB; fifteen of them
 * is 3.75 MiB, inside the limit with room for headers.
 */
export const UPLOAD_CHUNK_BYTES = 15 * 256 * 1024;

/** How long an unfinished Drive upload may be resumed. Drive keeps them a week. */
export const UPLOAD_SESSION_HOURS = 24;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

const SHA256 = /^[0-9a-f]{64}$/;
export const isSha256 = (value: unknown): value is string => typeof value === "string" && SHA256.test(value);

/**
 * What the file actually is, from its first bytes — never from the name or
 * the type the browser claims. An HTML page renamed `aadhaar.pdf` and served
 * back from this app's origin is a script on this app's origin.
 */
export function sniffDocumentType(head: Uint8Array): AllowedDocumentType | null {
  const at = (index: number) => head[index];
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (head.byteLength >= 5 && ascii(0, 5) === "%PDF-") return "application/pdf";
  if (head.byteLength >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (
    head.byteLength >= 8 &&
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => at(index) === byte)
  ) {
    return "image/png";
  }
  if (head.byteLength >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * A file name fit to show and to put in a header: no folders a browser added
 * (`C:\fakepath\…`), no control or bidi-override characters that make
 * "gpj.exe" read as "exe.jpg", and a sane length.
 */
export function displayFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "document";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 6 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - extension.length) + extension;
}

const EXTENSIONS: Record<AllowedDocumentType, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * The name a document has inside the Shared Drive. Ids only — no child's
 * name, no original file name — so someone browsing the Drive learns nothing
 * the database does not already make them look up.
 */
export function driveFileName(input: {
  kind: DocumentKind;
  studentId: string;
  documentId: string;
  contentType: AllowedDocumentType;
}): string {
  return `${input.kind}__${input.studentId}__${input.documentId}.${EXTENSIONS[input.contentType]}`;
}

export type UploadRequest = {
  documentId: string;
  studentId: string;
  kind: DocumentKind;
  fileName: string;
  contentType: AllowedDocumentType;
  byteSize: number;
  sha256: string;
  note: string | null;
};

/** Check what the browser says it is about to send, before anything is created. */
export function checkUploadRequest(body: unknown): { ok: true; value: UploadRequest } | { ok: false; reason: Localized } {
  const input = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const invalid = { ok: false as const, reason: t("जानकारी अधूरी है।", "Some details are missing.") };

  if (!isUuid(input.clientRequestId) || !isUuid(input.studentId)) return invalid;
  if (typeof input.kind !== "string" || !(documentKinds as readonly string[]).includes(input.kind)) return invalid;
  if (typeof input.fileName !== "string" || !isSha256(input.sha256)) return invalid;

  if (
    typeof input.contentType !== "string" ||
    !(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(input.contentType)
  ) {
    return { ok: false, reason: t("केवल PDF या फ़ोटो भेजें।", "Only a PDF or a photograph can be stored here.") };
  }

  const byteSize = input.byteSize;
  if (typeof byteSize !== "number" || !Number.isInteger(byteSize) || byteSize <= 0 || byteSize > MAX_DOCUMENT_BYTES) {
    return { ok: false, reason: t("फ़ाइल 10 MB से बड़ी नहीं होनी चाहिए।", "That file is larger than 10 MB.") };
  }

  const note = typeof input.note === "string" ? input.note.trim().slice(0, 200) : "";

  return {
    ok: true,
    value: {
      documentId: input.clientRequestId as string,
      studentId: input.studentId as string,
      kind: input.kind as DocumentKind,
      fileName: displayFileName(input.fileName as string),
      contentType: input.contentType as AllowedDocumentType,
      byteSize,
      sha256: input.sha256 as string,
      note: note || null,
    },
  };
}

/**
 * Whether one chunk may be accepted. Uploads are strictly in order: the
 * offset must be exactly what is already held, which is what makes a resent
 * chunk harmless — it is refused with the offset to resume from.
 */
export function checkChunk(input: {
  offset: number;
  length: number;
  received: number;
  declared: number;
}): { ok: true } | { ok: false; why: "offset" | "size" } {
  if (!Number.isInteger(input.offset) || input.offset !== input.received) return { ok: false, why: "offset" };
  if (input.length <= 0 || input.length > UPLOAD_CHUNK_BYTES) return { ok: false, why: "size" };
  const end = input.offset + input.length;
  if (end > input.declared) return { ok: false, why: "size" };
  // Every chunk but the last is a whole number of 256 KiB blocks (Drive's rule).
  if (end < input.declared && input.length % (256 * 1024) !== 0) return { ok: false, why: "size" };
  return { ok: true };
}

/** Whether Drive is where this person's new documents go. */
export function drivesUploadsFor(
  settings: { documentsProvider: "supabase" | "gdrive"; drivePilotStaffIds: readonly string[]; driveConfigured: boolean },
  staffId: string,
): boolean {
  if (!settings.driveConfigured) return false;
  return settings.documentsProvider === "gdrive" || settings.drivePilotStaffIds.includes(staffId);
}

/**
 * Headers for a document served from VPPS One.
 *
 * `private, no-store`: a birth certificate must not sit in a shared cache,
 * a service worker or the back-forward cache of a borrowed phone. `nosniff`
 * plus a type that was checked against the bytes means the browser renders
 * exactly a PDF or a picture, never HTML.
 */
export function documentResponseHeaders(input: {
  contentType: AllowedDocumentType;
  disposition: string;
  contentLength?: string | null;
  contentRange?: string | null;
}): Headers {
  const headers = new Headers({
    "content-type": input.contentType,
    "content-disposition": input.disposition,
    "cache-control": "private, no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-origin",
    "accept-ranges": "bytes",
  });
  if (input.contentLength) headers.set("content-length", input.contentLength);
  if (input.contentRange) headers.set("content-range", input.contentRange);
  return headers;
}
