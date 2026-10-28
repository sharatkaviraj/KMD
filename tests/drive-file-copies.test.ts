import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  copyObjectsToDrive,
  migrateBucketDocuments,
  objectCopyName,
  type BucketDocument,
  type KnownCopy,
  type ListedObject,
} from "@/modules/archives/data/drive-file-copies";
import { openWithRecoveryKey, recoveryKeyFingerprint } from "@/modules/archives/domain/recovery-envelope";

import { syntheticFile } from "./fake-drive.fixture";

const school = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const fingerprint = recoveryKeyFingerprint(school.publicKey);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("file copies into Drive", () => {
  function world(objects: (ListedObject & { bytes: Uint8Array })[], copies: KnownCopy[] = []) {
    const drive = new Map<string, Uint8Array>();
    const recorded: (KnownCopy & { driveFileId: string })[] = [];
    const reads: string[] = [];
    let clock = Date.parse("2026-10-28T22:00:00Z");
    return {
      drive,
      recorded,
      reads,
      deps: {
        listing: async () => objects.map(({ bytes: _bytes, ...object }) => object),
        copies: async () => copies,
        download: async (bucket: string, name: string) => {
          reads.push(`${bucket}/${name}`);
          return objects.find((object) => object.bucket === bucket && object.name === name)!.bytes;
        },
        upload: async (name: string, sealed: Uint8Array) => {
          const id = `1SyntheticCopy${String(drive.size).padStart(8, "0")}`;
          drive.set(id, sealed);
          expect(name).toMatch(/\.sealed$/);
          return id;
        },
        record: async (copy: KnownCopy & { driveFileId: string }) => void recorded.push(copy),
        now: () => (clock += 1000),
      },
    };
  }

  it("seals every file once, and the copy opens to the same bytes", async () => {
    const photo = syntheticFile("jpeg", 4000);
    const document = syntheticFile("pdf", 9000);
    const { deps, drive, recorded } = world([
      { bucket: "vppsone-photos", name: "2026-27/s1/p1.jpg", size: photo.byteLength, updatedAt: "2026-10-20T00:00:00Z", bytes: photo },
      { bucket: "vppsone-documents", name: "2026-27/s1/d1.pdf", size: document.byteLength, updatedAt: "2026-10-27T00:00:00Z", bytes: document },
    ]);
    const summary = await copyObjectsToDrive(deps, { recoveryPublicKey: school.publicKey, keyFingerprint: fingerprint, deadline: Infinity });
    expect(summary).toEqual({ copied: 2, unchanged: 0, failed: 0, leftForTomorrow: 0 });
    for (const copy of recorded) {
      expect(sha(openWithRecoveryKey(school.privateKey, drive.get(copy.driveFileId)!))).toBe(copy.sha256);
    }
  });

  it("does not read a file again that has not changed since its copy", async () => {
    const photo = syntheticFile("jpeg", 4000);
    const { deps, reads } = world(
      [{ bucket: "vppsone-photos", name: "p.jpg", size: photo.byteLength, updatedAt: "2026-10-20T00:00:00Z", bytes: photo }],
      [{ bucket: "vppsone-photos", name: "p.jpg", sha256: sha(photo), bytes: photo.byteLength, copiedAt: "2026-10-21T00:00:00Z" }],
    );
    const summary = await copyObjectsToDrive(deps, { recoveryPublicKey: school.publicKey, keyFingerprint: fingerprint, deadline: Infinity });
    expect(summary).toMatchObject({ copied: 0, unchanged: 1 });
    expect(reads).toEqual([]);
  });

  it("copies a replaced file as a new version and keeps the old one", async () => {
    const newer = syntheticFile("jpeg", 5000);
    const { deps, recorded } = world(
      [{ bucket: "vppsone-photos", name: "p.jpg", size: newer.byteLength, updatedAt: "2026-10-28T00:00:00Z", bytes: newer }],
      [{ bucket: "vppsone-photos", name: "p.jpg", sha256: "e".repeat(64), bytes: 4000, copiedAt: "2026-10-21T00:00:00Z" }],
    );
    await copyObjectsToDrive(deps, { recoveryPublicKey: school.publicKey, keyFingerprint: fingerprint, deadline: Infinity });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.sha256).toBe(sha(newer));
  });

  it("names copies without a person's name", () => {
    expect(objectCopyName("vppsone-documents", "2026-27/s1/d1.pdf", "a".repeat(64))).toBe(
      "vppsone-documents__2026-27__s1__d1.pdf__aaaaaaaaaaaa.sealed",
    );
  });
});

