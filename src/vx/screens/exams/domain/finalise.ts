import type { StaffRole } from "@/platform/auth/permissions";

/**
 * Who finalises a class's marks (locks them) and who reopens them (D-262).
 *
 * The 11 October notes asked "who finalises / reopens marks?" (§10.1) and the
 * default chosen until the school answers is the administrator, for both.
 * Before that the exam office locked and only the admin unlocked. Both lists
 * live here, once, so the answer can change in one line: add
 * `"exam_coordinator"` to `MARKS_FINALISERS` to give the lock back to the exam
 * office.
 *
 * Everything before finalisation is unchanged: a subject teacher edits her own
 * paper until she submits it, and a submitted paper can still be handed back
 * for re-checking (`reopen` on the paper, which is not this).
 */
export const MARKS_FINALISERS: readonly StaffRole[] = ["admin"];
export const MARKS_REOPENERS: readonly StaffRole[] = ["admin"];

export function canFinaliseMarks(staff: { role: StaffRole } | null | undefined): boolean {
  return Boolean(staff && MARKS_FINALISERS.includes(staff.role));
}

export function canReopenMarks(staff: { role: StaffRole } | null | undefined): boolean {
  return Boolean(staff && MARKS_REOPENERS.includes(staff.role));
}

/**
 * Who shows marks to parents (D-647): releasing an exam's results (Now or at a
 * set time) and "Results are out" on WhatsApp. The owner (16 Nov 2026):
 * teachers publish their marks; only the admin decides whether parents see
 * them. Parents only ever see the school's own exams, the ones on the report
 * card: a class test is never an `assessments` row (D-609) and nothing that
 * reaches a parent reads `class_tests`.
 */
export const RESULT_RELEASERS: readonly StaffRole[] = ["admin"];

export function canShowResultsToParents(staff: { role: StaffRole } | null | undefined): boolean {
  return Boolean(staff && RESULT_RELEASERS.includes(staff.role));
}
