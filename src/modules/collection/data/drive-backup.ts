import { createHash } from "node:crypto";

import { sealForRecovery } from "@/modules/archives/domain/recovery-envelope";

/**
 * The independent copy of every Drive document (D-333).
 *
 * A Drive file id in the database does not restore a birth certificate if
 * the Google account is lost. So each stored Drive document is read back,
 * checked against the sha256 recorded when it was uploaded, sealed for the
 * school's recovery key and written to the private `vppsone-drive-backups`
 * bucket — another provider. A copy is never made from bytes that fail the
 * check: that is a finding, not a backup.
 *
 * Bounded by time, oldest first, so a nightly run that cannot finish
 * carries on the next night from where it stopped. Injected dependencies,
 * so it runs in the tests with no database and no Google.
 */

export const DRIVE_BACKUPS_BUCKET = "vppsone-drive-backups";

export type PendingBackup = {
  id: string;
  driveFileId: string;
  sha256: string;
  version: number;
};

export type BackupDeps = {
  pending: (limit: number) => Promise<PendingBackup[]>;
  read: (driveFileId: string) => Promise<Uint8Array>;
  write: (path: string, sealed: Uint8Array) => Promise<void>;
  record: (id: string, copy: { path: string; sealedSha256: string; keyFingerprint: string }) => Promise<void>;
  now: () => number;
};

export type BackupSummary = {
  copied: number;
  checksumMismatch: number;
  failed: number;
  stoppedForTime: number;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function backupPath(document: Pick<PendingBackup, "id" | "version">, keyFingerprint: string): string {
  return `${document.id}/v${document.version}-${keyFingerprint.slice(0, 16)}.sealed`;
}

export async function backupDriveDocuments(
  deps: BackupDeps,
  input: { recoveryPublicKey: string; keyFingerprint: string; budgetMs: number; batch?: number },
): Promise<BackupSummary> {
  const started = deps.now();
  const summary: BackupSummary = { copied: 0, checksumMismatch: 0, failed: 0, stoppedForTime: 0 };
  const queue = await deps.pending(input.batch ?? 200);

  for (let index = 0; index < queue.length; index += 1) {
    if (deps.now() - started > input.budgetMs) {
      summary.stoppedForTime = queue.length - index;
      break;
    }
    const document = queue[index]!;
    try {
      const bytes = await deps.read(document.driveFileId);
      if (sha256(bytes) !== document.sha256) {
        summary.checksumMismatch += 1;
        continue;
      }
      const sealed = sealForRecovery(input.recoveryPublicKey, bytes);
      const path = backupPath(document, input.keyFingerprint);
      await deps.write(path, sealed);
      await deps.record(document.id, { path, sealedSha256: sha256(sealed), keyFingerprint: input.keyFingerprint });
      summary.copied += 1;
    } catch {
      summary.failed += 1;
    }
  }
  return summary;
}
