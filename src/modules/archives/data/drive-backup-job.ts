import "server-only";

import { createHash } from "node:crypto";

import { checkRecoveryPublicKey } from "@/modules/archives/domain/recovery-envelope";
import { driveTarget, supabaseUploadStore } from "@/modules/collection/data/drive-documents";
import { DOCUMENTS_BUCKET } from "@/modules/collection/data/documents-repo";
import { readStorageSettings } from "@/modules/collection/data/storage-settings";
import {
  createFolder,
  createSmallFile,
  downloadFile,
  getFile,
  uploadLargeFile,
  type DriveDeps,
} from "@/platform/google/drive";
import { createAdminClient } from "@/platform/supabase/admin";

import {
  copyObjectsToDrive,
  migrateBucketDocuments,
  type BucketDocument,
  type KnownCopy,
  type ListedObject,
} from "./drive-file-copies";
import {
  buildManifest,
  exportAllTables,
  packSnapshot,
  snapshotBaseName,
  type SnapshotFile,
} from "./drive-snapshot";

/**
 * The nightly "Backup to Google Drive" job (D-334): sealed copies of every
 * stored file, the approved copy-only move of bucket documents, then one
 * snapshot of the whole database with its manifest — all into the school's
 * central Drive folder.
 *
 * It throws — so the run is recorded as failed on the Jobs screen — when
 * Drive is not set up, when no valid recovery key is set (nothing is written
 * unsealed), or when any copy or move failed or did not match. The snapshot
 * is still written first, so a bad file never costs the night's database copy.
 */

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Db = ReturnType<typeof createAdminClient>;

/** A folder under the Drive root, created once and remembered (the primary key stops two). */
async function backupFolder(deps: DriveDeps, key: string, name: string, parentId: string): Promise<string> {
  const store = supabaseUploadStore();
  const known = await store.folderFor(key);
  if (known) return known;
  return store.claimFolder(key, await createFolder(deps, { name, parentId }));
}

async function must<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, what: string): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`Could not ${what}: ${error.message}`);
  return data as T;
}

async function driveSha256Of(deps: DriveDeps, fileId: string): Promise<string | null> {
  const file = await getFile(deps, fileId);
  if (file.sha256Checksum) return file.sha256Checksum.toLowerCase();
  return sha256(new Uint8Array(await (await downloadFile(deps, fileId)).arrayBuffer()));
}

