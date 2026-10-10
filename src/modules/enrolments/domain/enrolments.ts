import { t, type Localized } from "@/platform/i18n/language";
import type { FeeClass } from "@/modules/academics/domain/subjects";

/**
 * Enrolments — the academic record, and the check that keeps it honest.
 *
 * `public.students` holds where a child is *today*. This holds where they were
 * in a given session, which is a different fact and the one a report card, an
 * attendance percentage or a transfer certificate is about.
 *
 * Because it is a copy and rule 2 forbids a foreign key back into `public`,
 * nothing in the database stops the two drifting. `reconcile()` is what
 * notices — and it reports rather than fixes, because every difference has a
 * different right answer and only the office knows which.
 */

export const enrolmentStatuses = ["enrolled", "left", "promoted"] as const;

export type EnrolmentStatus = (typeof enrolmentStatuses)[number];

export const enrolmentStatusLabels: Record<EnrolmentStatus, Localized> = {
  enrolled: t("पढ़ रहे हैं", "Enrolled"),
  left: t("छोड़ चुके", "Left"),
  promoted: t("अगली कक्षा में", "Promoted"),
};

export type Enrolment = {
  id: string;
  studentId: string;
  classId: string;
  sessionLabel: string;
  rollNo: string | null;
  status: EnrolmentStatus;
};

/** A student as the fee app holds them. Read-only here, always (rule 2). */
export type FeeStudent = {
  id: string;
  admissionNo: string | null;
  fullName: string;
  classId: string | null;
  rollNo: string | null;
  /** The fee app's own status enum, as text. */
  status: string | null;
};

/**
 * A student the fee app still considers active.
 *
 * The fee app's `status` is its own vocabulary, so this is deliberately
 * permissive: anything that is not plainly a departure counts, and the
 * consistency check surfaces the rest rather than silently dropping children.
 */
export function isActiveFeeStudent(student: FeeStudent): boolean {
  const status = (student.status ?? "").toLowerCase();
  return status !== "left" && status !== "inactive" && status !== "graduated";
}

/* --------------------------------------------------------- the checks */

export type DifferenceKind =
  /** In the fee app, no enrolment row here. */
  | "missing"
  /** Enrolled here, but the fee app has them in a different class. */
  | "class-changed"
  /** Enrolled here, but the fee app no longer has the student at all. */
  | "student-gone"
  /** Enrolled here, but the fee app says they have left. */
  | "left-in-fee-app"
  /** Both agree on the class; only the roll number differs. */
  | "roll-changed";

export type Difference = {
  kind: DifferenceKind;
  studentId: string;
  studentName: string;
  admissionNo: string | null;
  /** What the fee app says, where it says anything. */
  feeClassId: string | null;
  /** What this app holds, where it holds anything. */
  enrolmentClassId: string | null;
  detail?: { from: string | null; to: string | null };
};

export const differenceLabels: Record<DifferenceKind, Localized> = {
  missing: t("नामांकन नहीं बना", "No enrolment yet"),
  "class-changed": t("कक्षा बदल गई", "Class changed"),
  "student-gone": t("फ़ीस ऐप में नहीं मिला", "Not in the fee app"),
  "left-in-fee-app": t("फ़ीस ऐप में छोड़ चुके", "Left, per the fee app"),
  "roll-changed": t("रोल नंबर बदला", "Roll number changed"),
};

/**
 * What a difference means, and whether rebuilding fixes it.
 *
 * `student-gone` is the one that does not: a student removed from the fee app
 * still has attendance and marks here, so the row stays and somebody decides.
 */
export const differenceIsFixedByRebuild: Record<DifferenceKind, boolean> = {
  missing: true,
  "class-changed": true,
  "roll-changed": true,
  "left-in-fee-app": true,
  "student-gone": false,
};

export type Reconciliation = {
  differences: Difference[];
  /** Rows that agree on both sides. */
  inAgreement: number;
  feeStudents: number;
  enrolments: number;
};

/**
 * Compare this session's enrolments against the fee app's students.
 *
 * Reports every difference it finds; changes nothing. The rebuild is a
 * separate, deliberate act.
 */
