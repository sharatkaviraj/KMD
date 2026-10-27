import { beforeEach, describe, expect, it } from "vitest";

import {
  UploadRefusal,
  acceptChunk,
  beginUpload,
  currentState,
  type DocumentRow,
  type SessionRow,
  type UploadStore,
} from "@/modules/collection/data/drive-upload-flow";
import { UPLOAD_CHUNK_BYTES, type UploadRequest } from "@/modules/collection/domain/document-files";
import { DriveError } from "@/platform/google/drive";

import { FakeDrive, ROOT_FOLDER, driveDepsFor, sha256Hex, syntheticFile } from "./fake-drive.fixture";

/** The database half, in memory, with the same rules the migration enforces. */
class MemoryStore implements UploadStore {
  documents = new Map<string, DocumentRow>();
  sessions = new Map<string, SessionRow>();
  folders = new Map<string, string>();

  async findDocument(id: string) {
    return this.documents.get(id) ?? null;
  }
  createdAt = () => new Date().toISOString();
  async discardDocument(id: string) {
    const row = this.documents.get(id);
    if (row?.state === "uploading" && !row.driveFileId && !this.sessions.has(id)) this.documents.delete(id);
  }
  async insertDocument(input: UploadRequest & { sessionLabel: string; uploadedBy: string }) {
    if (this.documents.has(input.documentId)) return "exists" as const;
    this.documents.set(input.documentId, {
      createdAt: this.createdAt(),
      id: input.documentId,
      studentId: input.studentId,
      sessionLabel: input.sessionLabel,
      kind: input.kind,
      contentType: input.contentType,
      byteSize: input.byteSize,
      uploadedBy: input.uploadedBy,
      provider: "gdrive",
      state: "uploading",
      driveFileId: null,
      sha256: null,
    });
    return "inserted" as const;
  }
  async markFailed(id: string, driveFileId: string | null) {
    const row = this.documents.get(id);
    if (row?.state === "uploading") this.documents.set(id, { ...row, state: "failed", driveFileId });
  }
  async markStored(id: string, input: { driveFileId: string; sha256: string }) {
    const row = this.documents.get(id);
    if (row?.state !== "uploading") return false;
    this.documents.set(id, { ...row, state: "stored", driveFileId: input.driveFileId, sha256: input.sha256 });
    return true;
  }
  async findSession(id: string) {
    return this.sessions.get(id) ?? null;
  }
  async insertSession(row: SessionRow) {
    this.sessions.set(row.documentId, row);
  }
  async advanceSession(id: string, from: number, to: number) {
    const row = this.sessions.get(id);
    if (!row || row.received !== from) return false;
    this.sessions.set(id, { ...row, received: to });
    return true;
  }
  async setReceived(id: string, received: number) {
    const row = this.sessions.get(id);
    if (row) this.sessions.set(id, { ...row, received });
  }
  async deleteSession(id: string) {
    this.sessions.delete(id);
  }
  async folderFor(sessionLabel: string) {
    return this.folders.get(sessionLabel) ?? null;
  }
  async claimFolder(sessionLabel: string, folderId: string) {
    if (!this.folders.has(sessionLabel)) this.folders.set(sessionLabel, folderId);
    return this.folders.get(sessionLabel)!;
  }
}

const OFFICE = { staffId: "00000000-0000-4000-8000-0000000000a1" };
const OTHER_OFFICE = { staffId: "00000000-0000-4000-8000-0000000000a2" };
const STUDENT = "00000000-0000-4000-8000-0000000000b1";

let drive: FakeDrive;
let store: MemoryStore;
let target: { deps: ReturnType<typeof driveDepsFor>; rootFolderId: string };

function request(bytes: Uint8Array, overrides: Partial<UploadRequest> = {}): UploadRequest & { sessionLabel: string } {
  return {
    documentId: crypto.randomUUID(),
    studentId: STUDENT,
    kind: "birth_certificate",
    fileName: "Synthetic Child birth certificate.pdf",
    contentType: "application/pdf",
    byteSize: bytes.byteLength,
    sha256: sha256Hex(bytes),
    note: null,
    sessionLabel: "SYN-2026-27",
    ...overrides,
  };
}

async function sendAll(documentId: string, bytes: Uint8Array, actor = OFFICE) {
  let state = await currentState(store, target, actor, documentId);
  while (state.state === "uploading") {
    const chunk = bytes.subarray(state.offset, Math.min(state.offset + UPLOAD_CHUNK_BYTES, bytes.byteLength));
    state = await acceptChunk(store, target, actor, { documentId, offset: state.offset, bytes: chunk });
  }
  return state;
}

