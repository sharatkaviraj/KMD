import "server-only";

import { createHmac } from "node:crypto";

import { getOptionalEnvVar } from "@/platform/env";
import { photoLinkHref, type PhotoLinkSize } from "../domain/photo-link";

/**
 * The key behind One's photo links (`domain/photo-link.ts`). Derived from the
 * service-role key with a label, so no new setting is needed and the key
 * itself is never the service-role key: a photo token cannot be turned back
 * into anything that opens the database. Rotating the service-role key
 * retires every photo link at once, which is the right way round.
 */
export function photoLinkSecret(): string {
  const root = getOptionalEnvVar("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!root) return "";
  return createHmac("sha256", root).update("vppsone:student-photo-links:v1").digest("hex");
}

/** A link to this photo row, after the caller has checked the reader may see it. */
export function studentPhotoLink(studentId: string, photoId: string, size: PhotoLinkSize = "list"): string | null {
  const secret = photoLinkSecret();
  if (!secret) return null;
  try {
    return photoLinkHref(secret, studentId, photoId, size);
  } catch {
    return null;
  }
}
