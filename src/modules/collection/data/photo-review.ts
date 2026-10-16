import "server-only";
import { assertStaff } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";
import { fetchInChunks, mapConcurrently } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import type { Submission } from "../domain/review";
import { signedPhoto } from "./profile-photo-context";
export async function photoReviews(submissions: Submission[]) {
  const actor = await assertStaff();
  if (actor.role !== "admin") return [];
  const answers = submissions.filter(s => s.fieldKey === "student_photo" && s.status === "pending" && s.value);
  if (!answers.length) return [];
  const db = createAdminClient();
  const rows = await fetchInChunks<{ command_id: string; student_id: string; request_id: string; payload: { storage_path: string } }>(answers.map(s => s.value!), IN_FILTER_CHUNK_SIZE,
    ids => db.from("photo_proposals").select("command_id,student_id,request_id,payload").in("command_id", ids).eq("decision", "pending"));
  if (rows.error) throw new Error("photo_unavailable");
  return mapConcurrently(rows.data, 4, async row => {
    const answer = answers.find(s => s.value === row.command_id && s.studentId === row.student_id && s.requestId === row.request_id);
    if (!answer) throw new Error("photo_unbound");
    const current = await db.from("student_photos").select("storage_path").eq("student_id", row.student_id).is("replaced_at", null).maybeSingle<{ storage_path: string }>();
    if (current.error) throw new Error("photo_unavailable");
    return { proposalId: row.command_id, name: answer.studentName, url: (await signedPhoto(row.payload.storage_path))!, currentUrl: await signedPhoto(current.data?.storage_path ?? null) };
  });
}
