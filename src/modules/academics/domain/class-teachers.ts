import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";
import type { FeeClass } from "@/modules/academics/domain/subjects";

/**
 * Class teachers, with history — pure rules, no database.
 *
 * The whole design is in one sentence from PLAN §4: *replaced, never edited*.
 * A class teacher changing mid-year is a fact about a date, not a correction.
 * Attendance already taken, notes already written and report cards already
 * signed all belong to whoever held the class at the time, so a change closes
 * one row and opens another rather than overwriting a name.
 */

export const classTeacherRoles = ["class_teacher", "assistant"] as const;

export type ClassTeacherRole = (typeof classTeacherRoles)[number];

export const classTeacherRoleLabels: Record<ClassTeacherRole, Localized> = {
  class_teacher: t("कक्षा अध्यापक", "Class teacher"),
  assistant: t("सहायक", "Assistant"),
};

export type ClassTeacher = {
  id: string;
  classId: string;
  sessionLabel: string;
  staffProfileId: string;
  staffDisplayName: string;
  staffShortName: string;
  role: ClassTeacherRole;
  /** ISO date. */
  effectiveFrom: string;
  /** ISO date, or null for the current holder. */
  effectiveTo: string | null;
  replacedReason: string | null;
};

/** A date with no time, as the database stores it and the form submits it. */
const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, {
    message: encodeMessage(t("तारीख़ चुनें", "Choose a date")),
  });

export const assignClassTeacherSchema = z.object({
  classId: z.uuid({
    message: encodeMessage(t("कक्षा चुनें", "Choose a class")),
  }),
  staffProfileId: z.uuid({
    message: encodeMessage(t("अध्यापक चुनें", "Choose a teacher")),
  }),
  role: z.enum(classTeacherRoles),
  effectiveFrom: isoDate,
  replacedReason: z
    .string()
    .trim()
    .max(200, {
      message: encodeMessage(t("कारण बहुत लंबा है", "That reason is too long")),
    })
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

export type AssignClassTeacherInput = z.infer<typeof assignClassTeacherSchema>;

/** Is this row the one in force today? */
export function isCurrent(assignment: Pick<ClassTeacher, "effectiveTo">): boolean {
  return assignment.effectiveTo === null;
}

/**
 * The day the outgoing holder's term ends, given when the new one starts.
 *
 * The day *before*, so the two never overlap: if both were open on the same
 * date, "who is the class teacher today" would have two answers, and the
 * partial unique index would refuse the insert anyway.
 */
export function dayBefore(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Whether a proposed assignment can go ahead, and why not when it cannot.
 *
 * This is the check the screen shows *and* the action repeats — a disabled
 * button is a hint, not a guard.
 */
export function validateAssignment(
  input: { staffProfileId: string; effectiveFrom: string },
  current: ClassTeacher | null,
  staff: { id: string; isActive: boolean; isTeaching: boolean } | null,
): { allowed: boolean; reason?: Localized } {
  if (!staff) {
    return {
      allowed: false,
      reason: t("यह अध्यापक नहीं मिला।", "That staff member was not found."),
    };
  }

  if (!staff.isActive) {
    return {
      allowed: false,
      reason: t(
        "निष्क्रिय स्टाफ़ को कक्षा नहीं दी जा सकती।",
        "An inactive staff member cannot be given a class.",
      ),
    };
  }

  if (!staff.isTeaching) {
    // Not a hard rule of the school's, but a class teacher who does not teach
    // is almost always a wrong pick from a long list.
    return {
      allowed: false,
      reason: t(
        "इनकी प्रोफ़ाइल में “कक्षा लेते हैं” चुना नहीं है।",
        "Their profile is not marked as teaching classes.",
      ),
    };
  }

  if (current && current.staffProfileId === input.staffProfileId) {
    return {
      allowed: false,
      reason: t(
        "यह पहले से इसी कक्षा के अध्यापक हैं।",
        "They already hold this class.",
      ),
    };
  }

  if (current && input.effectiveFrom <= current.effectiveFrom) {
    // The outgoing term would end before it began.
    return {
      allowed: false,
      reason: t(
        "नई तारीख़ पिछली शुरुआत के बाद की होनी चाहिए।",
        "The new date must be after the previous holder started.",
      ),
    };
  }

  return { allowed: true };
}

/** The current holder of each role for one class. */
export function currentHolders(
  assignments: ClassTeacher[],
): Partial<Record<ClassTeacherRole, ClassTeacher>> {
  const result: Partial<Record<ClassTeacherRole, ClassTeacher>> = {};
  for (const assignment of assignments) {
    if (isCurrent(assignment)) {
      result[assignment.role] = assignment;
    }
  }
  return result;
}

/** History newest first — what a detail screen reads top to bottom. */
export function byMostRecent(a: ClassTeacher, b: ClassTeacher): number {
  if (a.effectiveFrom !== b.effectiveFrom) {
    return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
  }
  // Same start date: the open row is the one in force.
  if (isCurrent(a) !== isCurrent(b)) return isCurrent(a) ? -1 : 1;
  return 0;
}

export type ClassWithTeachers = {
  feeClass: FeeClass;
  current: Partial<Record<ClassTeacherRole, ClassTeacher>>;
  history: ClassTeacher[];
};

export function joinClassesToTeachers(
  classes: FeeClass[],
  assignments: ClassTeacher[],
): ClassWithTeachers[] {
  const byClass = new Map<string, ClassTeacher[]>();
  for (const assignment of assignments) {
    const list = byClass.get(assignment.classId) ?? [];
    list.push(assignment);
    byClass.set(assignment.classId, list);
  }

  return classes
    .map((feeClass) => {
      const history = (byClass.get(feeClass.id) ?? []).sort(byMostRecent);
      return { feeClass, current: currentHolders(history), history };
    })
    .sort((a, b) => {
      // Classes with nobody assigned first — this screen exists to empty that
      // list, the same way the class-label screen does.
      const aHas = a.current.class_teacher ? 1 : 0;
      const bHas = b.current.class_teacher ? 1 : 0;
      if (aHas !== bHas) return aHas - bHas;
      return a.feeClass.sortOrder - b.feeClass.sortOrder;
    });
}

export function assignmentProgress(rows: ClassWithTeachers[]): {
  assigned: number;
  total: number;
  complete: boolean;
} {
  const assigned = rows.filter((row) => row.current.class_teacher).length;
  return {
    assigned,
    total: rows.length,
    complete: rows.length > 0 && assigned === rows.length,
  };
}
