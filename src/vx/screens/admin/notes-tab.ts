import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { noteViewer, visibleNotes } from "@/vx/screens/notes/data";
import { canWorkOnNote, type BoardNote } from "@/vx/screens/notes/domain/notes";

export { canWriteNotes } from "@/vx/screens/notes/data";

/**
 * The Student 360 notes' only data access, kept in one small function on
 * purpose: the tab, the overview's strengths and support cards, and the
 * scoped notes board (`/notes?student=`) must show the same notes.
 *
 * So it reads them the way the board does — `visibleNotes`, filtered by
 * `canSeeNote()`, the same rule as the `notes_select_scoped` policy — narrowed
 * to one child. It used to read through the older notes repository, whose
 * staff embed went ambiguous when notes gained a second and third foreign key
 * to `staff_profiles`; that read failed and the tab showed no notes at all.
 */
export type NoteForTab = Pick<
  BoardNote,
  "id" | "body" | "tags" | "status" | "needsFollowUp" | "followUpOn" | "followUpOwner" | "followUpName" | "writtenByName" | "createdAt"
> & {
  /** May this reader mark it working or done — the same rule `setNoteStatusAction` checks. */
  canWork: boolean;
};

export async function notesForStudentTab(staff: CurrentStaff, studentId: string, sessionLabel: string): Promise<NoteForTab[]> {
  if (!can(staff, "notes:view")) return [];
  const viewer = await noteViewer(staff, sessionLabel);
  const notes = await visibleNotes(viewer, sessionLabel, { studentId, limit: 100 });
  return notes.map((note) => ({
    id: note.id,
    body: note.body,
    tags: note.tags,
    status: note.status,
    needsFollowUp: note.needsFollowUp,
    followUpOn: note.followUpOn,
    followUpOwner: note.followUpOwner,
    followUpName: note.followUpName,
    writtenByName: note.writtenByName,
    createdAt: note.createdAt,
    canWork: canWorkOnNote(note, viewer),
  }));
}
