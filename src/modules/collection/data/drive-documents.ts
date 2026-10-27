import "server-only";

import type { UploadRequest } from "@/modules/collection/domain/document-files";
import {
  DriveError,
  createSmallFile,
  downloadFile,
  findChild,
  getFile,
  replaceContent,
} from "@/platform/google/drive";
import { GoogleAuthError } from "@/platform/google/workload-identity";
import { readsEveryClass, type StaffRole } from "@/platform/auth/permissions";
import { createAdminClient } from "@/platform/supabase/admin";
import { createClient } from "@/platform/supabase/server";

import { checkRecoveryPublicKey } from "@/modules/archives/domain/recovery-envelope";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";

import { DRIVE_BACKUPS_BUCKET, backupDriveDocuments } from "./drive-backup";
import type { DocumentRow, DriveTarget, SessionRow, UploadStore } from "./drive-upload-flow";
import { driveDeps, readStorageSettings, type FileStorageSettings } from "./storage-settings";

/**
 * The database and Google halves of Drive-backed documents (D-333): the
 * Supabase implementation of `UploadStore`, the class-scope check, reading
 * bytes back out, and the administrator's health check.
 */

type DocumentDbRow = {
  id: string;
  student_id: string;
  session_label: string;
  kind: DocumentRow["kind"];
  content_type: DocumentRow["contentType"];
  byte_size: number;
  uploaded_by: string;
  storage_provider: DocumentRow["provider"];
  upload_state: DocumentRow["state"];
  drive_file_id: string | null;
  content_sha256: string | null;
  created_at: string;
};

type SessionDbRow = {
  document_id: string;
  drive_session_url: string;
  declared_bytes: number;
  declared_sha256: string;
  received_bytes: number;
  created_by: string;
  expires_at: string;
};

const toSession = (row: SessionDbRow): SessionRow => ({
  documentId: row.document_id,
  sessionUrl: row.drive_session_url,
  declaredBytes: Number(row.declared_bytes),
  declaredSha256: row.declared_sha256,
  received: Number(row.received_bytes),
  createdBy: row.created_by,
  expiresAt: row.expires_at,
});

