import "server-only";

import { createHash } from "node:crypto";

import { assertPermission } from "@/platform/auth/current-staff";
import { FEE_SCHEMA, getVppsOneEnvironment } from "@/platform/env";
import { chunkArray } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { preparePhoto, stagePhoto } from "./photo-storage";

/**
 * Children's photographs (P10c, S-11, D-236).
 *
 * The bytes are in the private `vppsone-photos` bucket and are only ever
 * reached through a short-lived signed URL minted here, after a permission
 * check. A photograph is placed by `vppsone.place_student_photo`, which keeps
 * the one it replaces; nothing here deletes a placed photograph.
 */

export const PHOTOS_BUCKET = "vppsone-photos";
const SIGNED_SECONDS = 300;

export type RosterChild = {
  studentId: string;
  name: string;
  srNo: string | null;
  externalId: string | null;
  photoId: string | null;
  photoUrl: string | null;
  uploadedAt: string | null;
};

/** Read one current private portrait; the collection permission is unchanged. */
export async function studentProfilePhoto(studentId: string): Promise<string | null> {
  await assertPermission("collection:manage");
  const admin = createAdminClient();
  const { data, error } = await admin.from("student_photos")
    .select("storage_path").eq("student_id", studentId).is("replaced_at", null)
    .maybeSingle<{ storage_path: string }>();
  if (error) throw new Error("Could not read the student's photograph.");
  if (!data) return null;
  const signed = await admin.storage.from(PHOTOS_BUCKET).createSignedUrl(data.storage_path, SIGNED_SECONDS);
  if (signed.error) throw new Error("Could not open the student's photograph.");
  return signed.data.signedUrl;
}

/** A class's children, with their current photograph — the missing-photo view's source. */
export async function classPhotoRoster(classId: string, sessionLabel: string): Promise<RosterChild[]> {
  await assertPermission("collection:manage");
  const admin = createAdminClient();

  const { data: roll } = await admin
    .from("enrolments")
    .select("student_id")
    .eq("class_id", classId)
    .eq("session_label", sessionLabel)
    .eq("status", "enrolled")
    .returns<{ student_id: string }[]>();
  const ids = (roll ?? []).map((row) => row.student_id);
  if (ids.length === 0) return [];

  const students: { id: string; full_name: string | null; admission_no: string | null }[] = [];
  const mappings: { student_id: string; external_id: string }[] = [];
  const photos: { id: string; student_id: string; storage_path: string; uploaded_at: string }[] = [];
  for (const chunk of chunkArray(ids, IN_FILTER_CHUNK_SIZE)) {
    const [s, x, p] = await Promise.all([
      admin.schema(FEE_SCHEMA).from("students").select("id, full_name, admission_no").in("id", chunk)
        .returns<{ id: string; full_name: string | null; admission_no: string | null }[]>(),
      admin.from("external_student_ids").select("student_id, external_id").eq("app_id", "sampark")
        .eq("source_environment", getVppsOneEnvironment()).in("student_id", chunk)
        .returns<{ student_id: string; external_id: string }[]>(),
      admin.from("student_photos").select("id, student_id, storage_path, uploaded_at").is("replaced_at", null).in("student_id", chunk)
        .returns<{ id: string; student_id: string; storage_path: string; uploaded_at: string }[]>(),
    ]);
    if (s.error || x.error || p.error) throw new Error("Could not read the class's photographs.");
    students.push(...(s.data ?? []));
    mappings.push(...(x.data ?? []));
    photos.push(...(p.data ?? []));
  }

  const urls = new Map<string, string>();
  if (photos.length > 0) {
    const { data: signed } = await admin.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(photos.map((photo) => photo.storage_path), SIGNED_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
    }
  }

  const studentOf = new Map(students.map((row) => [row.id, row]));
  const externalOf = new Map(mappings.map((row) => [row.student_id, row.external_id]));
  const photoOf = new Map(photos.map((row) => [row.student_id, row]));

  return ids
    .map((id) => {
      const photo = photoOf.get(id);
      return {
        studentId: id,
        name: studentOf.get(id)?.full_name ?? "—",
        srNo: studentOf.get(id)?.admission_no ?? null,
        externalId: externalOf.get(id) ?? null,
        photoId: photo?.id ?? null,
        photoUrl: photo ? (urls.get(photo.storage_path) ?? null) : null,
        uploadedAt: photo?.uploaded_at ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type PlaceReceipt =
  | { ok: true; photoId: string; replaced: string | null; replayed: boolean }
  | { ok: false; reason: "too_large" | "wrong_type" | "stale" | "not_permitted" | "no_such_child" | "id_reused" | "unavailable" | "unknown" };


/**
 * Store a photograph's bytes and place it, as one command.
 *
 * The object is named by the command id, so a retry after a lost answer finds
 * its own bytes already there and goes straight to the command — which
 * returns what it did the first time. Staged objects are retained, including
 * refusals: a transport failure must never delete a possibly committed image.
 */
export async function placePhoto(input: {
  commandId: string;
  studentId: string;
  sessionLabel: string;
  bytes: ArrayBuffer;
  contentType: string;
  width: number | null;
  height: number | null;
  source: "camera" | "file" | "folder";
  sourceRef: string | null;
  expectedCurrent: string | null;
  actorStaffId: string;
}): Promise<PlaceReceipt> {
  const photo = await preparePhoto(input.bytes);
  if (typeof photo === "string") return { ok: false, reason: photo };
  const admin = createAdminClient();
  const sha256 = photo.sha256;
  const path = `${input.studentId}/${input.commandId}.jpg`;
  const staged = await stagePhoto(path, photo);
  if (staged) return { ok: false, reason: staged };

  const payload = {
    student: input.studentId,
    sha256,
    expected: input.expectedCurrent ?? "",
    source: input.source, session: input.sessionLabel, sourceRef: input.sourceRef,
  };
  let outcome;
  try { outcome = await admin.rpc("place_student_photo", {
    p: {
      command_id: input.commandId,
      actor_staff_id: input.actorStaffId,
      student_id: input.studentId,
      session_label: input.sessionLabel,
      storage_path: path,
      content_type: photo.contentType,
      byte_size: photo.bytes.byteLength,
      sha256,
      width: photo.width,
      height: photo.height,
      source: input.source,
      source_ref: input.sourceRef,
      expected_current: input.expectedCurrent,
      payload_hash: createHash("sha256").update(JSON.stringify(payload)).digest("hex"),
    },
  });

  } catch { return { ok: false, reason: "unknown" }; }
  const { data, error } = outcome;
  const receipt = (error ? null : data) as { ok?: boolean; reason?: string; photo_id?: string; replaced?: string | null; replayed?: boolean } | null;
  if (!receipt?.ok) {
    // Keep staged bytes: even a lost refusal response may follow a committed retry.
    const reason = receipt?.reason;
    return {
      ok: false,
      reason:
        reason === "stale" || reason === "not_permitted" || reason === "no_such_child" || reason === "id_reused" ? reason : "unknown",
    };
  }
  return { ok: true, photoId: receipt.photo_id!, replaced: receipt.replaced ?? null, replayed: receipt.replayed === true };
}
