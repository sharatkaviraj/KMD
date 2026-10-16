import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createAdminClient } from "@/platform/supabase/admin";
import { PHOTO_MAX_BYTES, PHOTO_MAX_SIDE } from "../domain/photo-placement";

export const PHOTOS_BUCKET = "vppsone-photos";
export type PreparedPhoto = { bytes: Uint8Array; sha256: string; width: number; height: number; contentType: "image/jpeg" };
export type PhotoFailure = "wrong_type" | "too_large" | "id_reused" | "unavailable" | "unknown";
export const photoHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Decode every pixel, discard metadata, enforce both the side and byte limits. */
export async function preparePhoto(bytes: ArrayBuffer): Promise<PreparedPhoto | PhotoFailure> {
  if (!bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024) return "too_large";
  try {
    const input = Buffer.from(bytes);
    const metadata = await sharp(input, { limitInputPixels: 40_000_000, failOn: "warning" }).metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format) || (metadata.pages ?? 1) > 1) return "wrong_type";
    for (const quality of [78, 68, 58, 48, 40]) {
      const result = await sharp(input, { limitInputPixels: 40_000_000, failOn: "warning" }).rotate()
        .resize(PHOTO_MAX_SIDE, PHOTO_MAX_SIDE, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality }).toBuffer({ resolveWithObject: true });
      if (result.data.byteLength <= PHOTO_MAX_BYTES) return { bytes: result.data, sha256: photoHash(result.data), width: result.info.width, height: result.info.height, contentType: "image/jpeg" };
    }
    return "too_large";
  } catch { return "wrong_type"; }
}

/** Immutable object identity. Lost responses never cause deletion or overwrite. */
export async function stagePhoto(path: string, photo: PreparedPhoto): Promise<PhotoFailure | null> {
  const bucket = createAdminClient().storage.from(PHOTOS_BUCKET);
  try {
    const result = await bucket.upload(path, photo.bytes, { contentType: photo.contentType, upsert: false });
    if (!result.error) return null;
    if (!/exists|duplicate/i.test(result.error.message)) return "unknown";
    const existing = await bucket.download(path);
    if (existing.error || !existing.data) return "unknown";
    return photoHash(new Uint8Array(await existing.data.arrayBuffer())) === photo.sha256 ? null : "id_reused";
  } catch { return "unknown"; }
}