/** The service-role store. Every caller has already checked the permission and the class. */
export function supabaseUploadStore(): UploadStore {
  const db = createAdminClient();
  const fail = (what: string, error: { message: string }) => {
    throw new Error(`Could not ${what}: ${error.message}`);
  };

  return {
    async findDocument(id) {
      const { data, error } = await db
        .from("student_documents")
        .select(
          "id, student_id, session_label, kind, content_type, byte_size, uploaded_by, storage_provider, " +
            "upload_state, drive_file_id, content_sha256, created_at",
        )
        .eq("id", id)
        .maybeSingle<DocumentDbRow>();
      if (error) fail("read the document", error);
      if (!data) return null;
      return {
        id: data.id,
        studentId: data.student_id,
        sessionLabel: data.session_label,
        kind: data.kind,
        contentType: data.content_type,
        byteSize: Number(data.byte_size),
        uploadedBy: data.uploaded_by,
        provider: data.storage_provider,
        state: data.upload_state,
        driveFileId: data.drive_file_id,
        sha256: data.content_sha256,
        createdAt: data.created_at,
      };
    },

    async insertDocument(input: UploadRequest & { sessionLabel: string; uploadedBy: string }) {
      const { error } = await db.from("student_documents").insert({
        id: input.documentId,
        client_request_id: input.documentId,
        session_label: input.sessionLabel,
        student_id: input.studentId,
        kind: input.kind,
        storage_provider: "gdrive",
        storage_path: `gdrive/${input.documentId}`,
        upload_state: "uploading",
        file_name: input.fileName,
        content_type: input.contentType,
        byte_size: input.byteSize,
        note: input.note,
        uploaded_by: input.uploadedBy,
      });
      if (!error) return "inserted";
      if (error.code === "23505") return "exists";
      return fail("start the document", error);
    },

    async discardDocument(id) {
      const { error } = await db
        .from("student_documents")
        .delete()
        .eq("id", id)
        .eq("storage_provider", "gdrive")
        .eq("upload_state", "uploading")
        .is("drive_file_id", null);
      if (error) fail("forget the unstarted upload", error);
    },

    async markFailed(id, driveFileId) {
      const { error } = await db
        .from("student_documents")
        .update({ upload_state: "failed", drive_file_id: driveFileId })
        .eq("id", id)
        .eq("upload_state", "uploading");
      if (error) fail("mark the upload failed", error);
    },

    async markStored(id, input) {
      const { data, error } = await db
        .from("student_documents")
        .update({ upload_state: "stored", drive_file_id: input.driveFileId, content_sha256: input.sha256 })
        .eq("id", id)
        .eq("upload_state", "uploading")
        .select("id");
      if (error) fail("record the document", error);
      return (data ?? []).length > 0;
    },

    async findSession(documentId) {
      const { data, error } = await db
        .from("document_upload_sessions")
        .select("document_id, drive_session_url, declared_bytes, declared_sha256, received_bytes, created_by, expires_at")
        .eq("document_id", documentId)
        .maybeSingle<SessionDbRow>();
      if (error) fail("read the upload", error);
      return data ? toSession(data) : null;
    },

    async insertSession(row) {
      const { error } = await db.from("document_upload_sessions").insert({
        document_id: row.documentId,
        drive_session_url: row.sessionUrl,
        declared_bytes: row.declaredBytes,
        declared_sha256: row.declaredSha256,
        received_bytes: row.received,
        created_by: row.createdBy,
        expires_at: row.expiresAt,
      });
      if (error) fail("keep the upload", error);
    },

    async advanceSession(documentId, from, to) {
      const { data, error } = await db
        .from("document_upload_sessions")
        .update({ received_bytes: to, updated_at: new Date().toISOString() })
        .eq("document_id", documentId)
        .eq("received_bytes", from)
        .select("document_id");
      if (error) fail("record the upload's progress", error);
      return (data ?? []).length > 0;
    },

    async setReceived(documentId, received) {
      const { error } = await db
        .from("document_upload_sessions")
        .update({ received_bytes: received, updated_at: new Date().toISOString() })
        .eq("document_id", documentId);
      if (error) fail("record the upload's progress", error);
    },

    async deleteSession(documentId) {
      const { error } = await db.from("document_upload_sessions").delete().eq("document_id", documentId);
      if (error) fail("close the upload", error);
    },

    async folderFor(sessionLabel) {
      const { data, error } = await db
        .from("drive_folders")
        .select("folder_id")
        .eq("session_label", sessionLabel)
        .maybeSingle<{ folder_id: string }>();
      if (error) fail("find the session's folder", error);
      return data?.folder_id ?? null;
    },

    async claimFolder(sessionLabel, folderId) {
      const { error } = await db
        .from("drive_folders")
        .upsert({ session_label: sessionLabel, folder_id: folderId }, { onConflict: "session_label", ignoreDuplicates: true });
      if (error) fail("record the session's folder", error);
      const winner = await this.folderFor(sessionLabel);
      if (!winner) throw new Error("The session's folder vanished.");
      return winner;
    },
  };
}

/** Drive as the school's service account, or null when it is not set up. */
export function driveTarget(settings: FileStorageSettings, oidcToken: string | null): DriveTarget | null {
  if (!settings.driveConfigured || !settings.rootFolderId) return null;
  return { deps: driveDeps(settings, oidcToken), rootFolderId: settings.rootFolderId };
}

/**
 * Whether the person asking can see this child this session — the same rule
 * the document listing obeys, asked of the database as them. Admins and the
 * office read every class, including a child known only to the fee app and
 * not yet enrolled here (a TC is often exactly that child); a class teacher
 * reads her own.
 */
