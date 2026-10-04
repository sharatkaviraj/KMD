"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { assertPermission } from "@/platform/auth/current-staff";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import {
  applySamparkImport,
  childByAdmissionNo,
  resolveSamparkRow,
  stageSamparkImport,
} from "@/modules/collection/data/sampark-import-repo";
import { idleCollectionState, type CollectionState } from "@/modules/collection/domain/form-state";
import { applySentence } from "@/modules/collection/domain/sampark-import";

const failure = (message: CollectionState["message"]): CollectionState => ({ ...idleCollectionState, status: "error", message });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Upload SamPark's Students workbook (P10b). Staging reads and resolves the
 * file and writes nothing to any child's record; the same file again opens
 * the batch it already made.
 */
export async function stageSamparkImportAction(_previous: CollectionState, formData: FormData): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return failure(m.noSessionFound);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return failure(ms.importChooseFile);
  if (!/\.(xlsx|xls|csv)$/i.test(file.name)) return failure(ms.importWrongType);

  let staged;
  try {
    staged = await stageSamparkImport({
      fileName: file.name,
      bytes: await file.arrayBuffer(),
      sessionLabel,
      actorStaffId: actor.id,
    });
  } catch {
    return failure(m.notSaved);
  }
  if (!staged.ok) {
    return failure(
      staged.reason === "too_large"
        ? ms.importTooLarge
        : staged.reason === "no_identity"
          ? ms.importNoIdentity
          : staged.reason === "too_many_rows"
            ? ms.importTooManyRows
            : staged.reason === "empty"
              ? ms.importEmpty
              : ms.importUnreadable,
    );
  }
  revalidatePath("/collection/import");
  redirect(`/collection/import?batch=${staged.batchId}`);
}

/** Apply every matched row of a batch, as one command. */
export async function applySamparkImportAction(_previous: CollectionState, formData: FormData): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");
  const batchId = (formData.get("batchId") ?? "").toString();
  const commandId = (formData.get("commandId") ?? "").toString();
  if (!UUID.test(batchId) || !UUID.test(commandId)) return failure(m.notSaved);

  const receipt = await applySamparkImport({ commandId, batchId, actorStaffId: actor.id });
  if (!receipt.ok) return failure(receipt.reason === "not_permitted" ? m.accessDenied : m.notSaved);

  revalidatePath("/collection/import");
  return { ...idleCollectionState, status: "saved", message: applySentence(receipt) };
}

/**
 * Decide one row of the queue: a child the office chose — one of the
 * candidates, or by the fee record's SR number — or nobody, with a reason.
 */
export async function resolveSamparkRowAction(_previous: CollectionState, formData: FormData): Promise<CollectionState> {
  const actor = await assertPermission("collection:manage");
  const batchId = (formData.get("batchId") ?? "").toString();
  const commandId = (formData.get("commandId") ?? "").toString();
  const rowNo = Number((formData.get("rowNo") ?? "").toString());
  const choice = (formData.get("choice") ?? "").toString();
  const admissionNo = (formData.get("admissionNo") ?? "").toString().trim();
  const note = (formData.get("note") ?? "").toString().trim().slice(0, 300) || null;
  if (!UUID.test(batchId) || !UUID.test(commandId) || !Number.isInteger(rowNo)) return failure(m.notSaved);

  let studentId: string | null = null;
  const dismiss = choice === "dismiss";
  if (dismiss) {
    if (!note) return failure(ms.importDismissNeedsReason);
  } else if (choice === "admission") {
    if (!admissionNo) return failure(ms.importNeedsChild);
    const found = await childByAdmissionNo(admissionNo);
    if (found === "none") return failure(ms.importNoSuchSr);
    if (found === "several") return failure(ms.importSeveralSr);
    studentId = found.id;
  } else if (UUID.test(choice)) {
    studentId = choice;
  } else {
    return failure(ms.importNeedsChild);
  }

  const receipt = await resolveSamparkRow({ commandId, batchId, rowNo, studentId, dismiss, note, actorStaffId: actor.id });
  if (!receipt.ok) {
    return failure(
      receipt.reason === "not_permitted"
        ? m.accessDenied
        : receipt.reason === "already_decided"
          ? ms.importAlreadyDecided
          : receipt.reason === "no_such_child"
            ? ms.importNoSuchSr
            : m.notSaved,
    );
  }

  revalidatePath("/collection/import");
  if (receipt.resolution === "dismissed") return { ...idleCollectionState, status: "saved", message: ms.importDismissed };
  // Chosen, but the mapping disagreed with an earlier one: it went back to
  // the queue with both children named.
  if (!receipt.applied && receipt.reason) return failure(ms.importConflict);
  return { ...idleCollectionState, status: "saved", message: ms.importResolved };
}