export function reconcile(
  feeStudents: FeeStudent[],
  enrolments: Enrolment[],
): Reconciliation {
  const byStudent = new Map(enrolments.map((row) => [row.studentId, row]));
  const feeById = new Map(feeStudents.map((student) => [student.id, student]));
  const differences: Difference[] = [];
  let inAgreement = 0;

  for (const student of feeStudents) {
    const enrolment = byStudent.get(student.id);
    const active = isActiveFeeStudent(student);

    if (!enrolment) {
      // A child the fee app has and this app has never recorded. Only counts
      // while they are active — a student who left before VPPS One existed is
      // not a gap in the record.
      if (active && student.classId) {
        differences.push({
          kind: "missing",
          studentId: student.id,
          studentName: student.fullName,
          admissionNo: student.admissionNo,
          feeClassId: student.classId,
          enrolmentClassId: null,
        });
      }
      continue;
    }

    if (!active && enrolment.status === "enrolled") {
      differences.push({
        kind: "left-in-fee-app",
        studentId: student.id,
        studentName: student.fullName,
        admissionNo: student.admissionNo,
        feeClassId: student.classId,
        enrolmentClassId: enrolment.classId,
      });
      continue;
    }

    if (student.classId && student.classId !== enrolment.classId) {
      differences.push({
        kind: "class-changed",
        studentId: student.id,
        studentName: student.fullName,
        admissionNo: student.admissionNo,
        feeClassId: student.classId,
        enrolmentClassId: enrolment.classId,
        detail: { from: enrolment.classId, to: student.classId },
      });
      continue;
    }

    if ((student.rollNo ?? null) !== (enrolment.rollNo ?? null)) {
      differences.push({
        kind: "roll-changed",
        studentId: student.id,
        studentName: student.fullName,
        admissionNo: student.admissionNo,
        feeClassId: student.classId,
        enrolmentClassId: enrolment.classId,
        detail: { from: enrolment.rollNo, to: student.rollNo },
      });
      continue;
    }

    inAgreement += 1;
  }

  // The other direction: rows here whose student the fee app no longer has.
  for (const enrolment of enrolments) {
    if (!feeById.has(enrolment.studentId)) {
      differences.push({
        kind: "student-gone",
        studentId: enrolment.studentId,
        studentName: "—",
        admissionNo: null,
        feeClassId: null,
        enrolmentClassId: enrolment.classId,
      });
    }
  }

  return {
    differences,
    inAgreement,
    feeStudents: feeStudents.length,
    enrolments: enrolments.length,
  };
}

export function groupDifferences(
  differences: Difference[],
): { kind: DifferenceKind; items: Difference[] }[] {
  const groups = new Map<DifferenceKind, Difference[]>();

  for (const difference of differences) {
    const list = groups.get(difference.kind) ?? [];
    list.push(difference);
    groups.set(difference.kind, list);
  }

  // A stable order, worst first: a missing child matters more than a roll
  // number, and an unresolvable one needs a person.
  const order: DifferenceKind[] = [
    "student-gone",
    "missing",
    "class-changed",
    "left-in-fee-app",
    "roll-changed",
  ];

  return order
    .filter((kind) => groups.has(kind))
    .map((kind) => ({ kind, items: groups.get(kind)! }));
}

/** How many differences a rebuild would resolve. */
export function fixableCount(differences: Difference[]): number {
  return differences.filter(
    (difference) => differenceIsFixedByRebuild[difference.kind],
  ).length;
}

/* -------------------------------------------------------- the rollup */

export type ClassRoll = {
  feeClass: FeeClass;
  enrolled: number;
};

export function rollByClass(
  classes: FeeClass[],
  enrolments: Enrolment[],
): ClassRoll[] {
  const counts = new Map<string, number>();
  for (const enrolment of enrolments) {
    if (enrolment.status !== "enrolled") continue;
    counts.set(enrolment.classId, (counts.get(enrolment.classId) ?? 0) + 1);
  }

  return classes
    .map((feeClass) => ({ feeClass, enrolled: counts.get(feeClass.id) ?? 0 }))
    .sort((a, b) => a.feeClass.sortOrder - b.feeClass.sortOrder);
}

/**
 * Rows to write for a rebuild, given what the fee app currently says.
 *
 * Pure, so the whole decision is testable without a database: what goes in,
 * what is skipped, and why.
 */
export function planRebuild(
  feeStudents: FeeStudent[],
  sessionLabel: string,
): {
  rows: {
    student_id: string;
    class_id: string;
    session_label: string;
    roll_no: string | null;
    status: EnrolmentStatus;
  }[];
  skippedNoClass: number;
  skippedInactive: number;
} {
  const rows = [];
  let skippedNoClass = 0;
  let skippedInactive = 0;

  for (const student of feeStudents) {
    if (!isActiveFeeStudent(student)) {
      skippedInactive += 1;
      continue;
    }

    if (!student.classId) {
      // A student with no class cannot be enrolled anywhere. Counted and
      // reported rather than guessed at.
      skippedNoClass += 1;
      continue;
    }

    rows.push({
      student_id: student.id,
      class_id: student.classId,
      session_label: sessionLabel,
      roll_no: student.rollNo,
      status: "enrolled" as const,
    });
  }

  return { rows, skippedNoClass, skippedInactive };
}

/**
 * What one change on the fee side (a withdrawal, an undo, a class move, a
 * promotion) means for these children's enrolments.
 *
 * An active child with a class is enrolled in that class for the class's
 * session, which moves them when their class changed and re-enrols them after
 * an undone withdrawal. A child who left is marked left, never deleted: their
 * attendance and marks stay. A graduate is left alone, since their last
 * session's row is the record of the year they finished.
 */
export function planStudentSync(
  students: (FeeStudent & { classSession: string | null })[],
): {
  enrol: { student_id: string; class_id: string; session_label: string; roll_no: string | null; status: "enrolled"; left_on: null }[];
  left: string[];
} {
  const enrol = [];
  const left: string[] = [];
  for (const student of students) {
    const status = (student.status ?? "").toLowerCase();
    if (status === "left" || status === "inactive") {
      left.push(student.id);
      continue;
    }
    if (status === "graduated" || !student.classId || !student.classSession) continue;
    enrol.push({
      student_id: student.id,
      class_id: student.classId,
      session_label: student.classSession,
      roll_no: student.rollNo,
      status: "enrolled" as const,
      left_on: null,
    });
  }
  return { enrol, left };
}
