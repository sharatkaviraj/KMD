import "server-only";

import { drivesUploadsFor } from "@/modules/collection/domain/document-files";
import { createAdminClient } from "@/platform/supabase/admin";
import { googleAccessToken, type WorkloadIdentityConfig } from "@/platform/google/workload-identity";
import type { DriveDeps } from "@/platform/google/drive";

/**
 * Where documents go, read from `vppsone.file_storage_settings` (D-333).
 *
 * A row rather than environment variables: these are identifiers, not
 * secrets, and the school's admin can switch Drive off from the database in
 * one statement without a redeploy.
 */

export type FileStorageSettings = {
  documentsProvider: "supabase" | "gdrive";
  drivePilotStaffIds: string[];
  sharedDriveId: string | null;
  rootFolderId: string | null;
  workload: WorkloadIdentityConfig | null;
  recoveryPublicKey: string | null;
  recoveryKeyFingerprint: string | null;
  lastCheckAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckDetail: string | null;
  driveConfigured: boolean;
};

type Row = {
  documents_provider: "supabase" | "gdrive";
  drive_pilot_staff_ids: string[] | null;
  shared_drive_id: string | null;
  root_folder_id: string | null;
  google_project_number: string | null;
  workload_pool_id: string | null;
  workload_provider_id: string | null;
  service_account_email: string | null;
  recovery_public_key: string | null;
  recovery_key_fingerprint: string | null;
  last_check_at: string | null;
  last_check_ok: boolean | null;
  last_check_detail: string | null;
};

/** Before the migration is applied, or if the read fails: Supabase, as before. */
const SUPABASE_ONLY: FileStorageSettings = {
  documentsProvider: "supabase",
  drivePilotStaffIds: [],
  sharedDriveId: null,
  rootFolderId: null,
  workload: null,
  recoveryPublicKey: null,
  recoveryKeyFingerprint: null,
  lastCheckAt: null,
  lastCheckOk: null,
  lastCheckDetail: null,
  driveConfigured: false,
};

export async function readStorageSettings(): Promise<FileStorageSettings> {
  const { data, error } = await createAdminClient()
    .from("file_storage_settings")
    .select(
      "documents_provider, drive_pilot_staff_ids, shared_drive_id, root_folder_id, google_project_number, " +
        "workload_pool_id, workload_provider_id, service_account_email, recovery_public_key, " +
        "recovery_key_fingerprint, last_check_at, last_check_ok, last_check_detail",
    )
    .eq("id", 1)
    .maybeSingle<Row>();

  if (error || !data) return SUPABASE_ONLY;

  const workload =
    data.google_project_number && data.workload_pool_id && data.workload_provider_id && data.service_account_email
      ? {
          projectNumber: data.google_project_number,
          poolId: data.workload_pool_id,
          providerId: data.workload_provider_id,
          serviceAccountEmail: data.service_account_email,
        }
      : null;

  return {
    documentsProvider: data.documents_provider,
    drivePilotStaffIds: data.drive_pilot_staff_ids ?? [],
    sharedDriveId: data.shared_drive_id,
    rootFolderId: data.root_folder_id,
    workload,
    recoveryPublicKey: data.recovery_public_key,
    recoveryKeyFingerprint: data.recovery_key_fingerprint,
    lastCheckAt: data.last_check_at,
    lastCheckOk: data.last_check_ok,
    lastCheckDetail: data.last_check_detail,
    driveConfigured: Boolean(workload && data.shared_drive_id && data.root_folder_id),
  };
}

/** Where this person's next document goes. */
export async function documentUploadMode(staffId: string): Promise<"supabase" | "gdrive"> {
  return drivesUploadsFor(await readStorageSettings(), staffId) ? "gdrive" : "supabase";
}

/** Drive calls authorised as the school's service account, for one request. */
export function driveDeps(settings: FileStorageSettings, oidcToken: string | null): DriveDeps {
  const workload = settings.workload;
  return {
    token: () => {
      if (!workload) return Promise.reject(new Error("Drive is not configured."));
      return googleAccessToken(workload, oidcToken);
    },
  };
}
