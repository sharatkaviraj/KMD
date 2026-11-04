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
import { AI_INPUT_BUCKET } from "@/lib/ai/media-limits";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchAllRows } from "@/platform/supabase/paginate";

import {
  copyObjectsToDrive,
  migrateBucketDocuments,
  type BucketDocument,
  type CopySummary,
  type KnownCopy,
  type ListedObject,
  type MigrationSummary,
} from "./drive-file-copies";
import {
  buildSummary,
  exportAllTables,
  packSnapshot,
  snapshotBaseName,
  type InnerManifest,
  type SnapshotFile,
} from "./drive-snapshot";

/**
 * The nightly "Backup to Google Drive" job (D-334), in this order:
 *
 *  1. the database snapshot and its summary, first, so nothing later in the
 *     night can cost it;
 *  2. sealed copies of every stored file, for as long as time allows;
 *  3. the approved copy-only move of bucket documents, for as long as time
 *     allows.
 *
 * Steps 2 and 3 cannot abort each other or the snapshot. It throws — so the
 * run is recorded as failed on the Jobs screen — when Drive is not set up,
 * when no valid recovery key is set (nothing is written unsealed), when the
 * snapshot fails, or when any copy or move failed (each named in the log).
 * Every read that can pass a thousand rows is paged.
 */

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Db = ReturnType<typeof createAdminClient>;

/** Stop starting new files after this long; the function has 300 s. */
const SNAPSHOT_BUDGET_MS = 150_000;
const COPIES_UNTIL_MS = 210_000;
const MOVES_UNTIL_MS = 260_000;

function log(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ kind: "vppsone.backup", event, ...fields }));
}

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

const listObjects = (db: Db) =>
  fetchAllRows<{ bucket: string; name: string; size: number; updated_at: string }>(
    (from, to) => db.rpc("backup_object_listing").range(from, to),
    "the stored files",
  ).then((objects) => objects.filter((object) => object.bucket !== AI_INPUT_BUCKET));

const listCopies = (db: Db) =>
  fetchAllRows<{
    bucket: string;
    object_name: string;
    sha256: string;
    bytes: number;
    copied_at: string;
    drive_file_id: string;
    key_fingerprint: string;
  }>(
    (from, to) =>
      db
        .from("drive_object_copies")
        .select("bucket, object_name, sha256, bytes, copied_at, drive_file_id, key_fingerprint")
        .order("bucket")
        .order("object_name")
        .order("copied_at")
        .range(from, to),
    "the file copies",
  );