export async function studentInScope(
  staff: { role: StaffRole },
  studentId: string,
  sessionLabel: string,
): Promise<boolean> {
  if (readsEveryClass(staff)) return true;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("enrolments")
    .select("student_id")
    .eq("student_id", studentId)
    .eq("session_label", sessionLabel)
    .limit(1);
  if (error) return false;
  return (data ?? []).length > 0;
}

/** The bytes of one stored Drive document, streamed, honouring a Range. */
export async function driveDocumentBytes(
  driveFileId: string,
  range: string | null,
  oidcToken: string | null,
): Promise<Response> {
  const settings = await readStorageSettings();
  const target = driveTarget(settings, oidcToken);
  if (!target) throw new DriveError("forbidden", "Drive is not configured.");
  return downloadFile(target.deps, driveFileId, range);
}

/**
 * The nightly job (D-333): check the Drive path end to end, then copy every
 * Drive document without a sealed copy for the current recovery key.
 *
 * Throws — so the run is recorded as failed, where somebody reads it — when
 * Drive does not answer, when documents are waiting and no recovery key is
 * set, and when any copy failed or any file no longer matches its checksum.
 */
export async function runDocumentBackup(oidcToken: string | null): Promise<Record<string, number | string>> {
  const settings = await readStorageSettings();
  const db = createAdminClient();

  const waiting = async (fingerprint: string | null) => {
    let query = db
      .from("student_documents")
      .select("id", { count: "exact", head: true })
      .eq("storage_provider", "gdrive")
      .eq("upload_state", "stored");
    query = fingerprint
      ? query.or(`backed_up_at.is.null,backup_key_fingerprint.neq.${fingerprint}`)
      : query.is("backed_up_at", null);
    const { count, error } = await query;
    if (error) throw new Error(`Could not count documents waiting for a copy: ${error.message}`);
    return count ?? 0;
  };

  // Uploads nobody finished: the session (a write capability) goes, and the
  // row is marked failed so it never lists. Nothing was stored for them.
  const abandoned = await closeAbandonedUploads(db);

  const target = driveTarget(settings, oidcToken);
  if (!target) {
    const pending = await waiting(null);
    if (pending > 0) throw new Error(`${pending} Drive documents wait for a copy, and Drive is not configured.`);
    return { drive: "not configured", pending: 0, abandonedUploads: abandoned };
  }

  const check = await checkDriveStorage(oidcToken);
  if (!check.ok) throw new Error(`Drive check failed: ${check.detail}`);

  const verified = await reverifyDriveChecksums(db, target, Date.now() + 10_000);

  const publicKey = settings.recoveryPublicKey;
  const fingerprint = settings.recoveryKeyFingerprint;
  if (!publicKey || !fingerprint) {
    const pending = await waiting(null);
    if (pending > 0) throw new Error(`${pending} Drive documents have no independent copy: no recovery key is set.`);
    return { checked: "ok", copied: 0, pending: 0, abandonedUploads: abandoned, ...verified };
  }
  // The row is edited by hand (SQL in the runbook), so the app checks it too:
  // a weak key, or a fingerprint that is not this key's, makes no copy at all.
  const key = checkRecoveryPublicKey(publicKey);
  if (!key.ok || key.fingerprint !== fingerprint) {
    throw new Error("The recovery key in file_storage_settings is weaker than 3072 bits or its fingerprint does not match.");
  }

  const bucket = db.storage.from(DRIVE_BACKUPS_BUCKET);
  const summary = await backupDriveDocuments(
    {
      pending: async (limit) => {
        const { data, error } = await db
          .from("student_documents")
          .select("id, drive_file_id, content_sha256, content_version")
          .eq("storage_provider", "gdrive")
          .eq("upload_state", "stored")
          .or(`backed_up_at.is.null,backup_key_fingerprint.neq.${fingerprint}`)
          .order("created_at", { ascending: true })
          .limit(limit)
          .returns<{ id: string; drive_file_id: string; content_sha256: string; content_version: number }[]>();
        if (error) throw new Error(`Could not list documents waiting for a copy: ${error.message}`);
        return (data ?? []).map((row) => ({
          id: row.id,
          driveFileId: row.drive_file_id,
          sha256: row.content_sha256,
          version: row.content_version,
        }));
      },
      read: async (driveFileId) => new Uint8Array(await (await downloadFile(target.deps, driveFileId)).arrayBuffer()),
      write: async (path, sealed) => {
        const { error } = await bucket.upload(path, sealed, { contentType: "application/octet-stream", upsert: true });
        if (error) throw new Error(error.message);
      },
      record: async (id, copy) => {
        const { error } = await db
          .from("student_documents")
          .update({
            backup_path: copy.path,
            backup_sha256: copy.sealedSha256,
            backup_key_fingerprint: copy.keyFingerprint,
            backed_up_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) throw new Error(error.message);
      },
      now: Date.now,
    },
    { recoveryPublicKey: publicKey, keyFingerprint: fingerprint, budgetMs: 40_000 },
  );

  if (summary.checksumMismatch > 0 || summary.failed > 0 || verified.driveChanged > 0) {
    throw new Error(
      `Copied ${summary.copied}. ${summary.checksumMismatch} no longer match their recorded checksum; ` +
        `${summary.failed} could not be copied; ${verified.driveChanged} changed in Drive since upload. ` +
        "Nothing was overwritten.",
    );
  }
  return {
    checked: "ok",
    driveReadMs: check.millis?.read ?? 0,
    driveWriteMs: check.millis?.write ?? 0,
    copied: summary.copied,
    leftForTomorrow: summary.stoppedForTime,
    abandonedUploads: abandoned,
    driveVerified: verified.driveVerified,
  };
}

/** Close uploads past their expiry, and rows that never got a session. */
async function closeAbandonedUploads(db: ReturnType<typeof createAdminClient>): Promise<number> {
  const now = new Date().toISOString();
  const { data: expired, error } = await db
    .from("document_upload_sessions")
    .delete()
    .lt("expires_at", now)
    .select("document_id")
    .returns<{ document_id: string }[]>();
  if (error) throw new Error(`Could not close expired uploads: ${error.message}`);
  const ids = (expired ?? []).map((row) => row.document_id);

  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: stale, error: staleError } = await db
    .from("student_documents")
    .select("id")
    .eq("storage_provider", "gdrive")
    .eq("upload_state", "uploading")
    .lt("created_at", dayAgo)
    .returns<{ id: string }[]>();
  if (staleError) throw new Error(`Could not find stale uploads: ${staleError.message}`);
  const all = [...new Set([...ids, ...(stale ?? []).map((row) => row.id)])];
  for (const chunk of chunkArray(all, IN_FILTER_CHUNK_SIZE)) {
    await db.from("document_upload_sessions").delete().in("document_id", chunk);
    const { error: markError } = await db
      .from("student_documents")
      .update({ upload_state: "failed" })
      .in("id", chunk)
      .eq("upload_state", "uploading");
    if (markError) throw new Error(`Could not close stale uploads: ${markError.message}`);
  }
  return all.length;
}

