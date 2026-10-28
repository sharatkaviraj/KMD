import { createHash } from "node:crypto";

import { sealForRecovery } from "@/modules/archives/domain/recovery-envelope";
import {
  driveFileName,
  sniffDocumentType,
  type AllowedDocumentType,
} from "@/modules/collection/domain/document-files";
import type { DocumentKind } from "@/modules/collection/domain/review";

/**
 * The file half of the nightly Drive backup (D-334).
 *
 *  - **Copies**: every object in the buckets that hold people's files —
 *    documents still in the bucket, photographs, voice notes, the fee app's
 *    photographs — gets a sealed copy in the Drive backup folder, once per
 *    version. A snapshot of the database without these bytes would restore
 *    every row with nothing behind it.
 *  - **Migration** (only while the owner's approval is recorded): a bucket
 *    document is copied into the Drive document folder, checked byte for byte
 *    against Drive's own sha256, and only then pointed at Drive. The bucket
 *    original is kept, which is the rollback.
 *
 * Both are bounded by a deadline and resume the next night. Dependencies are
 * injected, so the tests run them with no database, bucket or Google.
 */

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export type ListedObject = { bucket: string; name: string; size: number; updatedAt: string };
export type KnownCopy = { bucket: string; name: string; sha256: string; bytes: number; copiedAt: string; keyFingerprint: string };

export type ObjectCopyDeps = {
  listing: () => Promise<ListedObject[]>;
  copies: () => Promise<KnownCopy[]>;
  download: (bucket: string, name: string) => Promise<Uint8Array>;
  /** Put sealed bytes in the Drive backup folder; returns the Drive file id. */
  upload: (name: string, sealed: Uint8Array, appProperties: Record<string, string>) => Promise<string>;
  record: (copy: KnownCopy & { driveFileId: string; sealedSha256: string }) => Promise<void>;
  /** Say which file failed and why, for the log; never a file's contents. */
  onFailure?: (subject: string, reason: string) => void;
  now: () => number;
};

export type CopySummary = { copied: number; unchanged: number; failed: number; leftForTomorrow: number };

/**
 * The Drive name of a sealed object copy. Opaque on purpose: a bucket path
 * can carry a student id, and a voice-note path says that child's family
 * owes fees; the mapping lives in `drive_object_copies` and the sealed
 * manifest, not in a name anyone browsing the folder can read.
 */
export function objectCopyName(bucket: string, name: string, sha: string): string {
  const path = createHash("sha256").update(`${bucket}/${name}`).digest("hex");
  return `copy-${path.slice(0, 24)}-${sha.slice(0, 12)}.sealed`;
}

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : "unknown").slice(0, 200);

export async function copyObjectsToDrive(
  deps: ObjectCopyDeps,
  input: { recoveryPublicKey: string; keyFingerprint: string; deadline: number },
): Promise<CopySummary> {
  const summary: CopySummary = { copied: 0, unchanged: 0, failed: 0, leftForTomorrow: 0 };
  const [objects, allCopies] = await Promise.all([deps.listing(), deps.copies()]);
  // Only copies sealed for the current key count: after a key change every
  // file is sealed again, and the old copies stay where they are.
  const copies = allCopies.filter((copy) => copy.keyFingerprint === input.keyFingerprint);
  const latest = new Map<string, KnownCopy>();
  const versions = new Set<string>();
  for (const copy of copies) {
    const key = `${copy.bucket}/${copy.name}`;
    versions.add(`${key}#${copy.sha256}`);
    const held = latest.get(key);
    if (!held || held.copiedAt < copy.copiedAt) latest.set(key, copy);
  }

  for (let index = 0; index < objects.length; index += 1) {
    const object = objects[index]!;
    const key = `${object.bucket}/${object.name}`;
    const held = latest.get(key);
    // Already copied since it last changed, at the same size: nothing to read.
    if (held && held.bytes === object.size && Date.parse(held.copiedAt) >= Date.parse(object.updatedAt)) {
      summary.unchanged += 1;
      continue;
    }
    if (deps.now() > input.deadline) {
      summary.leftForTomorrow = objects.length - index;
      break;
    }
    try {
      const bytes = await deps.download(object.bucket, object.name);
      const sha = sha256(bytes);
      if (versions.has(`${key}#${sha}`)) {
        summary.unchanged += 1;
        continue;
      }
      const sealed = sealForRecovery(input.recoveryPublicKey, bytes);
      const driveFileId = await deps.upload(objectCopyName(object.bucket, object.name, sha), sealed, {
        vppsoneBucket: object.bucket,
        sha256: sha,
      });
      await deps.record({
        bucket: object.bucket,
        name: object.name,
        sha256: sha,
        bytes: bytes.byteLength,
        copiedAt: new Date(deps.now()).toISOString(),
        driveFileId,
        sealedSha256: sha256(sealed),
        keyFingerprint: input.keyFingerprint,
      });
      versions.add(`${key}#${sha}`);
      summary.copied += 1;
    } catch (error) {
      summary.failed += 1;
      deps.onFailure?.(`${object.bucket}/${object.name}`, reasonOf(error));
    }
  }
  return summary;
}

