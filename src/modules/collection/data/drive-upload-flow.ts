import { createHash } from "node:crypto";

import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_SESSION_HOURS,
  checkChunk,
  driveFileName,
  sniffDocumentType,
  type AllowedDocumentType,
  type UploadRequest,
} from "@/modules/collection/domain/document-files";
import type { DocumentKind } from "@/modules/collection/domain/review";
import {
  createFolder,
  downloadFile,
  getFile,
  startResumableUpload,
  uploadChunk,
  uploadStatus,
  type DriveDeps,
  type DriveFile,
} from "@/platform/google/drive";

/**
 * A document's journey into the Shared Drive, one request at a time (D-333).
 *
 *   begin  → a row in `uploading`, a Drive resumable session kept server-side
 *   chunk  → bytes forwarded in order; the first chunk's magic bytes are
 *            checked before anything reaches Drive
 *   finish → Drive's own size and sha256 must equal what the browser declared,
 *            or the row is `failed` and never listed
 *
 * The database is behind `UploadStore` and Drive behind `DriveDeps`, so the
 * whole flow runs in the tests against an in-memory store and a fake Drive.
 * No `server-only` for that reason; it holds no credential of its own.
 */

export type DocumentRow = {
  id: string;
  studentId: string;
  sessionLabel: string;
  kind: DocumentKind;
  contentType: AllowedDocumentType;
  byteSize: number;
  uploadedBy: string;
  provider: "supabase" | "gdrive";
  state: "uploading" | "stored" | "failed";
  driveFileId: string | null;
  sha256: string | null;
};

export type SessionRow = {
  documentId: string;
  sessionUrl: string;
  declaredBytes: number;
  declaredSha256: string;
  received: number;
  createdBy: string;
  expiresAt: string;
};

export interface UploadStore {
  findDocument(id: string): Promise<DocumentRow | null>;
  /** `exists` when the id is already taken — a repeated begin, or a collision. */
  insertDocument(input: UploadRequest & { sessionLabel: string; uploadedBy: string }): Promise<"inserted" | "exists">;
  markFailed(id: string, driveFileId: string | null): Promise<void>;
  /** False when the row was no longer `uploading` (somebody else finished it). */
  markStored(id: string, input: { driveFileId: string; sha256: string }): Promise<boolean>;
  findSession(documentId: string): Promise<SessionRow | null>;
  insertSession(row: SessionRow): Promise<void>;
  /** Move `received` from `from` to `to`; false if another request moved it first. */
  advanceSession(documentId: string, from: number, to: number): Promise<boolean>;
  setReceived(documentId: string, received: number): Promise<void>;
  deleteSession(documentId: string): Promise<void>;
  folderFor(sessionLabel: string): Promise<string | null>;
  /** Record a folder for a session; returns whichever folder won if two raced. */
  claimFolder(sessionLabel: string, folderId: string): Promise<string>;
}

export type DriveTarget = { deps: DriveDeps; rootFolderId: string };

export type UploadState = { state: "uploading"; offset: number; chunkBytes: number } | { state: "stored" };

export type RefusalKind =
  | "not_found"
  | "not_yours"
  | "conflict"
  | "offset"
  | "size"
  | "wrong_type"
  | "expired"
  | "mismatch"
  | "failed";

export class UploadRefusal extends Error {
  constructor(
    readonly kind: RefusalKind,
    readonly offset?: number,
  ) {
    super(`Upload refused: ${kind}`);
    this.name = "UploadRefusal";
  }
}

const uploading = (offset: number): UploadState => ({ state: "uploading", offset, chunkBytes: UPLOAD_CHUNK_BYTES });

async function sessionFolder(store: UploadStore, drive: DriveTarget, sessionLabel: string): Promise<string> {
  const known = await store.folderFor(sessionLabel);
  if (known) return known;
  const created = await createFolder(drive.deps, { name: `session ${sessionLabel}`, parentId: drive.rootFolderId });
  // If another first upload created one too, both ask the database, which
  // keeps exactly one. The loser's folder stays empty; nothing is deleted.
  return store.claimFolder(sessionLabel, created);
}

/** Start an upload, or say where an earlier attempt with the same id got to. */
export async function beginUpload(
  store: UploadStore,
  drive: DriveTarget,
  actor: { staffId: string },
  request: UploadRequest & { sessionLabel: string },
  now: Date = new Date(),
): Promise<UploadState> {
  const inserted = await store.insertDocument({ ...request, uploadedBy: actor.staffId });
  if (inserted === "exists") return resume(store, drive, actor, request.documentId, request, now);

  try {
    const folderId = await sessionFolder(store, drive, request.sessionLabel);
    const sessionUrl = await startResumableUpload(drive.deps, {
      name: driveFileName({
        kind: request.kind,
        studentId: request.studentId,
        documentId: request.documentId,
        contentType: request.contentType,
      }),
      parentId: folderId,
      contentType: request.contentType,
      bytes: request.byteSize,
      appProperties: {
        vppsoneDocumentId: request.documentId,
        vppsoneStudentId: request.studentId,
        vppsoneKind: request.kind,
        sha256: request.sha256,
      },
    });
    await store.insertSession({
      documentId: request.documentId,
      sessionUrl,
      declaredBytes: request.byteSize,
      declaredSha256: request.sha256,
      received: 0,
      createdBy: actor.staffId,
      expiresAt: new Date(now.getTime() + UPLOAD_SESSION_HOURS * 3600 * 1000).toISOString(),
    });
  } catch (error) {
    await store.markFailed(request.documentId, null);
    throw error;
  }
  return uploading(0);
}

