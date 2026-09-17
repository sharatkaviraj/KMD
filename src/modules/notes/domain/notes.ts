import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * Notes — what a teacher writes down about a child or a class.
 *
 * Typed by `note_kinds` so a screen can filter without reading every body, and
 * so a student card can show "three behaviour notes this term" rather than a
 * wall of text nobody scrolls.
 */

export const noteTones = ["neutral", "good", "concern"] as const;
export type NoteTone = (typeof noteTones)[number];

export type NoteKind = {
  id: string;
  code: string;
  labelHi: string;
  labelEn: string;
  tone: NoteTone;
  isActive: boolean;
  sortOrder: number;
};

export type Note = {
  id: string;
  sessionLabel: string;
  studentId: string | null;
  classId: string | null;
  kindId: string;
  kindCode: string;
  kindLabelHi: string;
  kindLabelEn: string;
  tone: NoteTone;
  body: string;
  writtenById: string;
  writtenByName: string;
  createdAt: string;
};

export const noteToneLabels: Record<NoteTone, Localized> = {
  neutral: t("सामान्य", "Note"),
  good: t("अच्छा", "Good"),
  concern: t("ध्यान देने योग्य", "Needs attention"),
};

export const writeNoteSchema = z
  .object({
    kindId: z.uuid({
      message: encodeMessage(t("किस तरह की बात है", "Choose a kind")),
    }),
    studentId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .nullable(),
    classId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .nullable(),
    body: z
      .string()
      .trim()
      .min(3, {
        message: encodeMessage(t("कुछ लिखें", "Write something")),
      })
      .max(1000, {
        message: encodeMessage(t("बहुत लंबा है", "That is too long")),
      }),
  })
  .refine((value) => value.studentId !== null || value.classId !== null, {
    message: encodeMessage(
      t(
        "किसी बच्चे या कक्षा से जोड़ें",
        "Attach the note to a child or a class",
      ),
    ),
    path: ["studentId"],
  });

export type WriteNoteInput = z.infer<typeof writeNoteSchema>;

/** Newest first — a note screen is read from the top. */
export function byNewest(a: Note, b: Note): number {
  return a.createdAt < b.createdAt ? 1 : -1;
}

export function activeKinds(kinds: NoteKind[]): NoteKind[] {
  return kinds
    .filter((kind) => kind.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.labelEn.localeCompare(b.labelEn));
}

/**
 * How many notes of each tone, for the summary line on a student card.
 *
 * Counted rather than listed, because the useful first sentence about a child
 * is "two things need attention", not their text.
 */
export function toneCounts(notes: Note[]): Record<NoteTone, number> {
  const counts: Record<NoteTone, number> = { neutral: 0, good: 0, concern: 0 };
  for (const note of notes) counts[note.tone] += 1;
  return counts;
}

/**
 * Whether this staff member may see a note.
 *
 * Notes about a child are written by the people who teach them, and read by
 * the same. `notes:view` is the permission; this is the row-level half. The
 * office and above see everything, because following up on a concern is their
 * job.
 */
export function canReadNote(input: {
  hasNotesView: boolean;
  seesEverything: boolean;
  ownClassIds: string[];
  note: Pick<Note, "classId" | "writtenById">;
  staffId: string;
}): boolean {
  if (!input.hasNotesView) return false;
  if (input.seesEverything) return true;
  if (input.note.writtenById === input.staffId) return true;
  if (input.note.classId && input.ownClassIds.includes(input.note.classId)) {
    return true;
  }
  return false;
}
