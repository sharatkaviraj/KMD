import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { getBridgeAiPhotos, getBridgeStudentPhoto } from "@/platform/fees-bridge/client";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { fetchInChunks, mapConcurrently } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";
import { feesCopyCommandId, pendingFeesCopies, type FeesPhotoRow, type OnePhotoRow, type PendingCopy } from "../domain/fees-photo-copy";
import { placePhoto } from "./photos-repo";

/**
 * One's copy of the Fees photos, for teachers (owner, 7 Nov 2026, D-511).
 *
 * An admin's "Refresh roster now" asks for it, a batch at a time, until every
 * child of the session whose Fees photo One does not hold yet has been copied.
 * The bytes come through the bridge as that admin (Fees checks the admin's own
 * grant), are made into One's standard photo (`preparePhoto`: at most 600 px,
 * JPEG, no metadata) and placed by the same command as a photo the office
 * places by hand, with `source = 'fees'`. Nothing is written to Fees.
 *
 * Many children go through Fees' photo pages (40 photos, about 2 MB, a page),
 * which is far gentler on the live Fees database than one request per child;
 * a handful (a photo changed since the last copy) are asked for one by one.
 */

export type FeesPhotoCopy = {
  /** Children on the roll of the session with a photo in Fees. */
  total: number;
  /** Children still to copy when this batch started. */
  pending: number;
  copied: number;
  failed: number;
  /** Pass back as `after` for the next batch; null when every page was read. */
  next: string | null;
};

const ONE_BY_ONE = 12;
const AT_ONCE = 3;

async function wanted(sessionLabel: string) {
  const db = createAdminClient();
  // Children on the roll only: Fees shares no photo of a child who left, and
  // One places none (`place_student_photo` wants a current child).
  const fees = await db.from("fees_bridge_students").select("id,photo_path").eq("session_label", sessionLabel)
    .eq("status", "active").not("photo_path", "is", null).limit(5000).returns<FeesPhotoRow[]>();
  if (fees.error) throw new Error("photo_copy_unavailable");
  const one = await fetchInChunks<OnePhotoRow>(fees.data.map((row) => row.id), IN_FILTER_CHUNK_SIZE, (chunk) =>
    db.from("student_photos").select("id,student_id,source,source_ref").is("replaced_at", null).in("student_id", chunk));
  if (one.error) throw new Error("photo_copy_unavailable");
  return { total: fees.data.length, pending: pendingFeesCopies(fees.data, one.data) };
}

/** A bridge failure that would fail every child the same way stops the batch. */
function fatal(error: unknown) {
  return error instanceof FeesBridgeError && ["unauthorized", "forbidden", "not_configured", "not_available"].includes(error.code);
}

export async function copyFeesPhotos(staff: CurrentStaff, sessionLabel: string, opts: { after: string | null; budgetMs: number }): Promise<FeesPhotoCopy> {
  const started = Date.now();
  const { total, pending } = await wanted(sessionLabel);
  const result: FeesPhotoCopy = { total, pending: pending.size, copied: 0, failed: 0, next: null };
  if (pending.size === 0) return result;

  const place = async (studentId: string, want: PendingCopy, bytes: ArrayBuffer, contentType: string) => {
    const receipt = await placePhoto({
      commandId: feesCopyCommandId(studentId, want), studentId, sessionLabel, bytes, contentType,
      width: null, height: null, source: "fees", sourceRef: want.path, expectedCurrent: want.expected, actorStaffId: staff.id,
    });
    if (receipt.ok) result.copied++;
    else result.failed++;
  };

  // A few changed photos: one request each.
  if (!opts.after && pending.size <= ONE_BY_ONE) {
    await mapConcurrently([...pending], AT_ONCE, async ([studentId, want]) => {
      try {
        const photo = await getBridgeStudentPhoto(studentId, sessionLabel, "full");
        await place(studentId, want, photo.bytes, photo.contentType);
      } catch (error) {
        if (fatal(error)) throw error;
        result.failed++;
      }
    });
    return result;
  }

  // Many: Fees' photo pages, in student order, until the time is spent.
  let after = opts.after;
  do {
    const page = await getBridgeAiPhotos(sessionLabel, after);
    const mine = page.photos.filter((photo) => pending.has(photo.studentId) && photo.status === "active");
    await mapConcurrently(mine, AT_ONCE, async (photo) => {
      try {
        const bytes = Buffer.from(photo.data, "base64");
        await place(photo.studentId, pending.get(photo.studentId)!, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, photo.contentType);
      } catch {
        result.failed++;
      }
    });
    // A photo Fees could not read is counted, so the bar ends and the admin is told.
    result.failed += page.skipped.filter((skip) => pending.has(skip.studentId)).length;
    after = page.next;
  } while (after && Date.now() - started < opts.budgetMs);
  result.next = after;
  return result;
}
