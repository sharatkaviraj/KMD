import "server-only";

import { heldClassIds } from "@/modules/attendance/data/teaching-repo";
import { parentNoteViews, parentReaderFor, type ParentNoteView } from "@/modules/whatsapp/data/parent-suggestion-views";
import { decidedSince, waitingSuggestions } from "@/modules/whatsapp/data/parent-suggestions";
import { inNeedsYou, type SuggestionReader } from "@/modules/whatsapp/domain/parent-suggestions";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { staffBelongsToSession } from "@/platform/auth/test-session-policy";
import { timeP } from "@/vx/format";
import { p } from "@/vx/text";
import { getViewer } from "@/vx/view-as";

import type { ParentNoteRow } from "./parent-notes-card";
import { ParentNotesLazy } from "./parent-notes-lazy";

/*
 * A parent's suggestions (D-598) where they are decided outside Needs you's
 * queue: the class teacher's Parents' notes on Today, and Needs you's
 * Decided today. Both are drawn on the server and stream in after the rest
 * of the page, so a slow read never holds it up, and both stay out while an
 * admin sees One as someone else (nothing may be saved then).
 */

/** The school's day starts at midnight in India. */
export function dayStartIso(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

function rowOf(view: ParentNoteView): ParentNoteRow {
  const at = view.decidedAt ? timeP(view.decidedAt) : null;
  return {
    id: view.id,
    studentId: view.studentId,
    childName: view.childName,
    classLabel: view.classLabel,
    line: view.line,
    words: view.words,
    practice: view.practice,
    urgent: view.urgent,
    decided: view.decided && at ? p(`${view.decided.en} · ${at.en}`, `${view.decided.hi ?? view.decided.en} · ${at.hi}`) : view.decided,
  };
}

/**
 * The class teacher's Parents' notes on Today: their classes' absences a
 * parent told Veer Patta AI about, waiting, and what was decided today.
 * Nothing at all until there is one.
 */
export async function ParentNotesToday({ staff, sessionLabel, day }: { staff: CurrentStaff; sessionLabel: string; day: string }) {
  const { previewing } = await getViewer();
  if (previewing || !staffBelongsToSession(staff.isTestAccount, sessionLabel)) return null;
  const views = await teacherNotes(staff.id, sessionLabel, day).catch(() => null);
  if (!views || views.length === 0) return null;
  return (
    <ParentNotesLazy
      via="teacher_home"
      waiting={views.filter((view) => view.status === "pending").map(rowOf)}
      decided={views.filter((view) => view.status !== "pending").map(rowOf)}
    />
  );
}

/** The classes this teacher holds: their absences still waiting, and decided today. A read that fails leaves the card out. */
async function teacherNotes(staffId: string, sessionLabel: string, day: string): Promise<ParentNoteView[]> {
  const classIds = await heldClassIds(staffId, sessionLabel, day);
  if (classIds.length === 0) return [];
  const [waiting, decided] = await Promise.all([
    waitingSuggestions(sessionLabel, { classIds }),
    decidedSince(sessionLabel, dayStartIso(day), { classIds }),
  ]);
  const rows = [...waiting, ...decided].filter((row) => row.kind === "absence");
  return rows.length ? parentNoteViews(rows, sessionLabel, day) : [];
}

/** Needs you's Decided today: what this reader's list held and someone decided today, each with Undo. */
export async function ParentsDecidedToday({ staff, sessionLabel, day }: { staff: CurrentStaff; sessionLabel: string; day: string }) {
  const { previewing } = await getViewer();
  const reader = parentReaderFor(staff, sessionLabel);
  if (previewing || !reader) return null;
  const views = await decidedToday(reader, sessionLabel, day).catch(() => null);
  if (!views || views.length === 0) return null;
  return <ParentNotesLazy via="needs_you" waiting={[]} decided={views.map(rowOf)} decidedOnly />;
}

async function decidedToday(reader: SuggestionReader, sessionLabel: string, day: string): Promise<ParentNoteView[]> {
  const decided = (await decidedSince(sessionLabel, dayStartIso(day))).filter((row) => inNeedsYou(row, reader));
  return decided.length ? parentNoteViews(decided, sessionLabel, day) : [];
}