export async function runDriveBackup(oidcToken: string | null): Promise<Record<string, number | string>> {
  const started = Date.now();
  const settings = await readStorageSettings();
  const target = driveTarget(settings, oidcToken);
  if (!target) throw new Error("Drive is not configured, so there is nowhere central to back up to.");

  const publicKey = settings.recoveryPublicKey;
  const fingerprint = settings.recoveryKeyFingerprint;
  const key = publicKey ? checkRecoveryPublicKey(publicKey) : { ok: false as const };
  if (!publicKey || !fingerprint || !key.ok || key.fingerprint !== fingerprint) {
    throw new Error("No valid recovery key is set; backups are never written unsealed.");
  }

  const db: Db = createAdminClient();
  const backups = await backupFolder(target.deps, "_backups", "backups", target.rootFolderId);
  const objectsFolder = await backupFolder(target.deps, "_backups_objects", "file copies", backups);

  // 1. Sealed copies of every stored file.
  const copies = await copyObjectsToDrive(
    {
      listing: async () =>
        (await must<{ bucket: string; name: string; size: number; updated_at: string }[]>(
          db.rpc("backup_object_listing"),
          "list the stored files",
        )).map((row): ListedObject => ({ bucket: row.bucket, name: row.name, size: Number(row.size), updatedAt: row.updated_at })),
      copies: async () =>
        (await must<{ bucket: string; object_name: string; sha256: string; bytes: number; copied_at: string }[]>(
          db.from("drive_object_copies").select("bucket, object_name, sha256, bytes, copied_at"),
          "read the file copies",
        )).map((row): KnownCopy => ({
          bucket: row.bucket,
          name: row.object_name,
          sha256: row.sha256,
          bytes: Number(row.bytes),
          copiedAt: row.copied_at,
        })),
      download: async (bucket, name) => {
        const { data, error } = await db.storage.from(bucket).download(name);
        if (error || !data) throw new Error(`Could not read ${bucket}/${name}`);
        return new Uint8Array(await data.arrayBuffer());
      },
      upload: async (name, sealed, appProperties) =>
        (await uploadLargeFile(target.deps, {
          name,
          parentId: objectsFolder,
          contentType: "application/octet-stream",
          bytes: sealed,
          appProperties,
        })).id,
      record: async (copy) => {
        await must(
          db.from("drive_object_copies").insert({
            bucket: copy.bucket,
            object_name: copy.name,
            sha256: copy.sha256,
            bytes: copy.bytes,
            drive_file_id: copy.driveFileId,
            sealed_sha256: copy.sealedSha256,
            key_fingerprint: copy.keyFingerprint,
          }),
          "record the file copy",
        );
      },
      now: Date.now,
    },
    { recoveryPublicKey: publicKey, keyFingerprint: fingerprint, deadline: started + 90_000 },
  );

  // 2. The copy-only move of bucket documents, only while approved.
  const migration = settings.bucketMigrationApprovedAt
    ? await migrateBucketDocuments(
        {
          pending: async (limit) =>
            (await must<
              {
                id: string;
                student_id: string;
                session_label: string;
                kind: BucketDocument["kind"];
                content_type: BucketDocument["contentType"];
                byte_size: number;
                content_sha256: string | null;
                storage_path: string;
              }[]
            >(
              db
                .from("student_documents")
                .select("id, student_id, session_label, kind, content_type, byte_size, content_sha256, storage_path")
                .eq("storage_provider", "supabase")
                .eq("upload_state", "stored")
                .is("removed_at", null)
                .is("migrated_at", null)
                .order("created_at", { ascending: true })
                .limit(limit),
              "list bucket documents to move",
            )).map((row) => ({
              id: row.id,
              studentId: row.student_id,
              sessionLabel: row.session_label,
              kind: row.kind,
              contentType: row.content_type,
              byteSize: Number(row.byte_size),
              sha256: row.content_sha256,
              storagePath: row.storage_path,
            })),
          download: async (path) => {
            const { data, error } = await db.storage.from(DOCUMENTS_BUCKET).download(path);
            if (error || !data) throw new Error(`Could not read ${path}`);
            return new Uint8Array(await data.arrayBuffer());
          },
          folderFor: async (sessionLabel) =>
            backupFolder(target.deps, sessionLabel, `session ${sessionLabel}`, target.rootFolderId),
          upload: async (input) => {
            const file = await uploadLargeFile(target.deps, input);
            return { id: file.id, sha256: file.sha256Checksum ?? null };
          },
          driveSha256: (fileId) => driveSha256Of(target.deps, fileId),
          flip: async (id, input) =>
            (
              await must<{ id: string }[]>(
                db
                  .from("student_documents")
                  .update({
                    storage_provider: "gdrive",
                    drive_file_id: input.driveFileId,
                    content_sha256: input.sha256,
                    migrated_at: new Date().toISOString(),
                  })
                  .eq("id", id)
                  .eq("storage_provider", "supabase")
                  .is("migrated_at", null)
                  .select("id"),
                "point the document at Drive",
              )
            ).length > 0,
          now: Date.now,
        },
        { deadline: started + 150_000 },
      )
    : null;

  // 3. The database snapshot, with the file list as it stands after 1 and 2.
  const { lines, tables } = await exportAllTables(db);
  const listing = await must<{ bucket: string; name: string; size: number }[]>(db.rpc("backup_object_listing"), "list the stored files");
  const copyRows = await must<{ bucket: string; object_name: string; drive_file_id: string; sha256: string; copied_at: string }[]>(
    db.from("drive_object_copies").select("bucket, object_name, drive_file_id, sha256, copied_at").order("copied_at", { ascending: true }),
    "read the file copies",
  );
  const lastCopy = new Map(copyRows.map((row) => [`${row.bucket}/${row.object_name}`, row]));
  const driveDocuments = await must<{ id: string; drive_file_id: string; byte_size: number; content_sha256: string }[]>(
    db
      .from("student_documents")
      .select("id, drive_file_id, byte_size, content_sha256")
      .eq("storage_provider", "gdrive")
      .eq("upload_state", "stored"),
    "list the Drive documents",
  );
  const files: SnapshotFile[] = [
    ...listing.map((object): SnapshotFile => {
      const copy = lastCopy.get(`${object.bucket}/${object.name}`);
      return {
        kind: "bucket",
        bucket: object.bucket,
        name: object.name,
        bytes: Number(object.size),
        sha256: copy?.sha256 ?? null,
        driveCopyId: copy?.drive_file_id ?? null,
      };
    }),
    ...driveDocuments.map((row): SnapshotFile => ({
      kind: "drive",
      documentId: row.id,
      driveFileId: row.drive_file_id,
      bytes: Number(row.byte_size),
      sha256: row.content_sha256,
    })),
  ];

  const at = new Date();
  const base = snapshotBaseName(at);
  const packed = packSnapshot(lines, publicKey);
  const { data: schemaVersion } = await db.rpc("archive_schema_version");
  const manifest = buildManifest({
    createdAt: at.toISOString(),
    bundleName: `${base}.jsonl.gz.sealed`,
    schemaVersion: (schemaVersion as string | null) ?? null,
    appCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    keyFingerprint: fingerprint,
    packed,
    tables,
    files,
  });

  const bundle = await uploadLargeFile(target.deps, {
    name: manifest.bundle.name,
    parentId: backups,
    contentType: "application/octet-stream",
    bytes: packed.sealed,
    appProperties: { vppsoneSnapshot: base, sha256: packed.sealedSha256 },
  });
  const bundleSha = await driveSha256Of(target.deps, bundle.id);
  if (bundleSha !== packed.sealedSha256) throw new Error("The snapshot read back from Drive differs from what was written.");
  const manifestFile = await createSmallFile(target.deps, {
    name: `${base}.manifest.json`,
    parentId: backups,
    contentType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
    appProperties: { vppsoneSnapshot: base },
  });
  await must(
    db.from("drive_snapshots").insert({
      bundle_drive_file_id: bundle.id,
      manifest_drive_file_id: manifestFile.id,
      key_fingerprint: fingerprint,
      sealed_sha256: packed.sealedSha256,
      plain_sha256: packed.plainSha256,
      sealed_bytes: packed.sealed.byteLength,
      schema_version: manifest.schemaVersion,
      app_commit: manifest.appCommit,
      table_count: manifest.totals.tables,
      row_count: manifest.totals.rows,
      object_count: manifest.totals.files,
    }),
    "record the snapshot",
  );

  const summary: Record<string, number | string> = {
    snapshot: base,
    tables: manifest.totals.tables,
    rows: manifest.totals.rows,
    files: manifest.totals.files,
    snapshotKB: Math.round(packed.sealed.byteLength / 1024),
    copied: copies.copied,
    copiesUnchanged: copies.unchanged,
    copiesFailed: copies.failed,
    copiesLeft: copies.leftForTomorrow,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  if (migration) {
    Object.assign(summary, {
      moved: migration.migrated,
      moveMismatch: migration.mismatched + migration.driveMismatch,
      moveFailed: migration.failed,
      moveNoPriorChecksum: migration.noPriorChecksum,
      moveLeft: migration.leftForTomorrow,
    });
  }

  const problems =
    copies.failed + (migration ? migration.failed + migration.mismatched + migration.driveMismatch : 0);
  if (problems > 0) {
    throw new Error(
      `Snapshot ${base} saved. ${copies.failed} file copies failed` +
        (migration
          ? `; moving bucket documents: ${migration.mismatched} did not match their record, ` +
            `${migration.driveMismatch} differed in Drive, ${migration.failed} failed (all left in the bucket)`
          : "") +
        ".",
    );
  }
  return summary;
}
