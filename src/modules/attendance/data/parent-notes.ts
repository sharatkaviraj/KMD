import "server-only";

import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { logWarn } from "@/platform/observability/log";
import { createAdminClient } from "@/platform/supabase/admin";

/** Why the parent said the child would be away, in a word: never their message. */
export type ParentNoteReason = "sick" | "other";

/**
 * The children whose parent told the school on WhatsApp that they would be
 * away on `day` (Veer Patta AI, D-588), with the reason. Read with the
 * service role, for a roll the reader is already allowed to open.
 *
 * Empty when it cannot be read: the register opens and saves either way, and
 * only the "Parent informed" line is missing.
 */
export async function parentNotesOn(sessionLabel: string, day: string, studentIds: readonly string[]): Promise<Map<string, ParentNoteReason>> {
  const notes = new Map<string, ParentNoteReason>();
  if (studentIds.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return notes;
  try {
    const { data, error } = await fetchInChunks<{ student_id: string; reason: string }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      createAdminClient()
        .from("parent_absence_notes")
        .select("student_id, reason")
        .eq("session_label", sessionLabel)
        .eq("day", day)
        .in("student_id", chunk),
    );
    if (error) throw error;
    for (const row of data) notes.set(row.student_id, row.reason === "sick" ? "sick" : "other");
  } catch (caught) {
    logWarn("attendance.parent_notes_unreadable", { error: caught instanceof Error ? caught.message : "unknown" });
    notes.clear();
  }
  return notes;
}
