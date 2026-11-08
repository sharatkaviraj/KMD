import "server-only";
import { assertStaff } from "@/platform/auth/current-staff";
import { can, type PermissionSubject } from "@/platform/auth/permissions";
import { createClient } from "@/platform/supabase/server";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { PHOTOS_BUCKET } from "./photo-storage";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { classScopeFor } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";
import { feesBridgeEnabled, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { readFeesBridgeState } from "@/platform/fees-bridge/state";
import { bridgeStudentPhotoHref } from "@/platform/fees-bridge/student-photo";
import { studentPhotoLink } from "./photo-link";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sign(rows: { id: string; path: string }[]) {
  const out = new Map<string, string>();
  for (let start = 0; start < rows.length; start += IN_FILTER_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + IN_FILTER_CHUNK_SIZE);
    const result = await createAdminClient().storage.from(PHOTOS_BUCKET).createSignedUrls(chunk.map(r => r.path), 300);
    if (result.error) throw new Error("photo_unavailable");
    const urls = new Map((result.data ?? []).map(r => [r.path, r.signedUrl]));
    for (const row of chunk) { const url = urls.get(row.path); if (url) out.set(row.id, url); }
  }
  return out;
}

/** Links for current photo rows (`photo-link.ts`): no storage call, the route serves the bytes. */
function links(rows: readonly { id: string; student_id: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const href = studentPhotoLink(row.student_id, row.id, "list");
    if (href) out.set(row.student_id, href);
  }
  return out;
}

type PhotoRow = { id: string; student_id: string; source: string; source_ref: string | null };

/** Approved rows only. Teacher access follows current enrollment/class scope,
 * because students:view opens the office directory and is not a teacher grant.
 *
 * Every address is a list-size photo; `fullPhotoHref` turns it into the large
 * one for the viewer. One's own photos come as links the phone keeps all day
 * (owner, 8 Nov 2026), not five-minute signed links that made every screen
 * download every face again. */
export async function approvedStudentPhotos(ids: readonly string[]): Promise<Map<string, string>> {
  const actor = await assertStaff();
  const directory = can(actor,"students:view");
  if (!directory && !can(actor,"attendance:view")) throw new Error("not_permitted");
  if (!ids.length) return new Map();
  let wanted=[...new Set(ids)].filter(id => UUID.test(id));
  if (!wanted.length) return new Map();
  if (directory && feesBridgeEnabled()) {
    const session = await resolveSessionLabel();
    if (usesCanonicalFees(actor, session)) {
      if (!session) throw new Error("no_session");
      await readFeesBridgeState();
      // Canonical real photos stay owned by Fees. The projection only tells us
      // whether a current student has one. One's copy of that same Fees photo
      // (D-511) is used when it is up to date: a kept link instead of a trip
      // to Fees for every face. Otherwise the Fees byte endpoint, which
      // independently checks the signed-in actor, source grant, student and session.
      const fees = await fetchInChunks<{ id: string; photo_path: string | null }>(wanted, IN_FILTER_CHUNK_SIZE,
        chunk => createAdminClient().from("fees_bridge_students").select("id,photo_path")
          .eq("session_label", session).in("id", chunk));
      if (fees.error) throw new Error("photo_unavailable");
      const copies = await fetchInChunks<PhotoRow>(wanted, IN_FILTER_CHUNK_SIZE,
        chunk => createAdminClient().from("student_photos").select("id,student_id,source,source_ref").is("replaced_at", null).in("student_id", chunk));
      const one = new Map((copies.error ? [] : copies.data).map(row => [row.student_id, row]));
      const out = new Map<string, string>();
      for (const row of fees.data) {
        const path = row.photo_path?.trim();
        const copy = one.get(row.id);
        if (path) {
          const kept = copy && copy.source === "fees" && copy.source_ref === path ? studentPhotoLink(row.id, copy.id, "list") : null;
          out.set(row.id, kept ?? bridgeStudentPhotoHref(row.id, session, "list"));
        } else if (copy && copy.source !== "fees") {
          // A photo the school placed in One for a child Fees has none for.
          const own = studentPhotoLink(row.id, copy.id, "list");
          if (own) out.set(row.id, own);
        }
      }
      return out;
    }
  }
  const db = directory ? await createClient() : createAdminClient();
  if (!directory) {
    const session=await resolveSessionLabel();
    if (!session) throw new Error("no_session");
    const scope=await classScopeFor(actor,session);
    const roll=await fetchInChunks<{student_id:string;class_id:string}>(wanted,IN_FILTER_CHUNK_SIZE,
      chunk=>db.from("enrolments").select("student_id,class_id").eq("session_label",session).eq("status","enrolled").in("student_id",chunk));
    if (roll.error) throw new Error("photo_unavailable");
    wanted=roll.data.filter(r=>scopeIncludes(scope,r.class_id)).map(r=>r.student_id);
  }
  const result = await fetchInChunks<{ id: string; student_id: string }>(wanted, IN_FILTER_CHUNK_SIZE,
    chunk => db.from("student_photos").select("id,student_id").is("replaced_at", null).in("student_id", chunk));
  if (result.error) throw new Error("photo_unavailable");
  return links(result.data);
}

/** Self or current staff directory permission, before service-role reads. */
export async function approvedStaffPhotos(ids: readonly string[]): Promise<Map<string, string>> {
  return staffPhotosFor(await assertStaff(), ids);
}

/**
 * The same, for a reader the caller has already verified — the view-as picker
 * (D-544), which asks as the administrator actually signed in, not as the
 * person they may be looking at.
 */
export async function staffPhotosFor(actor: PermissionSubject & { id: string }, ids: readonly string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)];
  if (wanted.some(id => id !== actor.id) && !can(actor, "staff:view")) throw new Error("not_permitted");
  if (!wanted.length) return new Map();
  const result = await fetchInChunks<{ staff_id: string; payload: { storage_path: string } }>(wanted, IN_FILTER_CHUNK_SIZE,
    chunk => createAdminClient().from("staff_photos").select("staff_id,payload").is("replaced_at", null).in("staff_id", chunk));
  if (result.error) throw new Error("photo_unavailable");
  return sign(result.data.map(r => ({ id: r.staff_id, path: r.payload.storage_path })));
}