describe("the copy-only move of bucket documents", () => {
  function world(documents: (BucketDocument & { bytes: Uint8Array })[], options: { driveCorrupts?: boolean } = {}) {
    const flipped = new Map<string, { driveFileId: string; sha256: string }>();
    const drive = new Map<string, Uint8Array>();
    return {
      flipped,
      drive,
      deps: {
        pending: async () => documents.filter((document) => !flipped.has(document.id)),
        download: async (path: string) => documents.find((document) => document.storagePath === path)!.bytes,
        folderFor: async (session: string) => `1SyntheticFolder${session.replace(/[^0-9]/g, "")}`,
        upload: async (input: { bytes: Uint8Array; name: string }) => {
          const id = `1SyntheticMoved${String(drive.size).padStart(8, "0")}`;
          const stored = options.driveCorrupts ? input.bytes.slice(1) : input.bytes;
          drive.set(id, stored);
          return { id, sha256: sha(stored) };
        },
        driveSha256: async (id: string) => sha(drive.get(id)!),
        flip: async (id: string, input: { driveFileId: string; sha256: string }) => {
          flipped.set(id, input);
          return true;
        },
        now: Date.now,
      },
    };
  }

  const document = (n: number, bytes: Uint8Array, overrides: Partial<BucketDocument> = {}) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    studentId: "00000000-0000-4000-8000-0000000000b1",
    sessionLabel: "2026-27",
    kind: "other" as const,
    contentType: "application/pdf" as const,
    byteSize: bytes.byteLength,
    sha256: sha(bytes),
    storagePath: `2026-27/student/${n}.pdf`,
    bytes,
    ...overrides,
  });

  it("moves a document only after Drive holds exactly its bytes", async () => {
    const bytes = syntheticFile("pdf", 20_000);
    const { deps, flipped, drive } = world([document(1, bytes)]);
    expect(await migrateBucketDocuments(deps, { deadline: Infinity })).toMatchObject({ migrated: 1, mismatched: 0, driveMismatch: 0 });
    const moved = flipped.get(document(1, bytes).id)!;
    expect(sha(drive.get(moved.driveFileId)!)).toBe(sha(bytes));
  });

  it("leaves a document in the bucket when its bytes do not match the record", async () => {
    const bytes = syntheticFile("pdf", 20_000);
    const { deps, flipped } = world([
      document(2, bytes, { sha256: "0".repeat(64) }),
      document(3, bytes, { byteSize: 1 }),
      document(4, syntheticFile("html", 20_000)),
    ]);
    expect(await migrateBucketDocuments(deps, { deadline: Infinity })).toMatchObject({ migrated: 0, mismatched: 3 });
    expect(flipped.size).toBe(0);
  });

  it("does not point at a Drive copy that came back different", async () => {
    const bytes = syntheticFile("pdf", 20_000);
    const { deps, flipped } = world([document(5, bytes)], { driveCorrupts: true });
    expect(await migrateBucketDocuments(deps, { deadline: Infinity })).toMatchObject({ migrated: 0, driveMismatch: 1 });
    expect(flipped.size).toBe(0);
  });

  it("moves an old row with no recorded checksum on size, type and Drive's read-back, and says so", async () => {
    const bytes = syntheticFile("pdf", 193);
    const { deps, flipped } = world([document(6, bytes, { sha256: null })]);
    expect(await migrateBucketDocuments(deps, { deadline: Infinity })).toMatchObject({ migrated: 1, noPriorChecksum: 1 });
    expect(flipped.get(document(6, bytes).id)!.sha256).toBe(sha(bytes));
  });
});
