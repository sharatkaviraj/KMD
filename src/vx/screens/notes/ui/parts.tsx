"use client";

import { canWorkOnNote, type BoardNote } from "../domain/notes";

export { replaceParams } from "./look";

/** What the client needs to know about the reader (sets do not cross the wire). */
export type ClientViewer = {
  id: string;
  name: string;
  readsEveryClass: boolean;
  correctsAttendance: boolean;
  heldClassIds: string[];
  canWrite: boolean;
  /** The admin: "Admin · you" on the board's follow-up choices. */
  isAdmin?: boolean;
  /** The academic coordinator: "Coordinator · you". */
  isCoordinator?: boolean;
  /** Settings → Parent messages: false hides "Tell parents" on a note. */
  parentNotes?: boolean;
  /** Settings → Parent messages: false hides sharing a support plan. */
  parentPlans?: boolean;
};

/** The add-a-note steps: write (or speak), listening, check, saved. */
export type AddStep = "add" | "listening" | "review" | "saved";

export function canWork(note: BoardNote, viewer: ClientViewer): boolean {
  return canWorkOnNote(note, { ...viewer, heldClassIds: new Set(viewer.heldClassIds) });
}

/** Who may change a plan: its maker, the school-wide roles, the class teacher of the child's class. */
export function mayEditPlan(plan: { createdBy: string; classId: string | null }, viewer: ClientViewer): boolean {
  return viewer.canWrite && (plan.createdBy === viewer.id || viewer.readsEveryClass || viewer.correctsAttendance || (plan.classId !== null && viewer.heldClassIds.includes(plan.classId)));
}
