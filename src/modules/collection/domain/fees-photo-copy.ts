import { createHash } from "node:crypto";

/**
 * Teachers' photos for the real year (owner, 7 Nov 2026, D-511). The photos
 * are kept in Fees, which shares them through One only with office staff, so
 * One keeps its own copy for teachers, made when an admin taps "Refresh roster
 * now". These are the two rules that decide what is copied; the copying is
 * `data/fees-photo-copy.ts`.
 */

/** A child of the session in One's copy of the Fees roster, with Fees' photo path. */
export type FeesPhotoRow = { id: string; photo_path: string | null };
/** A child's current photo in One (`vppsone.student_photos`, not replaced). */
export type OnePhotoRow = { id: string; student_id: string; source: string; source_ref: string | null };
/** What to copy for one child: the Fees photo, and the One photo it replaces (if any). */
export type PendingCopy = { path: string; expected: string | null };

/**
 * The children whose Fees photo One should copy: those with no photo in One,
 * and those whose copy was made from an older Fees photo. A photo a person
 * placed in One (camera, file or folder) is never replaced from Fees.
 */
export function pendingFeesCopies(fees: readonly FeesPhotoRow[], one: readonly OnePhotoRow[]): Map<string, PendingCopy> {
  const current = new Map(one.map((row) => [row.student_id, row]));
  const out = new Map<string, PendingCopy>();
  for (const row of fees) {
    const path = row.photo_path?.trim();
    if (!path) continue;
    const mine = current.get(row.id);
    if (!mine) out.set(row.id, { path, expected: null });
    else if (mine.source === "fees" && mine.source_ref !== path) out.set(row.id, { path, expected: mine.id });
  }
  return out;
}

/**
 * One command id per child, Fees photo and the One photo it replaces. A retry
 * after a lost answer finds its own stored bytes and replays the command
 * instead of copying twice; a Fees photo that comes back after another one is
 * a new command, never a refused reuse of the old id.
 */
export function feesCopyCommandId(studentId: string, want: PendingCopy): string {
  const h = createHash("sha256").update(`fees-photo:${studentId}:${want.path}:${want.expected ?? ""}`).digest("hex");
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
