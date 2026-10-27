import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import { backupDriveDocuments, backupPath, type PendingBackup } from "@/modules/collection/data/drive-backup";
import {
  checkRecoveryPublicKey,
  openWithRecoveryKey,
  recoveryKeyFingerprint,
  sealForRecovery,
  sealedFingerprint,
} from "@/modules/archives/domain/recovery-envelope";

import { sha256Hex, syntheticFile } from "./fake-drive.fixture";

// One synthetic key pair for the file, as `npm run recovery -- keygen` makes them.
const school = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const stranger = generateKeyPairSync("rsa", {
  modulusLength: 3072,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const fingerprint = recoveryKeyFingerprint(school.publicKey);

describe("a sealed copy", () => {
  it("opens with the school's private key to the same bytes", () => {
    const bytes = syntheticFile("pdf", 250_000);
    const sealed = sealForRecovery(school.publicKey, bytes);
    expect(sealedFingerprint(sealed)).toBe(fingerprint);
    expect(sha256Hex(openWithRecoveryKey(school.privateKey, sealed))).toBe(sha256Hex(bytes));
  });

  it("does not contain the document in the clear", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 SYNTHETIC-AADHAAR-0000-0000");
    const sealed = sealForRecovery(school.publicKey, bytes);
    expect(Buffer.from(sealed).includes(Buffer.from("SYNTHETIC-AADHAAR"))).toBe(false);
  });

  it("refuses the wrong key, and a single changed byte", () => {
    const sealed = sealForRecovery(school.publicKey, syntheticFile("jpeg", 1000));
    expect(() => openWithRecoveryKey(stranger.privateKey, sealed)).toThrow(/sealed for key/);
    const tampered = sealed.slice();
    tampered[tampered.length - 1]! ^= 0x01;
    expect(() => openWithRecoveryKey(school.privateKey, tampered)).toThrow(/changed or damaged/);
  });

  it("will not be made for a weak key", () => {
    const weak = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    expect(checkRecoveryPublicKey(weak.publicKey).ok).toBe(false);
    expect(checkRecoveryPublicKey(school.publicKey)).toEqual({ ok: true, fingerprint });
  });
});

describe("the nightly copy", () => {
  function world(documents: (PendingBackup & { bytes: Uint8Array })[]) {
    const bucket = new Map<string, Uint8Array>();
    const recorded = new Map<string, { path: string; sealedSha256: string; keyFingerprint: string }>();
    let clock = 0;
    return {
      bucket,
      recorded,
      deps: {
        pending: async (limit: number) => documents.filter((doc) => !recorded.has(doc.id)).slice(0, limit),
        read: async (fileId: string) => documents.find((doc) => doc.driveFileId === fileId)!.bytes,
        write: async (path: string, sealed: Uint8Array) => void bucket.set(path, sealed),
        record: async (id: string, copy: { path: string; sealedSha256: string; keyFingerprint: string }) =>
          void recorded.set(id, copy),
        now: () => (clock += 1000),
      },
    };
  }

  const doc = (n: number, bytes: Uint8Array, sha = sha256Hex(bytes)) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    driveFileId: `1SyntheticDriveFile${String(n).padStart(6, "0")}`,
    sha256: sha,
    version: 1,
    bytes,
  });

  it("copies, records, and an isolated restore gets every byte back", async () => {
    const docs = [doc(1, syntheticFile("pdf", 900_000)), doc(2, syntheticFile("jpeg", 120_000))];
    const { deps, bucket, recorded } = world(docs);

    const summary = await backupDriveDocuments(deps, { recoveryPublicKey: school.publicKey, keyFingerprint: fingerprint, budgetMs: 60_000 });
    expect(summary).toEqual({ copied: 2, checksumMismatch: 0, failed: 0, stoppedForTime: 0 });

    // The restore: nothing but the bucket's bytes, the manifest and the private key.
    for (const original of docs) {
      const copy = recorded.get(original.id)!;
      expect(copy.path).toBe(backupPath(original, fingerprint));
      const sealed = bucket.get(copy.path)!;
      expect(sha256Hex(sealed)).toBe(copy.sealedSha256);
      expect(sha256Hex(openWithRecoveryKey(school.privateKey, sealed))).toBe(original.sha256);
    }
  });

  it("never copies bytes that no longer match their checksum", async () => {
    const { deps, bucket } = world([doc(3, syntheticFile("pdf", 5000), "f".repeat(64))]);
    const summary = await backupDriveDocuments(deps, { recoveryPublicKey: school.publicKey, keyFingerprint: fingerprint, budgetMs: 60_000 });
    expect(summary.checksumMismatch).toBe(1);
    expect(bucket.size).toBe(0);
  });

  it("stops at its time budget and leaves the rest for the next night", async () => {
    const docs = Array.from({ length: 5 }, (_, index) => doc(10 + index, syntheticFile("pdf", 2000)));
    const { deps } = world(docs);
    const summary = await backupDriveDocuments(deps, { recoveryPublicKey: school.publicKey, keyFingerprint: fingerprint, budgetMs: 2500 });
    expect(summary.copied).toBeGreaterThan(0);
    expect(summary.copied + summary.stoppedForTime).toBe(5);
  });

  it("counts a failed read without stopping the others", async () => {
    const docs = [doc(20, syntheticFile("pdf", 2000)), doc(21, syntheticFile("pdf", 2000))];
    const { deps } = world(docs);
    const read = deps.read;
    deps.read = async (fileId: string) => {
      if (fileId === docs[0]!.driveFileId) throw new Error("synthetic Drive outage");
      return read(fileId);
    };
    const summary = await backupDriveDocuments(deps, { recoveryPublicKey: school.publicKey, keyFingerprint: fingerprint, budgetMs: 60_000 });
    expect(summary).toMatchObject({ copied: 1, failed: 1 });
  });
});
