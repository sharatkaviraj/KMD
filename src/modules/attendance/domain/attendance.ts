import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * Attendance — the rules, with no database and no React.
 *
 * The screen this serves is the one a teacher uses every single morning, often
 * on a phone with one bar of signal in a corridor. Two things follow, and they
 * shape everything here:
 *
 *  - **marking must never lose work.** Marks are held locally and flushed, so
 *    a tap that happens with no signal is still a tap that happened.
 *  - **submitting twice must be harmless.** A teacher who sees nothing happen
 *    presses again; the second press has to produce the same register, not a
 *    second one.
 */

export const attendanceStatuses = ["present", "absent", "late", "leave"] as const;

export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const attendanceLabels: Record<AttendanceStatus, Localized> = {
  present: t("उपस्थित", "Present"),
  absent: t("अनुपस्थित", "Absent"),
  late: t("देर से", "Late"),
  leave: t("छुट्टी", "Leave"),
};

/** One letter for the register grid and the printed sheet. */
export const attendanceInitials: Record<AttendanceStatus, Localized> = {
  present: t("उ", "P"),
  absent: t("अ", "A"),
  late: t("द", "L"),
  leave: t("छ", "V"),
};

/**
 * Whether a status counts as the child having been in school.
 *
 * `late` does. A child who arrived at 9:15 was in school that day, and a
 * percentage that says otherwise would be wrong in the direction that gets a
 * family a letter they do not deserve. `leave` does not count as present, but
 * it is also not the same as absent — see `countsAgainstAttendance`.
 */
export const COUNTS_AS_PRESENT: Record<AttendanceStatus, boolean> = {
  present: true,
  absent: false,
  late: true,
  leave: false,
};

/**
 * Whether a status counts against the child in the percentage.
 *
 * Approved leave is neither present nor a black mark: it comes out of the
 * denominator entirely, the way the school's paper register works.
 */
export const COUNTS_AGAINST: Record<AttendanceStatus, boolean> = {
  present: false,
  absent: true,
  late: false,
  leave: false,
};

export const registerStatuses = ["open", "submitted"] as const;
export type RegisterStatus = (typeof registerStatuses)[number];

export type AttendanceMark = {
  studentId: string;
  status: AttendanceStatus;
  note: string | null;
};

export type Register = {
  id: string;
  sessionLabel: string;
  classId: string;
  /** ISO date. */
  day: string;
  period: number | null;
  status: RegisterStatus;
  takenBy: string | null;
  onBehalfOf: string | null;
  submittedAt: string | null;
};

/* ------------------------------------------------------- what to show */

export type RollStudent = {
  studentId: string;
  fullName: string;
  admissionNo: string | null;
  rollNo: string | null;
};

/**
 * The order a register is read in.
 *
 * Roll number when the school has one, name otherwise — and a missing roll
 * number sorts last rather than first, because `null` at the top of a register
 * looks like the list is broken.
 */
export function compareRoll(a: RollStudent, b: RollStudent): number {
  const aRoll = rollSortKey(a.rollNo);
  const bRoll = rollSortKey(b.rollNo);

  if (aRoll !== bRoll) return aRoll - bRoll;
  return a.fullName.localeCompare(b.fullName, "en");
}