async function snapshot(db: Db, deps: DriveDeps, folder: string, key: { publicKey: string; fingerprint: string }) {
  const started = Date.now();
  const { lines, tables, consistent } = await exportAllTables(db);

  const [objects, copies, driveDocuments] = await Promise.all([
    listObjects(db),
    listCopies(db),
    fetchAllRows<{ id: string; drive_file_id: string; byte_size: number; content_sha256: string }>(
      (from, to) =>
        db
          .from("student_documents")
          .select("id, drive_file_id, byte_size, content_sha256")
          .eq("storage_provider", "gdrive")
          .eq("upload_state", "stored")
          .order("id")
          .range(from, to),
      "the Drive documents",
    ),
  ]);
  const lastCopy = new Map<string, (typeof copies)[number]>();
  for (const copy of copies) if (copy.key_fingerprint === key.fingerprint) lastCopy.set(`${copy.bucket}/${copy.object_name}`, copy);

  const files: SnapshotFile[] = [
    ...objects.map((object): SnapshotFile => {
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
  const { data: schemaVersion } = await db.rpc("archive_schema_version");
  const inner: InnerManifest = {
    kind: "manifest",
    createdAt: at.toISOString(),
    schemaVersion: (schemaVersion as string | null) ?? null,
    appCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    consistent,
    tables,
    files,
  };
  const packed = packSnapshot(inner, lines, key.publicKey);
  const summary = buildSummary({ inner, bundleName: `${base}.jsonl.gz.sealed`, keyFingerprint: key.fingerprint, packed });

  const bundle = await uploadLargeFile(deps, {
    name: summary.bundle.name,
    parentId: folder,
    contentType: "application/octet-stream",
    bytes: packed.sealed,
    appProperties: { vppsoneSnapshot: base, sha256: packed.sealedSha256 },
  });
  if ((await driveSha256Of(deps, bundle.id)) !== packed.sealedSha256) {
    throw new Error("The snapshot read back from Drive differs from what was written.");
  }
  const summaryFile = await createSmallFile(deps, {
    name: `${base}.summary.json`,
    parentId: folder,
    contentType: "application/json",
    bytes: new TextEncoder().encode(JSON.stringify(summary, null, 2)),
    appProperties: { vppsoneSnapshot: base },
  });
  await must(
    db.from("drive_snapshots").insert({
      bundle_drive_file_id: bundle.id,
      manifest_drive_file_id: summaryFile.id,
      key_fingerprint: key.fingerprint,
      sealed_sha256: packed.sealedSha256,
      plain_sha256: packed.plainSha256,
      sealed_bytes: packed.sealed.byteLength,
      schema_version: summary.schemaVersion,
      app_commit: summary.appCommit,
      table_count: summary.totals.tables,
      row_count: summary.totals.rows,
      object_count: summary.totals.files,
    }),
    "record the snapshot",
  );
  log("snapshot", { base, tables: summary.totals.tables, rows: summary.totals.rows, sealedBytes: packed.sealed.byteLength, ms: Date.now() - started });
  return { base, summary, consistent };
}

async function copyFiles(db: Db, deps: DriveDeps, folder: string, key: { publicKey: string; fingerprint: string }, deadline: number) {
  return copyObjectsToDrive(
    {
      listing: async () =>
        (await listObjects(db)).map((row): ListedObject => ({
          bucket: row.bucket,
          name: row.name,
          size: Number(row.size),
          updatedAt: row.updated_at,
        })),
      copies: async () =>
        (await listCopies(db)).map((row): KnownCopy => ({
          bucket: row.bucket,
          name: row.object_name,
          sha256: row.sha256,
          bytes: Number(row.bytes),
          copiedAt: row.copied_at,
          keyFingerprint: row.key_fingerprint,
        })),
      download: async (bucket, name) => {
        const { data, error } = await db.storage.from(bucket).download(name);
        if (error || !data) throw new Error(`could not read the bucket object`);
        return new Uint8Array(await data.arrayBuffer());
      },
      upload: async (name, sealed, appProperties) =>
        (await uploadLargeFile(deps, { name, parentId: folder, contentType: "application/octet-stream", bytes: sealed, appProperties })).id,
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
      onFailure: (subject, reason) => log("copy-failed", { subject, reason }),
      now: Date.now,
    },
    { recoveryPublicKey: key.publicKey, keyFingerprint: key.fingerprint, deadline },
  );
}

async function moveBucketDocuments(db: Db, deps: DriveDeps, rootFolderId: string, deadline: number) {
  return migrateBucketDocuments(
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
            .is("migration_failed_at", null)
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
        if (error || !data) throw new Error("could not read the bucket original");
        return new Uint8Array(await data.arrayBuffer());
      },
      folderFor: (sessionLabel) => backupFolder(deps, sessionLabel, `session ${sessionLabel}`, rootFolderId),
      upload: async (input) => {
        const file = await uploadLargeFile(deps, input);
        return { id: file.id, sha256: file.sha256Checksum ?? null };
      },
      driveSha256: (fileId) => driveSha256Of(deps, fileId),
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
              .eq("upload_state", "stored")
              .is("removed_at", null)
              .is("migrated_at", null)
              .select("id"),
            "point the document at Drive",
          )
        ).length > 0,
      park: async (id, note) => {
        log("move-parked", { documentId: id, note });
        await must(
          db
            .from("student_documents")
            .update({ migration_failed_at: new Date().toISOString(), migration_note: note.slice(0, 300) })
            .eq("id", id)
            .is("migrated_at", null),
          "park the document",
        );
      },
      now: Date.now,
    },
    { deadline },
  );
}

