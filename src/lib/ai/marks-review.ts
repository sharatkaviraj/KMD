import { z } from "zod";

import { parseMark } from "@/vx/screens/exams/domain/entry";
import type { MarksPhoto } from "@/lib/ai/photo-schema";

export const MARKS_PHOTO_ACTION = "marks-photo";
export type PhotoStudent = { id: string; roll: string | null; name: string };
type Issue = "identity" | "unclear" | "mark" | "duplicate";
export type PhotoReviewRow = {
  index: number;
  roll: string;
  name: string;
  marks: string;
  studentId: string | null;
  issues: Issue[];
};
export type PhotoReview = { rows: PhotoReviewRow[]; missing: PhotoStudent[]; students: PhotoStudent[] };
export const photoChoice = z.strictObject({
  index: z.number().int().min(0).max(119),
  studentId: z.uuid().nullable(),
  marks: z.string().max(160),
  confirmed: z.boolean(),
  skip: z.boolean(),
});
export type PhotoChoice = z.infer<typeof photoChoice>;
type Rule = { max: number; step: number };
type Entry = { studentId: string; state: "value" | "absent"; value: number | null };

function digits(input: string) {
  return input.replace(/[०-९]/g, (digit) => String(digit.charCodeAt(0) - 0x966));
}
function rollOf(roll: string | null) {
  const value = digits((roll ?? "").normalize("NFKC").trim());
  return /^\d+$/.test(value) ? value.replace(/^0+(?=\d)/, "") : "";
}
function nameOf(name: string) {
  return name.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-IN");
}

export function readPhotoMark(marks: string, rule: Rule): Omit<Entry, "studentId"> | null {
  const raw = marks.trim().toUpperCase();
  if (["A", "AB", "-", "–", "—"].includes(raw)) return { state: "absent", value: null };
  const fractional = raw.replace(/^(\d+|[०-९]+)?\s*½$/u, (_, whole: string | undefined) => (whole ?? "0") + ".5");
  const result = parseMark(digits(fractional.normalize("NFKC")), rule.max, rule.step);
  return result.ok && result.value !== null ? { state: "value", value: result.value } : null;
}

/** Only synthetic roster fields and one-use labels go to Gemini. No database IDs. */
export function photoRoster(students: readonly PhotoStudent[]) {
  return students.map((student, i) => ({ ref: "R" + (i + 1), roll: student.roll, name: student.name }));
}

export function reviewMarksPhoto(photo: MarksPhoto, students: PhotoStudent[], rule: Rule): PhotoReview {
  const byRef = photoRoster(students);
  const rows = photo.rows.map((row, index): PhotoReviewRow => {
    const roll = rollOf(row.roll);
    const name = nameOf(row.name);
    const matches = students.filter((s) => roll && rollOf(s.roll) === roll);
    const match = matches.length === 1 && name && nameOf(matches[0].name) === name ? matches[0] : null;
    const expectedRef = match ? byRef[students.indexOf(match)].ref : "";
    const issues: Issue[] = [];
    if (!match || (row.rosterRef && row.rosterRef !== expectedRef)) issues.push("identity");
    if (row.unclear) issues.push("unclear");
    if (!readPhotoMark(row.marks, rule)) issues.push("mark");
    return { index, roll: row.roll, name: row.name, marks: row.marks, studentId: match?.id ?? null, issues };
  });
  const counts = new Map<string, number>();
  for (const row of rows) if (row.studentId) counts.set(row.studentId, (counts.get(row.studentId) ?? 0) + 1);
  for (const row of rows) if (row.studentId && (counts.get(row.studentId) ?? 0) > 1) row.issues.push("duplicate");
  return { rows, students, missing: students.filter((student) => !counts.has(student.id)) };
}

/** Re-run this on the server using the original draft, never the client's claimed flags. */
export function finalPhotoEntries(review: PhotoReview, choices: PhotoChoice[], rule: Rule) {
  if (choices.length !== review.rows.length) return null;
  const byIndex = new Map(choices.map((choice) => [choice.index, choice]));
  const rosterIds = new Set(review.students.map((s) => s.id));
  const used = new Set<string>();
  const entries: Entry[] = [];
  let edited = false;
  for (const row of review.rows) {
    const choice = byIndex.get(row.index);
    if (!choice) return null;
    if (choice.skip) {
      edited = true;
      continue;
    }
    if (row.issues.length && !choice.confirmed) return null;
    if (!choice.studentId || !rosterIds.has(choice.studentId) || used.has(choice.studentId)) return null;
    const cell = readPhotoMark(choice.marks, rule);
    if (!cell) return null;
    used.add(choice.studentId);
    entries.push({ studentId: choice.studentId, ...cell });
    if (choice.studentId !== row.studentId || choice.marks.trim() !== row.marks.trim()) edited = true;
  }
  if (!entries.length) return null;
  return { entries, edited };
}