/**
 * Confirm Drive still holds the bytes each document was stored with, oldest
 * check first, from Drive's metadata alone (no download). A Shared Drive
 * manager can upload a new revision over a file; this is how that is noticed.
 */
async function reverifyDriveChecksums(
  db: ReturnType<typeof createAdminClient>,
  target: DriveTarget,
  deadline: number,
): Promise<{ driveVerified: number; driveChanged: number }> {
  const { data, error } = await db
    .from("student_documents")
    .select("id, drive_file_id, content_sha256, byte_size")
    .eq("storage_provider", "gdrive")
    .eq("upload_state", "stored")
    .order("drive_verified_at", { ascending: true, nullsFirst: true })
    .limit(100)
    .returns<{ id: string; drive_file_id: string; content_sha256: string; byte_size: number }[]>();
  if (error) throw new Error(`Could not list documents to verify: ${error.message}`);

  let driveVerified = 0;
  let driveChanged = 0;
  for (const row of data ?? []) {
    if (Date.now() > deadline) break;
    const file = await getFile(target.deps, row.drive_file_id).catch(() => null);
    if (!file || file.trashed) {
      driveChanged += 1;
      continue;
    }
    if (!file.sha256Checksum) continue;
    if (file.sha256Checksum.toLowerCase() !== row.content_sha256 || Number(file.size) !== Number(row.byte_size)) {
      driveChanged += 1;
      continue;
    }
    await db.from("student_documents").update({ drive_verified_at: new Date().toISOString() }).eq("id", row.id);
    driveVerified += 1;
  }
  return { driveVerified, driveChanged };
}

