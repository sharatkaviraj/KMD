import "server-only";

import { after } from "next/server";

import {
  approveAllSafeImportRows,
  commitStudentImportBatch,
  createStudentImportBatch,
  getStudentImportPageData,
  runStudentImportDryRun,
} from "@/modules/imports/data/queries";
import { buildAutoColumnMapping, studentImportFieldDefinitions, validateColumnMapping } from "@/modules/imports/domain/mapping";
import type { ImportBatchDetail, StudentImportColumnMapping } from "@/modules/imports/domain/types";
import { requireStaffPermission } from "@/modules/fees/platform/session";
import { drainFinancialViewRefresh } from "@/modules/system-sync/data/financial-view-refresh";
import { publishOfficeSyncEvent } from "@/modules/system-sync/data/office-sync-events";
import { prepareDuesForStudentsAutomatically, revalidateCoreFinancePaths } from "@/modules/system-sync/domain/finance-sync";

/*
 * Student tools → Import, on top of the School Fees import module. Upload,
 * dry run, approve-safe and commit are that module's functions; the commit
 * loop, the office sync event and the after-commit dues preparation are
 * copied from `commitStudentImportBatchAction` so nothing the old screen did
 * is lost.
 */

const COMMIT_BUDGET_MS = 45_000;

export type ImportField = { key: string; label: string; required: boolean; description: string };

export const IMPORT_FIELDS: ImportField[] = studentImportFieldDefinitions.map((f) => ({ key: f.key, label: f.label, required: f.required, description: f.description }));

export async function uploadImport(file: File, sessionLabel: string | null) {
  await requireStaffPermission("students:write");
  return createStudentImportBatch(file, "add", sessionLabel);
}

export async function loadImportBatch(batchId: string | null): Promise<{ batch: ImportBatchDetail | null; recent: { id: string; filename: string; status: string; createdAt: string; importedRows: number; totalRows: number }[] }> {
  await requireStaffPermission("students:write");
  const page = await getStudentImportPageData(batchId, "add");
  return {
    batch: batchId ? page.selectedBatch : null,
    recent: page.recentBatches.slice(0, 5).map((b) => ({ id: b.id, filename: b.filename, status: b.status, createdAt: b.createdAt, importedRows: b.importedRows, totalRows: b.totalRows })),
  };
}

export function suggestedMapping(batch: ImportBatchDetail): StudentImportColumnMapping {
  const saved = batch.columnMapping ?? {};
  return Object.keys(saved).length > 0 ? saved : buildAutoColumnMapping(batch.detectedHeaders);
}

export async function checkImportRows(batchId: string, mapping: StudentImportColumnMapping, headers: readonly string[]) {
  await requireStaffPermission("students:write");
  const errors = validateColumnMapping(mapping, headers);
  if (errors.length > 0) return { ok: false as const, errors };
  await runStudentImportDryRun(batchId, mapping);
  return { ok: true as const, errors: [] as string[] };
}

export async function approveSafeRows(batchId: string) {
  await requireStaffPermission("students:write");
  await approveAllSafeImportRows(batchId);
}

export async function commitImport(batchId: string) {
  await requireStaffPermission("students:write");
  const deadline = Date.now() + COMMIT_BUDGET_MS;
  let result = await commitStudentImportBatch(batchId);
  while (result.remainingCount > 0 && Date.now() < deadline) result = await commitStudentImportBatch(batchId);

  await publishOfficeSyncEvent({
    sessionLabel: result.targetSessionLabel || "unknown",
    entityType: "import",
    entityId: batchId,
    action: "committed",
    affectedStudentIds: result.affectedStudentIds,
    metadata: {
      status: result.status,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      duesReadyCount: result.duesReadyCount,
      duesAttentionCount: result.duesAttentionCount,
    },
  });

  const ids = result.affectedStudentIds ?? [];
  if (ids.length > 0) {
    after(async () => {
      await prepareDuesForStudentsAutomatically({ studentIds: ids, reason: "Bulk import auto-prepare", useSystemClient: true });
      await drainFinancialViewRefresh();
    });
  }
  revalidateCoreFinancePaths(ids);
  return {
    createdCount: result.createdCount,
    importedCount: result.importedCount,
    failedCount: result.failedCount,
    skippedCount: result.skippedCount,
    remainingCount: result.remainingCount,
    ledgerSyncError: result.ledgerSyncError,
    targetSessionLabel: result.targetSessionLabel,
  };
}