/** A repeated begin: the same person, the same child and file, or a refusal. */
async function resume(
  store: UploadStore,
  drive: DriveTarget,
  actor: { staffId: string },
  documentId: string,
  request: Pick<UploadRequest, "studentId" | "byteSize" | "sha256">,
  now: Date,
): Promise<UploadState> {
  const row = await store.findDocument(documentId);
  if (!row) throw new UploadRefusal("not_found");
  if (row.uploadedBy !== actor.staffId) throw new UploadRefusal("not_yours");
  if (row.studentId !== request.studentId || row.byteSize !== request.byteSize) throw new UploadRefusal("conflict");
  return currentState(store, drive, actor, documentId, now);
}

async function openSession(
  store: UploadStore,
  actor: { staffId: string },
  documentId: string,
  now: Date,
): Promise<{ row: DocumentRow; session: SessionRow | null }> {
  const row = await store.findDocument(documentId);
  if (!row || row.provider !== "gdrive") throw new UploadRefusal("not_found");
  if (row.uploadedBy !== actor.staffId) throw new UploadRefusal("not_yours");
  if (row.state === "failed") throw new UploadRefusal("failed");
  if (row.state === "stored") return { row, session: null };

  const session = await store.findSession(documentId);
  if (!session) {
    await store.markFailed(documentId, null);
    throw new UploadRefusal("failed");
  }
  if (Date.parse(session.expiresAt) <= now.getTime()) {
    await store.deleteSession(documentId);
    await store.markFailed(documentId, null);
    throw new UploadRefusal("expired");
  }
  return { row, session };
}

/** Where an upload is now, asking Drive rather than trusting our own count. */
export async function currentState(
  store: UploadStore,
  drive: DriveTarget,
  actor: { staffId: string },
  documentId: string,
  now: Date = new Date(),
): Promise<UploadState> {
  const { row, session } = await openSession(store, actor, documentId, now);
  if (!session) return { state: "stored" };

  const progress = await uploadStatus(drive.deps, session.sessionUrl, session.declaredBytes);
  if (progress.done) return finish(store, drive, row, session, progress.file);
  if (progress.received !== session.received) await store.setReceived(documentId, progress.received);
  return uploading(progress.received);
}

/** One chunk, in order, forwarded to Drive. */
export async function acceptChunk(
  store: UploadStore,
  drive: DriveTarget,
  actor: { staffId: string },
  input: { documentId: string; offset: number; bytes: Uint8Array },
  now: Date = new Date(),
): Promise<UploadState> {
  const { row, session } = await openSession(store, actor, input.documentId, now);
  if (!session) return { state: "stored" };

  const verdict = checkChunk({
    offset: input.offset,
    length: input.bytes.byteLength,
    received: session.received,
    declared: session.declaredBytes,
  });
  if (!verdict.ok) throw new UploadRefusal(verdict.why, session.received);

  if (input.offset === 0 && sniffDocumentType(input.bytes.subarray(0, 16)) !== row.contentType) {
    // Nothing has reached Drive yet, so there is no file to leave behind.
    await store.deleteSession(row.id);
    await store.markFailed(row.id, null);
    throw new UploadRefusal("wrong_type");
  }

  const progress = await uploadChunk(drive.deps, {
    sessionUrl: session.sessionUrl,
    offset: input.offset,
    total: session.declaredBytes,
    bytes: input.bytes,
  });
  if (progress.done) return finish(store, drive, row, session, progress.file);

  const moved = await store.advanceSession(row.id, session.received, progress.received);
  if (!moved) {
    const latest = await store.findSession(row.id);
    return uploading(latest?.received ?? progress.received);
  }
  return uploading(progress.received);
}

async function driveSha256(drive: DriveTarget, file: DriveFile): Promise<string | null> {
  if (file.sha256Checksum) return file.sha256Checksum.toLowerCase();
  const fresh = await getFile(drive.deps, file.id);
  if (fresh.sha256Checksum) return fresh.sha256Checksum.toLowerCase();
  // Drive fills sha256Checksum for binary files, but not always at once: hash
  // the stored bytes ourselves (≤ 10 MB) rather than trust our own claim.
  const response = await downloadFile(drive.deps, file.id);
  return createHash("sha256").update(new Uint8Array(await response.arrayBuffer())).digest("hex");
}

/** Drive says the file is complete: believe it only if it is the file declared. */
async function finish(
  store: UploadStore,
  drive: DriveTarget,
  row: DocumentRow,
  session: SessionRow,
  file: DriveFile,
): Promise<UploadState> {
  // If this throws, the session is left in place: the upload is complete in
  // Drive, and the next status query comes back here and checks again.
  const sha256 = await driveSha256(drive, file);

  const sameSize = Number(file.size) === session.declaredBytes;
  const sameType = !file.mimeType || file.mimeType === row.contentType;
  if (!sameSize || !sameType || sha256 !== session.declaredSha256) {
    await store.deleteSession(row.id);
    // The file id is kept on the failed row so an administrator can find the
    // stray file in the Drive; the app does not delete it.
    await store.markFailed(row.id, file.id);
    throw new UploadRefusal("mismatch");
  }

  await store.markStored(row.id, { driveFileId: file.id, sha256 });
  await store.deleteSession(row.id);
  return { state: "stored" };
}