beforeEach(() => {
  drive = new FakeDrive();
  store = new MemoryStore();
  target = { deps: driveDepsFor(drive), rootFolderId: ROOT_FOLDER };
});

describe("a Drive upload", () => {
  it("stores a 10 MB synthetic PDF in chunks and records Drive's own sha256", async () => {
    const bytes = syntheticFile("pdf", 10 * 1024 * 1024);
    const input = request(bytes);

    expect(await beginUpload(store, target, OFFICE, input)).toEqual({ state: "uploading", offset: 0, chunkBytes: UPLOAD_CHUNK_BYTES });
    expect(await sendAll(input.documentId, bytes)).toEqual({ state: "stored" });

    const row = store.documents.get(input.documentId)!;
    expect(row.state).toBe("stored");
    expect(row.sha256).toBe(input.sha256);
    const file = drive.files.get(row.driveFileId!)!;
    expect(sha256Hex(file.bytes)).toBe(input.sha256);
    // Ids only in Drive: no child's name, no original file name.
    expect(file.name).toBe(`birth_certificate__${STUDENT}__${input.documentId}.pdf`);
    expect(file.name).not.toContain("Synthetic Child");
    expect(file.appProperties?.vppsoneDocumentId).toBe(input.documentId);
    expect(store.sessions.size).toBe(0);
    expect(drive.requests.filter((entry) => entry.kind === "chunk")).toHaveLength(3);
  });

  it("treats a second Save with the same id as the same document", async () => {
    const bytes = syntheticFile("pdf", 600 * 1024);
    const input = request(bytes);
    await beginUpload(store, target, OFFICE, input);
    // Tapped again before anything was sent: same upload, same place.
    expect(await beginUpload(store, target, OFFICE, input)).toMatchObject({ state: "uploading", offset: 0 });
    await sendAll(input.documentId, bytes);
    // And once more after it finished: it says stored and makes nothing new.
    expect(await beginUpload(store, target, OFFICE, input)).toEqual({ state: "stored" });
    const pdfs = [...drive.files.values()].filter((file) => file.mimeType === "application/pdf");
    expect(pdfs).toHaveLength(1);
    expect(drive.requests.filter((entry) => entry.kind === "start")).toHaveLength(1);
  });

  it("refuses another person's upload id", async () => {
    const bytes = syntheticFile("pdf", 1000);
    const input = request(bytes);
    await beginUpload(store, target, OFFICE, input);
    await expect(beginUpload(store, target, OTHER_OFFICE, input)).rejects.toMatchObject({ kind: "not_yours" });
    await expect(
      acceptChunk(store, target, OTHER_OFFICE, { documentId: input.documentId, offset: 0, bytes }),
    ).rejects.toMatchObject({ kind: "not_yours" });
    expect(drive.bytesReceived).toBe(0);
  });

  it("refuses a file whose bytes are not what it claims, before any byte reaches Drive", async () => {
    const bytes = syntheticFile("html", 2000);
    const input = request(bytes, { contentType: "application/pdf" });
    await beginUpload(store, target, OFFICE, input);
    await expect(
      acceptChunk(store, target, OFFICE, { documentId: input.documentId, offset: 0, bytes }),
    ).rejects.toMatchObject({ kind: "wrong_type" });
    expect(drive.bytesReceived).toBe(0);
    expect(store.documents.get(input.documentId)!.state).toBe("failed");
    expect(store.sessions.size).toBe(0);
  });

  it("answers an out-of-order chunk with the offset to resume from", async () => {
    const bytes = syntheticFile("pdf", UPLOAD_CHUNK_BYTES * 2);
    const input = request(bytes);
    await beginUpload(store, target, OFFICE, input);
    const refusal = await acceptChunk(store, target, OFFICE, {
      documentId: input.documentId,
      offset: UPLOAD_CHUNK_BYTES,
      bytes: bytes.subarray(UPLOAD_CHUNK_BYTES),
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(UploadRefusal);
    expect(refusal).toMatchObject({ kind: "offset", offset: 0 });
  });

  it("survives a chunk that half-arrived: asks Drive, sends only the rest", async () => {
    const bytes = syntheticFile("pdf", UPLOAD_CHUNK_BYTES + 5000);
    const input = request(bytes);
    await beginUpload(store, target, OFFICE, input);
    drive.faults.push({ on: "chunk", status: 503, acceptBytes: 256 * 1024 });

    const first = await acceptChunk(store, target, OFFICE, {
      documentId: input.documentId,
      offset: 0,
      bytes: bytes.subarray(0, UPLOAD_CHUNK_BYTES),
    });
    expect(first).toMatchObject({ state: "uploading", offset: UPLOAD_CHUNK_BYTES });
    expect(drive.requests.filter((entry) => entry.kind === "status").length).toBeGreaterThan(0);
    expect(await sendAll(input.documentId, bytes)).toEqual({ state: "stored" });
    expect(drive.bytesReceived).toBe(bytes.byteLength);
  });

  it("retries after Drive's rate limit", async () => {
    const bytes = syntheticFile("jpeg", 300_000);
    const input = request(bytes, { contentType: "image/jpeg", kind: "photo" });
    drive.faults.push({ on: "start", status: 429, reason: "userRateLimitExceeded" });
    await beginUpload(store, target, OFFICE, input);
    drive.faults.push({ on: "chunk", status: 429, reason: "rateLimitExceeded" });
    expect(await sendAll(input.documentId, bytes)).toEqual({ state: "stored" });
  });

  it("refuses to record a file that arrived different from what was declared", async () => {
    const bytes = syntheticFile("pdf", 5000);
    const input = request(bytes, { sha256: "0".repeat(64) });
    await beginUpload(store, target, OFFICE, input);
    await expect(sendAll(input.documentId, bytes)).rejects.toMatchObject({ kind: "mismatch" });
    const row = store.documents.get(input.documentId)!;
    expect(row.state).toBe("failed");
    // The stray file is named on the failed row for an administrator; nothing deleted it.
    expect(drive.files.has(row.driveFileId!)).toBe(true);
  });

  it("checks the bytes itself when Drive has not computed sha256 yet", async () => {
    drive.omitSha256 = true;
    const bytes = syntheticFile("pdf", 4000);
    const input = request(bytes);
    await beginUpload(store, target, OFFICE, input);
    expect(await sendAll(input.documentId, bytes)).toEqual({ state: "stored" });
    expect(drive.requests.some((entry) => entry.kind === "media")).toBe(true);
    expect(store.documents.get(input.documentId)!.sha256).toBe(input.sha256);
  });

  it("refuses an upload left too long", async () => {
    const bytes = syntheticFile("pdf", 4000);
    const input = request(bytes);
    await beginUpload(store, target, OFFICE, input, new Date("2026-10-27T00:00:00Z"));
    await expect(
      acceptChunk(store, target, OFFICE, { documentId: input.documentId, offset: 0, bytes }, new Date("2026-10-29T00:00:00Z")),
    ).rejects.toMatchObject({ kind: "expired" });
    expect(store.documents.get(input.documentId)!.state).toBe("failed");
  });

  it("says why when the Shared Drive membership is gone, and starts cleanly once it is back", async () => {
    const bytes = syntheticFile("pdf", 4000);
    const input = request(bytes);
    drive.faults.push({ on: "folder", status: 403, reason: "insufficientFilePermissions" });
    const failure = await beginUpload(store, target, OFFICE, input).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DriveError);
    expect(failure).toMatchObject({ kind: "forbidden" });
    // Nothing reached Drive, so nothing is listed and nothing blocks a retry.
    expect(store.documents.has(input.documentId)).toBe(false);
    expect(await beginUpload(store, target, OFFICE, input)).toMatchObject({ state: "uploading", offset: 0 });
    expect(await sendAll(input.documentId, bytes)).toEqual({ state: "stored" });
  });

  it("tells a double tap to wait while the first is still opening its session", async () => {
    const bytes = syntheticFile("pdf", 4000);
    const input = request(bytes);
    // The first request has written its row and is still talking to Drive.
    await store.insertDocument({ ...input, uploadedBy: OFFICE.staffId });
    await expect(beginUpload(store, target, OFFICE, input)).rejects.toMatchObject({ kind: "starting" });
    expect(store.documents.get(input.documentId)!.state).toBe("uploading");
  });

  it("gives up on a row whose session never appeared", async () => {
    const bytes = syntheticFile("pdf", 4000);
    const input = request(bytes);
    store.createdAt = () => "2026-10-27T00:00:00Z";
    await store.insertDocument({ ...input, uploadedBy: OFFICE.staffId });
    await expect(
      currentState(store, target, OFFICE, input.documentId, new Date("2026-10-27T00:10:00Z")),
    ).rejects.toMatchObject({ kind: "failed" });
    expect(store.documents.get(input.documentId)!.state).toBe("failed");
  });

  it("makes one session folder even when two first uploads race", async () => {
    const one = syntheticFile("pdf", 1000);
    const two = syntheticFile("pdf", 2000);
    await Promise.all([
      beginUpload(store, target, OFFICE, request(one)),
      beginUpload(store, target, OFFICE, request(two)),
    ]);
    expect(store.folders.size).toBe(1);
    const sessions = [...drive.sessions.values()];
    expect(new Set(sessions.map((session) => session.parents[0]))).toEqual(new Set([store.folders.get("SYN-2026-27")]));
  });
});
