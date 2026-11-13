import "server-only";

import { fetchInChunks } from "@/platform/helpers/chunk";
import { IN_FILTER_CHUNK_SIZE } from "@/platform/helpers/in-filter";
import { logWarn } from "@/platform/observability/log";
import { createAdminClient } from "@/platform/supabase/admin";

/** Why the parent said the child would be away, in a word: never their message. */
export type ParentNoteReason = "sick" | "other";

/** How the register starts the child (D-598): Leave or Absent, as the person who applied the note chose. */
export type ParentNoteMark = "leave" | "absent";

export type ParentNote = { reason: ParentNoteReason; mark: ParentNoteMark };

/**
 * The children whose parent told the school on WhatsApp that they would be
 * away on `day` (Veer Patta AI, D-588), with the reason and how the register
 * starts them. A note is only here once a person at school applied the
 * parent's word (D-598). Read with the service role, for a roll the reader
 * is already allowed to open.
 *
 * Empty when it cannot be read: the register opens and saves either way, and
 * only the "Parent informed" line is missing.
 */
export async function parentNotesFor(sessionLabel: string, day: string, studentIds: readonly string[]): Promise<Map<string, ParentNote>> {
  const notes = new Map<string, ParentNote>();
  if (studentIds.length === 0 || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return notes;
  try {
    const { data, error } = await fetchInChunks<{ student_id: string; reason: string; mark: string | null }>(studentIds, IN_FILTER_CHUNK_SIZE, (chunk) =>
      createAdminClient()
        .from("parent_absence_notes")
        .select("student_id, reason, mark")
        .eq("session_label", sessionLabel)
        .eq("day", day)
        // A note taken back with Undo is kept, withdrawn, and not read (D-599).
        .is("withdrawn_at", null)
        .in("student_id", chunk),
    );
    if (error) throw error;
    for (const row of data) notes.set(row.student_id, { reason: row.reason === "sick" ? "sick" : "other", mark: row.mark === "leave" ? "leave" : "absent" });
  } catch (caught) {
    logWarn("attendance.parent_notes_unreadable", { error: caught instanceof Error ? caught.message : "unknown" });
    notes.clear();
  }
  return notes;
}

/** The same notes, with the reason alone: for a reader that only asks whether the parent told the school. */
export async function parentNotesOn(sessionLabel: string, day: string, studentIds: readonly string[]): Promise<Map<string, ParentNoteReason>> {
  const notes = await parentNotesFor(sessionLabel, day, studentIds);
  return new Map([...notes].map(([id, note]) => [id, note.reason]));
}
