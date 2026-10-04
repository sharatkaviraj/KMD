"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { assertPermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { createArchive, manifestLink, runRestoreDrill } from "@/modules/archives/data/archive-repo";
import { idleCollectionState, type CollectionState } from "@/modules/collection/domain/form-state";

const failure = (message: CollectionState["message"]): CollectionState => ({ ...idleCollectionState, status: "error", message });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Build an archive of every VPPS One table and every document and photograph (P11). */
export async function buildArchiveAction(_previous: CollectionState, formData: FormData): Promise<CollectionState> {
  const actor = await assertPermission("jobs:run");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);
  const label = (formData.get("label") ?? "").toString().trim().slice(0, 120);
  if (!label) return failure(ms.archiveNeedsLabel);

  const result = await createArchive({ label, sessionLabel, actorStaffId: actor.id });
  revalidatePath("/archives");
  return result.ok ? { ...idleCollectionState, status: "saved", message: ms.archiveBuilt } : failure(ms.archiveFailed);
}

/** Prove an archive restores: re-hash every file and reload every table into scratch. */
export async function runDrillAction(_previous: CollectionState, formData: FormData): Promise<CollectionState> {
  const actor = await assertPermission("jobs:run");
  const archiveId = (formData.get("archiveId") ?? "").toString();
  if (!UUID.test(archiveId)) return failure(m.notSaved);

  const report = await runRestoreDrill({ archiveId, actorStaffId: actor.id });
  revalidatePath("/archives");
  if (!report) return failure(ms.archiveNotReady);
  return report.ok ? { ...idleCollectionState, status: "saved", message: ms.drillPassed } : failure(ms.drillFailed);
}

/** A short-lived download link for an archive's manifest. */
export async function manifestLinkAction(archiveId: string): Promise<string | null> {
  await assertPermission("jobs:run");
  if (!UUID.test(archiveId)) return null;
  return manifestLink(archiveId);
}