function rollSortKey(rollNo: string | null): number {
  if (!rollNo) return Number.MAX_SAFE_INTEGER;
  const numeric = Number(rollNo.replace(/\D/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : Number.MAX_SAFE_INTEGER;
}

/* --------------------------------------------------------- the totals */

export type AttendanceTally = {
  present: number;
  absent: number;
  late: number;
  leave: number;
  marked: number;
  total: number;
  /** Everybody on the roll has a mark. */
  complete: boolean;
};

export function tally(
  roll: RollStudent[],
  marks: Map<string, AttendanceStatus>,
): AttendanceTally {
  const counts = { present: 0, absent: 0, late: 0, leave: 0 };

  for (const student of roll) {
    const status = marks.get(student.studentId);
    if (status) counts[status] += 1;
  }

  const marked = counts.present + counts.absent + counts.late + counts.leave;

  return {
    ...counts,
    marked,
    total: roll.length,
    complete: roll.length > 0 && marked === roll.length,
  };
}

/**
 * A child's attendance percentage over a set of marks.
 *
 * Leave is excluded from both halves — it is neither attendance nor absence —
 * so a child who was properly on leave for a week is not punished for it.
 * A denominator of zero returns null rather than 0 or 100: "no data" and
 * "never came" must not look the same.
 */
export function attendancePercent(
  statuses: AttendanceStatus[],
): { percent: number | null; counted: number; present: number } {
  const counted = statuses.filter((status) => status !== "leave").length;
  const present = statuses.filter((status) => COUNTS_AS_PRESENT[status]).length;

  if (counted === 0) return { percent: null, counted: 0, present };

  return {
    percent: Math.round((present / counted) * 1000) / 10,
    counted,
    present,
  };
}

/* ------------------------------------------------- the offline queue */

/**
 * A marking session as the browser holds it while the teacher works.
 *
 * Kept as a plain value so the queue's rules are testable without a browser:
 * what merges, what wins, and what a retry does.
 */
export type QueuedRegister = {
  /**
   * Identifies this marking session across retries.
   *
   * Generated once when the teacher opens the register and reused for every
   * flush. It is what lets the server recognise the second attempt as the same
   * one — together with the unique index on (session, class, day, period),
   * which is the guarantee that actually holds.
   */
  clientId: string;
  classId: string;
  day: string;
  period: number | null;
  marks: Record<string, { status: AttendanceStatus; note: string | null }>;
  /** Set when the teacher pressed submit; a queue may hold unsubmitted work. */
  submitted: boolean;
  /** Epoch ms, for ordering two queued versions of the same register. */
  updatedAt: number;
};

export const QUEUE_KEY = "vppsone.attendance.queue.v1";

/**
 * Merge a newly marked register into whatever the queue already holds.
 *
 * Last write wins *per student*, not per register: a teacher who marks twenty
 * children, loses signal, and marks the last ten must not lose the first
 * twenty when the two versions merge.
 */
export function mergeQueued(
  existing: QueuedRegister | undefined,
  incoming: QueuedRegister,
): QueuedRegister {
  if (!existing) return incoming;

  // Different marking sessions for the same class and day: the newer one is
  // the one the teacher is looking at.
  if (existing.clientId !== incoming.clientId) {
    return existing.updatedAt > incoming.updatedAt ? existing : incoming;
  }

  return {
    ...incoming,
    marks: { ...existing.marks, ...incoming.marks },
    // Once submitted, it stays submitted: a later unsubmitted edit is still
    // work to flush, but it must not un-submit a register the teacher
    // believes they have already handed in.
    submitted: existing.submitted || incoming.submitted,
    updatedAt: Math.max(existing.updatedAt, incoming.updatedAt),
  };
}

export function queueKeyFor(classId: string, day: string, period: number | null) {
  return `${classId}:${day}:${period ?? "daily"}`;
}

/** Everything still waiting to reach the server, oldest first. */
export function pendingFlushes(
  queue: Record<string, QueuedRegister>,
): QueuedRegister[] {
  return Object.values(queue).sort((a, b) => a.updatedAt - b.updatedAt);
}

/* ------------------------------------------------------- validation */

export const markSchema = z.object({
  studentId: z.uuid(),
  status: z.enum(attendanceStatuses),
  note: z
    .string()
    .trim()
    .max(200, {
      message: encodeMessage(t("टिप्पणी बहुत लंबी है", "That note is too long")),
    })
    .transform((value) => (value === "" ? null : value))
    .nullable(),
});

export const submitRegisterSchema = z.object({
  sessionLabel: z.string().trim().min(1).max(40).optional(),
  classId: z.uuid({ message: encodeMessage(t("कक्षा चुनें", "Choose a class")) }),
  day: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, {
      message: encodeMessage(t("तारीख़ चुनें", "Choose a date")),
    }),
  period: z.number().int().min(0).max(15).nullable(),
  marks: z.array(markSchema).min(1, {
    message: encodeMessage(
      t("कम से कम एक बच्चे को दर्ज करें", "Mark at least one child"),
    ),
  }),
  submit: z.boolean(),
});

export type SubmitRegisterInput = z.infer<typeof submitRegisterSchema>;

/**
 * Whether this staff member may mark this class today.
 *
 * `attendance:mark` says a teacher may mark attendance; it does not say
 * *whose*. This is the row-level half — "own classes" — and it is the piece a
 * permission alone cannot express (see the note atop `permissions.ts`).
 */
export function canMarkClass(input: {
  hasMarkPermission: boolean;
  hasMarkOnBehalfPermission: boolean;
  /** Class ids this staff member teaches or is class teacher of. */
  ownClassIds: string[];
  classId: string;
}): { allowed: boolean; onBehalf: boolean; reason?: Localized } {
  const isOwn = input.ownClassIds.includes(input.classId);

  if (input.hasMarkPermission && isOwn) {
    return { allowed: true, onBehalf: false };
  }

  // The office marking for a teacher who could not. A different act, recorded
  // differently — `on_behalf_of` on the register says so.
  if (input.hasMarkOnBehalfPermission) {
    return { allowed: true, onBehalf: true };
  }

  if (input.hasMarkPermission && !isOwn) {
    return {
      allowed: false,
      onBehalf: false,
      reason: t(
        "यह आपकी कक्षा नहीं है।",
        "This is not one of your classes. Ask the office to record it.",
      ),
    };
  }

  return {
    allowed: false,
    onBehalf: false,
    reason: t(
      "आपको उपस्थिति दर्ज करने की अनुमति नहीं है।",
      "You do not have permission to record attendance.",
    ),
  };
}

/**
 * Whether a register may still be edited directly.
 *
 * A submitted register is a record. Changing it is a correction request
 * (task 3.3), which carries a reason and a name.
 */
export function isEditable(register: Register | null): boolean {
  return register === null || register.status === "open";
}