export type BucketDocument = {
  id: string;
  studentId: string;
  sessionLabel: string;
  kind: DocumentKind;
  contentType: AllowedDocumentType;
  byteSize: number;
  sha256: string | null;
  storagePath: string;
};

export type MigrationDeps = {
  pending: (limit: number) => Promise<BucketDocument[]>;
  download: (storagePath: string) => Promise<Uint8Array>;
  folderFor: (sessionLabel: string) => Promise<string>;
  upload: (input: {
    name: string;
    parentId: string;
    contentType: string;
    bytes: Uint8Array;
    appProperties: Record<string, string>;
  }) => Promise<{ id: string; sha256: string | null }>;
  /** Drive's own sha256 of a stored file, read back. */
  driveSha256: (driveFileId: string) => Promise<string | null>;
  /** Point the row at Drive, only if it is still an unmigrated, unremoved bucket row. */
  flip: (id: string, input: { driveFileId: string; sha256: string }) => Promise<boolean>;
  /**
   * Park a row that could not be moved, with why, so it is not read and
   * uploaded again every night. Cleared by hand once looked at.
   */
  park: (id: string, note: string) => Promise<void>;
  now: () => number;
};

export type MigrationSummary = {
  migrated: number;
  /** The bucket bytes did not match the row (size, type or recorded sha256): not moved. */
  mismatched: number;
  /** Drive's checksum differed from the bucket bytes: not pointed at Drive. */
  driveMismatch: number;
  failed: number;
  /** Rows from before checksums were recorded: moved on size, type and Drive's read-back. */
  noPriorChecksum: number;
  leftForTomorrow: number;
};

export async function migrateBucketDocuments(deps: MigrationDeps, input: { deadline: number; batch?: number }) {
  const summary: MigrationSummary = { migrated: 0, mismatched: 0, driveMismatch: 0, failed: 0, noPriorChecksum: 0, leftForTomorrow: 0 };
  const queue = await deps.pending(input.batch ?? 100);

  for (let index = 0; index < queue.length; index += 1) {
    if (deps.now() > input.deadline) {
      summary.leftForTomorrow = queue.length - index;
      break;
    }
    const document = queue[index]!;
    // A row that cannot be moved is parked with why; a failure to park is
    // only logged by the caller, and the row is tried again tomorrow.
    const park = (note: string) => deps.park(document.id, note).catch(() => undefined);
    try {
      const bytes = await deps.download(document.storagePath);
      const sha = sha256(bytes);
      const sameType = sniffDocumentType(bytes.subarray(0, 16)) === document.contentType;
      if (bytes.byteLength !== document.byteSize || !sameType || (document.sha256 && document.sha256 !== sha)) {
        summary.mismatched += 1;
        await park(
          bytes.byteLength !== document.byteSize
            ? `bucket bytes ${bytes.byteLength}, row says ${document.byteSize}`
            : !sameType
              ? "bucket bytes are not the recorded type"
              : "bucket bytes differ from the recorded sha256",
        );
        continue;
      }
      if (!document.sha256) summary.noPriorChecksum += 1;

      const folder = await deps.folderFor(document.sessionLabel);
      const file = await deps.upload({
        name: driveFileName({
          kind: document.kind,
          studentId: document.studentId,
          documentId: document.id,
          contentType: document.contentType,
        }),
        parentId: folder,
        contentType: document.contentType,
        bytes,
        appProperties: {
          vppsoneDocumentId: document.id,
          vppsoneStudentId: document.studentId,
          vppsoneKind: document.kind,
          sha256: sha,
          migratedFrom: "vppsone-documents",
        },
      });
      const driveSha = (file.sha256 ?? (await deps.driveSha256(file.id)))?.toLowerCase() ?? null;
      if (driveSha !== sha) {
        // The Drive copy is not trusted, so the row keeps pointing at the
        // bucket; the stray Drive file is named for whoever looks.
        summary.driveMismatch += 1;
        await park(`Drive file ${file.id} came back with a different sha256; not used`);
        continue;
      }
      if (await deps.flip(document.id, { driveFileId: file.id, sha256: sha })) {
        summary.migrated += 1;
      } else {
        // Removed or changed while it was being copied: nothing points at the copy.
        await park(`row changed during the move; Drive file ${file.id} is unused`);
      }
    } catch (error) {
      summary.failed += 1;
      await park(`move failed: ${reasonOf(error)}`);
    }
  }
  return summary;
}
