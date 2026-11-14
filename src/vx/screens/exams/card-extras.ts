import "server-only";

import sharp from "sharp";

import { fetchInChunks, mapConcurrently } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { createAdminClient } from "@/platform/supabase/admin";

import type { CardPhoto } from "./report-card-pdf";

/*
 * What a printed report card shows about the child beyond the marks (D-612):
 * the photo, the mother's name and the date of birth. Read when the card is
 * printed, from the school's records, and never stored on the card: they are
 * not figures the card was worked out from. Names come from the Fees roster
 * One keeps (`fees_action_students`), because the Fees app is the record of
 * who each child is (owner, 14 Nov 2026).
 *
 * Nothing here can stop a card printing: a photo that cannot be read prints
 * as the child's initials, a missing name as a dash.
 */

export type CardExtras = { photo: CardPhoto | null; motherName: string | null; dateOfBirth: string | null };

const PHOTOS_BUCKET = "vppsone-photos";
/** Twice the printed box (54×66 pt), so it stays sharp on paper and small in the file. */
const PHOTO_SIZE = { width: 216, height: 264 };

async function cardPhoto(path: string): Promise<CardPhoto | null> {
  try {
    const { data, error } = await createAdminClient().storage.from(PHOTOS_BUCKET).download(path);
    if (error || !data) return null;
    const bytes = await sharp(Buffer.from(await data.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(PHOTO_SIZE.width, PHOTO_SIZE.height, { fit: "cover", position: "attention" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 76 })
      .toBuffer();
    return { data: bytes, format: "jpg" };
  } catch {
    return null;
  }
}

export async function cardExtras(studentIds: string[]): Promise<Map<string, CardExtras>> {
  const ids = [...new Set(studentIds)];
  const out = new Map<string, CardExtras>(ids.map((id) => [id, { photo: null, motherName: null, dateOfBirth: null }]));
  if (!ids.length) return out;
  const db = createAdminClient();
  const [people, photos] = await Promise.all([
    fetchInChunks<{ id: string; mother_name: string | null; date_of_birth: string | null }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
      db.from("fees_action_students").select("id, mother_name, date_of_birth").in("id", chunk),
    ),
    fetchInChunks<{ student_id: string; storage_path: string }>(ids, IN_FILTER_CHUNK_SIZE, (chunk) =>
      db.from("student_photos").select("student_id, storage_path").is("replaced_at", null).in("student_id", chunk),
    ),
  ]);
  if (!people.error)
    for (const p of people.data) {
      const entry = out.get(p.id);
      if (entry) Object.assign(entry, { motherName: p.mother_name?.trim() || null, dateOfBirth: p.date_of_birth ?? null });
    }
  if (!photos.error) {
    const read = await mapConcurrently(photos.data, 6, async (p) => ({ id: p.student_id, photo: await cardPhoto(p.storage_path) }));
    for (const r of read) {
      const entry = out.get(r.id);
      if (entry && r.photo) entry.photo = r.photo;
    }
  }
  return out;
}
