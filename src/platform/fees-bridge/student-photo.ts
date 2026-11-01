/** Same-origin, authenticated photo route. Storage paths and tokens never enter HTML. */
export function bridgeStudentPhotoHref(studentId: string, sessionLabel: string, variant: "thumb" | "full" = "thumb"): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(studentId)
    || !/^\d{4}-\d{2}$/.test(sessionLabel) || !["thumb", "full"].includes(variant)) {
    throw new Error("invalid_photo_identity");
  }
  return `/api/fees-bridge/students/${studentId}/photo?${new URLSearchParams({ session: sessionLabel, variant })}`;
}
