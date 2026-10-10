import "server-only";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { ownClassIds } from "@/modules/attendance/data/teaching-repo";
import { notesForStudent } from "@/modules/notes/data/notes-repo";
import { canReadNote } from "@/modules/notes/domain/notes";

/**
 * The Student 360 notes tab's only data access, kept in one small function on
 * purpose: the full notes module is being built separately, and when it lands
 * this is the single place the tab is re-pointed at it.
 *
 * It reads the existing `vppsone.notes` through the notes repository and
 * applies the same `canReadNote` rule the teacher's student page does.
 */
export type NoteForTab = {
  id: string;
  body: string;
  kindLabelEn: string;
  kindLabelHi: string;
  tone: string;
  writtenByName: string;
  createdAt: string;
};

export async function notesForStudentTab(staff: CurrentStaff, studentId: string, sessionLabel: string): Promise<NoteForTab[]> {
  if (!can(staff, "notes:view")) return [];
  const [notes, own] = await Promise.all([notesForStudent(studentId, sessionLabel), ownClassIds(staff.id, sessionLabel)]);
  return notes
    .filter((note) =>
      canReadNote({ hasNotesView: true, seesEverything: can(staff, "attendance:correct"), ownClassIds: own, note, staffId: staff.id }),
    )
    .map((note) => ({
      id: note.id,
      body: note.body,
      kindLabelEn: note.kindLabelEn,
      kindLabelHi: note.kindLabelHi,
      tone: note.tone,
      writtenByName: note.writtenByName,
      createdAt: note.createdAt,
    }));
}
