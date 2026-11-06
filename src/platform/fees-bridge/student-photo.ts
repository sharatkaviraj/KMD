/**
 * `list` is One's own: the Fees thumbnail, shrunk on One's server to the size
 * a list avatar draws (D-442). Fees serves the original for both of its
 * variants, up to 512 KB, and a Students page draws fifty of them at 46 px.
 */
export const STUDENT_PHOTO_VARIANTS = ["thumb", "full", "list"] as const;
export type StudentPhotoVariant = (typeof STUDENT_PHOTO_VARIANTS)[number];

/** Same-origin, authenticated photo route. Storage paths and tokens never enter HTML. */
export function bridgeStudentPhotoHref(studentId: string, sessionLabel: string, variant: StudentPhotoVariant = "thumb"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)
    || !/^\d{4}-\d{2}$/.test(sessionLabel) || !STUDENT_PHOTO_VARIANTS.includes(variant)) {
    throw new Error("invalid_photo_identity");
  }
  return `/api/fees-bridge/students/${studentId}/photo?${new URLSearchParams({ session: sessionLabel, variant })}`;
}
