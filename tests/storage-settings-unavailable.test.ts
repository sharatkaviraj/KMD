import { beforeEach, expect, it, vi } from "vitest";

/**
 * The owner's rule (D-334): new files go to the one central store. A settings
 * row that cannot be read must stop uploads visibly, never send them quietly
 * to the bucket.
 */

const mock = vi.hoisted(() => ({ result: { data: null as unknown, error: null as { message: string } | null } }));

vi.mock("server-only", () => ({}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => mock.result };
      return query;
    },
  }),
}));

import {
  StorageSettingsUnavailable,
  documentUploadMode,
  readStorageSettings,
} from "@/modules/collection/data/storage-settings";

const row = {
  documents_provider: "gdrive",
  drive_pilot_staff_ids: [],
  shared_drive_id: "0ASyntheticSharedDrive00",
  root_folder_id: "1SyntheticRootFolder0000",
  google_project_number: "123456789012",
  workload_pool_id: "vercel",
  workload_provider_id: "vppsone-production",
  service_account_email: "vppsone-drive@synthetic-project.iam.gserviceaccount.com",
  recovery_public_key: null,
  recovery_key_fingerprint: null,
  last_check_at: null,
  last_check_ok: null,
  last_check_detail: null,
  bucket_migration_approved_at: null,
};

beforeEach(() => {
  mock.result = { data: row, error: null };
});

it("sends everybody to Drive once the provider is Drive", async () => {
  expect(await documentUploadMode("any-office-account")).toBe("gdrive");
});

it("refuses to answer, rather than answer 'bucket', when the row cannot be read", async () => {
  mock.result = { data: null, error: { message: "synthetic outage" } };
  await expect(readStorageSettings()).rejects.toBeInstanceOf(StorageSettingsUnavailable);
  expect(await documentUploadMode("any-office-account")).toBe("unavailable");
});

it("treats a missing row the same way", async () => {
  mock.result = { data: null, error: null };
  expect(await documentUploadMode("any-office-account")).toBe("unavailable");
});