export async function runDriveBackup(oidcToken: string | null): Promise<Record<string, number | string>> {
  const started = Date.now();
  const settings = await readStorageSettings();
  const target = driveTarget(settings, oidcToken);
  if (!target) throw new Error("Drive is not configured, so there is nowhere central to back up to.");

  const publicKey = settings.recoveryPublicKey;
  const fingerprint = settings.recoveryKeyFingerprint;
  const checked = publicKey ? checkRecoveryPublicKey(publicKey) : { ok: false as const };
  if (!publicKey || !fingerprint || !checked.ok || checked.fingerprint !== fingerprint) {
    throw new Error("No valid recovery key is set; backups are never written unsealed.");
  }
  const key = { publicKey, fingerprint };

  const db: Db = createAdminClient();
  const backups = await backupFolder(target.deps, "_backups", "backups", target.rootFolderId);

  // 1. The snapshot. If this fails, the run fails.
  const snap = await snapshot(db, target.deps, backups, key);
  if (Date.now() - started > SNAPSHOT_BUDGET_MS) log("snapshot-slow", { ms: Date.now() - started });

  // 2. File copies, then 3. the move — each in its own try, each by deadline.
  let copies: CopySummary | null = null;
  let copyError: string | null = null;
  try {
    const objectsFolder = await backupFolder(target.deps, "_backups_objects", "file copies", backups);
    copies = await copyFiles(db, target.deps, objectsFolder, key, started + COPIES_UNTIL_MS);
  } catch (error) {
    copyError = error instanceof Error ? error.message.slice(0, 200) : "unknown";
    log("copies-failed", { reason: copyError });
  }

  let moves: MigrationSummary | null = null;
  let moveError: string | null = null;
  if (settings.bucketMigrationApprovedAt) {
    try {
      moves = await moveBucketDocuments(db, target.deps, target.rootFolderId, started + MOVES_UNTIL_MS);
    } catch (error) {
      moveError = error instanceof Error ? error.message.slice(0, 200) : "unknown";
      log("moves-failed", { reason: moveError });
    }
  }

  const summary: Record<string, number | string> = {
    snapshot: snap.base,
    tables: snap.summary.totals.tables,
    rows: snap.summary.totals.rows,
    files: snap.summary.totals.files,
    snapshotKB: Math.round(snap.summary.bundle.sealedBytes / 1024),
    oneMoment: snap.consistent.vppsone && snap.consistent.public ? "yes" : "no",
    seconds: Math.round((Date.now() - started) / 1000),
  };
  if (copies) {
    Object.assign(summary, {
      copied: copies.copied,
      copiesUnchanged: copies.unchanged,
      copiesFailed: copies.failed,
      copiesLeft: copies.leftForTomorrow,
    });
  }
  if (moves) {
    Object.assign(summary, {
      moved: moves.migrated,
      moveParked: moves.mismatched + moves.driveMismatch + moves.failed,
      moveNoPriorChecksum: moves.noPriorChecksum,
      moveLeft: moves.leftForTomorrow,
    });
  }

  const problems: string[] = [];
  if (copyError) problems.push(`file copies stopped: ${copyError}`);
  if (copies?.failed) problems.push(`${copies.failed} file copies failed`);
  if (moveError) problems.push(`moving bucket documents stopped: ${moveError}`);
  if (moves && moves.mismatched + moves.driveMismatch + moves.failed > 0) {
    problems.push(
      `${moves.mismatched + moves.driveMismatch + moves.failed} bucket documents parked, not moved ` +
        "(see migration_note; each is still in the bucket)",
    );
  }
  if (problems.length > 0) throw new Error(`Snapshot ${snap.base} saved. ${problems.join("; ")}.`);
  return summary;
}
