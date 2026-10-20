import "server-only";
import { assertStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { createClient } from "@/platform/supabase/server";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { PHOTOS_BUCKET } from "./photo-storage";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { classScopeFor } from "@/modules/attendance/data/teaching-repo";
import { scopeIncludes } from "@/modules/attendance/domain/class-scope";

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

/** Approved rows only. Teacher access follows current enrollment/class scope,
 * because students:view opens the office directory and is not a teacher grant. */
export async function approvedStudentPhotos(ids: readonly string[]): Promise<Map<string, string>> {
  const actor = await assertStaff();
  const directory = can(actor,"students:view");
  if (!directory && !can(actor,"attendance:view")) throw new Error("not_permitted");
  if (!ids.length) return new Map();
  let wanted=[...new Set(ids)];
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
  const result = await fetchInChunks<{ student_id: string; storage_path: string }>(wanted, IN_FILTER_CHUNK_SIZE,
    chunk => db.from("student_photos").select("student_id,storage_path").is("replaced_at", null).in("student_id", chunk));
  if (result.error) throw new Error("photo_unavailable");
  return sign(result.data.map(r => ({ id: r.student_id, path: r.storage_path })));
}

/** Self or current staff directory permission, before service-role reads. */
export async function approvedStaffPhotos(ids: readonly string[]): Promise<Map<string, string>> {
  const actor = await assertStaff();
  const wanted = [...new Set(ids)];
  if (wanted.some(id => id !== actor.id) && !can(actor, "staff:view")) throw new Error("not_permitted");
  if (!wanted.length) return new Map();
  const result = await fetchInChunks<{ staff_id: string; payload: { storage_path: string } }>(wanted, IN_FILTER_CHUNK_SIZE,
    chunk => createAdminClient().from("staff_photos").select("staff_id,payload").is("replaced_at", null).in("staff_id", chunk));
  if (result.error) throw new Error("photo_unavailable");
  return sign(result.data.map(r => ({ id: r.staff_id, path: r.payload.storage_path })));
}
