"use server";

import { revalidatePath } from "next/cache";

import { m } from "@/messages";
import { ms } from "@/messages/setup";
import { assertPermission } from "@/platform/auth/current-staff";
import { assertNotPreviewing } from "@/vx/view-as";
import type { Localized } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { placePhoto } from "@/modules/collection/data/photos-repo";

export type PhotoResult = { ok: boolean; message: Localized; photoId?: string; reason?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Place one photograph (P10c). Called once per file — by the camera, a single
 * file, or each file of a folder in turn — so a large folder shows progress
 * and one bad file does not lose the rest.
 */
export async function placePhotoAction(formData: FormData): Promise<PhotoResult> {
  const actor = await assertPermission("collection:manage");
  await assertNotPreviewing();
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return { ok: false, message: m.noSessionFound };

  const commandId = (formData.get("commandId") ?? "").toString();
  const studentId = (formData.get("studentId") ?? "").toString();
  const expected = (formData.get("expectedCurrent") ?? "").toString();
  const source = (formData.get("source") ?? "").toString();
  const sourceRef = (formData.get("sourceRef") ?? "").toString().slice(0, 200) || null;
  const width = Number(formData.get("width")) || null;
  const height = Number(formData.get("height")) || null;
  const file = formData.get("photo");
  if (!UUID.test(commandId) || !UUID.test(studentId) || (expected !== "" && !UUID.test(expected))) {
    return { ok: false, message: m.notSaved };
  }
  if (source !== "camera" && source !== "file" && source !== "folder") return { ok: false, message: m.notSaved };
  if (!(file instanceof Blob)) return { ok: false, message: ms.photoChoose };

  const receipt = await placePhoto({
    commandId,
    studentId,
    sessionLabel,
    bytes: await file.arrayBuffer(),
    contentType: file.type,
    width,
    height,
    source,
    sourceRef,
    expectedCurrent: expected === "" ? null : expected,
    actorStaffId: actor.id,
  });

  if (!receipt.ok) {
    return {
      ok: false,
      reason: receipt.reason,
      message:
        receipt.reason === "stale"
          ? ms.photoStale
          : receipt.reason === "too_large"
            ? ms.photoTooLarge
            : receipt.reason === "wrong_type"
              ? ms.photoWrongType
              : receipt.reason === "not_permitted"
                ? m.accessDenied
                : m.notSaved,
    };
  }
  revalidatePath("/", "layout");
  return { ok: true, message: receipt.replaced ? ms.photoReplaced : ms.photoPlaced, photoId: receipt.photoId };
}