export type DriveCheck = {
  ok: boolean;
  detail: string;
  sharedDriveName: string | null;
  millis: { token: number; write: number; read: number } | null;
};

const HEALTH_FILE = "vppsone-health-check.txt";

/**
 * Prove the whole path works: token, access to the root folder (and that it
 * is in the configured Shared Drive), a write and a read back. Writes one
 * small text file once and edits it after that — a writer may edit, and
 * nothing is deleted.
 *
 * The account may be a writer on the root folder only, not a member of the
 * drive (D-333: the folder of the school's existing "Share" drive), so the
 * drive itself is never asked for.
 */
export async function checkDriveStorage(oidcToken: string | null): Promise<DriveCheck> {
  const settings = await readStorageSettings();
  const target = driveTarget(settings, oidcToken);
  let result: DriveCheck;

  if (!target || !settings.sharedDriveId) {
    result = { ok: false, detail: "Drive is not configured.", sharedDriveName: null, millis: null };
  } else {
    try {
      const started = Date.now();
      const root = await getFile(target.deps, target.rootFolderId);
      const afterToken = Date.now();
      if (root.driveId !== settings.sharedDriveId || root.trashed) {
        throw new DriveError("not_found", "The root folder is not in the configured Shared Drive.");
      }

      const stamp = new TextEncoder().encode(`VPPS One storage check ${new Date().toISOString()}\n`);
      const existing = await findChild(target.deps, { parentId: target.rootFolderId, name: HEALTH_FILE });
      const written = existing
        ? await replaceContent(target.deps, existing.id, { contentType: "text/plain", bytes: stamp })
        : await createSmallFile(target.deps, {
            name: HEALTH_FILE,
            parentId: target.rootFolderId,
            contentType: "text/plain",
            bytes: stamp,
          });
      const afterWrite = Date.now();

      const back = new Uint8Array(await (await downloadFile(target.deps, written.id)).arrayBuffer());
      const afterRead = Date.now();
      const same = back.byteLength === stamp.byteLength && back.every((byte, index) => byte === stamp[index]);

      result = {
        ok: same,
        detail: same ? `Read back what was written in ${root.name ?? "the root folder"}.` : "The file read back differs from what was written.",
        sharedDriveName: root.name ?? null,
        millis: { token: afterToken - started, write: afterWrite - afterToken, read: afterRead - afterWrite },
      };
    } catch (error) {
      const detail =
        error instanceof GoogleAuthError || error instanceof DriveError
          ? `${error.name} ${error.kind}: ${error.message}`
          : "Unexpected failure.";
      result = { ok: false, detail: detail.slice(0, 300), sharedDriveName: null, millis: null };
    }
  }

  await createAdminClient()
    .from("file_storage_settings")
    .update({
      last_check_at: new Date().toISOString(),
      last_check_ok: result.ok,
      last_check_detail: result.detail.slice(0, 300),
    })
    .eq("id", 1);

  return result;
}
