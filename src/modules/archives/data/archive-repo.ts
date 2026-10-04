import "server-only";

import { assertPermission } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import {
  ARCHIVES_BUCKET,
  buildArchive,
  drillArchive,
  type DrillReport,
  type Manifest,
} from "@/modules/archives/data/archive-engine";

/**
 * The archive catalogue (P11, D-238): build, list, drill and hand out the
 * manifest. An administrator's (`jobs:run`), checked here before any byte is
 * read or any link minted, whatever the screen above believed.
 */

export type ArchiveSummary = {
  id: string;
  label: string;
  sessionLabel: string;
  status: "building" | "ready" | "failed";
  tableCount: number | null;
  rowCount: number | null;
  objectCount: number | null;
  totalBytes: number | null;
  schemaVersion: string | null;
  appCommit: string | null;
  error: string | null;
  createdAt: string;
  createdByName: string | null;
  lastDrill: { ok: boolean; ranAt: string; report: DrillReport } | null;
};

type ArchiveRow = {
  id: string;
  label: string;
  session_label: string;
  status: ArchiveSummary["status"];
  manifest: Manifest | null;
  table_count: number | null;
  row_count: number | null;
  object_count: number | null;
  total_bytes: number | null;
  error: string | null;
  created_at: string;
  staff_profiles: { display_name: string } | null;
};

export async function listArchives(): Promise<ArchiveSummary[]> {
  await assertPermission("jobs:run");
  const admin = createAdminClient();
  const [{ data: archives, error }, { data: drills }] = await Promise.all([
    admin
      .from("archives")
      .select("id, label, session_label, status, manifest, table_count, row_count, object_count, total_bytes, error, created_at, staff_profiles(display_name)")
      .order("created_at", { ascending: false })
      .limit(30)
      .returns<ArchiveRow[]>(),
    admin
      .from("restore_drills")
      .select("archive_id, ok, ran_at, report")
      .order("ran_at", { ascending: false })
      .limit(200)
      .returns<{ archive_id: string; ok: boolean; ran_at: string; report: DrillReport }[]>(),
  ]);
  if (error) throw new Error(`Could not read the archives: ${error.message}`);
  const lastDrill = new Map<string, { ok: boolean; ranAt: string; report: DrillReport }>();
  for (const drill of drills ?? []) {
    if (!lastDrill.has(drill.archive_id)) lastDrill.set(drill.archive_id, { ok: drill.ok, ranAt: drill.ran_at, report: drill.report });
  }
  return archives.map((row) => ({
    id: row.id,
    label: row.label,
    sessionLabel: row.session_label,
    status: row.status,
    tableCount: row.table_count,
    rowCount: row.row_count,
    objectCount: row.object_count,
    totalBytes: row.total_bytes,
    schemaVersion: row.manifest?.schemaVersion ?? null,
    appCommit: row.manifest?.appCommit ?? null,
    error: row.error,
    createdAt: row.created_at,
    createdByName: row.staff_profiles?.display_name ?? null,
    lastDrill: lastDrill.get(row.id) ?? null,
  }));
}

/** Build one archive. The catalogue row is written first, so a failure is recorded, not lost. */
export async function createArchive(input: { label: string; sessionLabel: string; actorStaffId: string }): Promise<{ id: string; ok: boolean }> {
  await assertPermission("jobs:run");
  const admin = createAdminClient();
  const { data: row, error } = await admin
    .from("archives")
    .insert({ label: input.label, session_label: input.sessionLabel, created_by: input.actorStaffId })
    .select("id")
    .single<{ id: string }>();
  if (error) throw new Error(`Could not start the archive: ${error.message}`);

  try {
    const manifest = await buildArchive(admin, {
      archiveId: row.id,
      label: input.label,
      sessionLabel: input.sessionLabel,
      appCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    });
    await admin
      .from("archives")
      .update({
        status: "ready",
        manifest,
        table_count: manifest.totals.tables,
        row_count: manifest.totals.rows,
        object_count: manifest.totals.objects,
        total_bytes: manifest.totals.bytes,
        finished_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return { id: row.id, ok: true };
  } catch (failure) {
    await admin
      .from("archives")
      .update({ status: "failed", error: String(failure instanceof Error ? failure.message : failure).slice(0, 500), finished_at: new Date().toISOString() })
      .eq("id", row.id);
    return { id: row.id, ok: false };
  }
}

/** Run a restore drill against one ready archive and keep what it found. */
export async function runRestoreDrill(input: { archiveId: string; actorStaffId: string }): Promise<DrillReport | null> {
  await assertPermission("jobs:run");
  const admin = createAdminClient();
  const { data: archive } = await admin
    .from("archives")
    .select("manifest, status")
    .eq("id", input.archiveId)
    .maybeSingle<{ manifest: Manifest | null; status: string }>();
  if (!archive?.manifest || archive.status !== "ready") return null;

  const drillId = crypto.randomUUID();
  const report = await drillArchive(admin, archive.manifest, drillId);
  await admin.from("restore_drills").insert({ id: drillId, archive_id: input.archiveId, ok: report.ok, report, ran_by: input.actorStaffId });
  return report;
}

/** A short-lived link to an archive's manifest, after the check. */
export async function manifestLink(archiveId: string): Promise<string | null> {
  await assertPermission("jobs:run");
  const { data } = await createAdminClient().storage.from(ARCHIVES_BUCKET).createSignedUrl(`${archiveId}/manifest.json`, 120, {
    download: `archive-${archiveId}-manifest.json`,
  });
  return data?.signedUrl ?? null;
}
