import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * Attendance — the rules, with no database and no React.
 *
 * The screen this serves is the one a teacher uses every single morning, often
 * on a phone with one bar of signal in a corridor. Three things follow (P6):
 *
 *  - **nothing is recorded until somebody saves.** Opening the roll writes
 *    nothing; every child shows as present only as a preview of what Save
 *    will record. An unsaved register is outstanding, never "all present".
 *  - **a save is the whole roll for that date.** Every child exactly once, or
 *    the server refuses and says who joined or left in the meantime.
 *  - **pressing twice, or losing the answer, is harmless.** The browser mints
 *    one submission id per save; a repeat gets the first receipt back, and a
 *    lost answer is asked about before anything is sent again. Marks waiting
 *    on a phone are kept, but never replayed without a person pressing Save.
 */

export const attendanceStatuses = ["present", "absent", "half_day", "late", "leave"] as const;

export type AttendanceStatus = (typeof attendanceStatuses)[number];

export const attendanceLabels: Record<AttendanceStatus, Localized> = {
  present: t("उपस्थित", "Present"),
  absent: t("अनुपस्थित", "Absent"),
  half_day: t("आधा दिन", "Half day"),
  late: t("देर से", "Late"),
  leave: t("छुट्टी", "Leave"),
};

/** One letter for the register grid and the printed sheet. */
export const attendanceInitials: Record<AttendanceStatus, Localized> = {
  present: t("उ", "P"),
  absent: t("अ", "A"),
  half_day: t("आ", "H"),
  late: t("द", "L"),
  leave: t("छ", "V"),
};

/**
 * How the school counts a day. Per session, from `vppsone.attendance_rules`;
 * a half day is half unless the school says otherwise (P6).
 */
export type AttendanceRules = { halfDayCredit: number };

export const DEFAULT_ATTENDANCE_RULES: AttendanceRules = { halfDayCredit: 0.5 };

/**
 * How much of a day each status is worth, or null when it is not counted.
 *
 * `late` is a whole day. A child who arrived at 9:15 was in school that day,
 * and a percentage that says otherwise would be wrong in the direction that
 * gets a family a letter they do not deserve. `half_day` is the school's
 * credit. `leave` is out of both halves — neither present nor a black mark,
 * the way the school's paper register works.
 */
export function dayCredit(
  status: AttendanceStatus,
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
): number | null {
  switch (status) {
    case "present":
    case "late":
      return 1;
    case "half_day":
      return rules.halfDayCredit;
    case "absent":
      return 0;
    case "leave":
      return null;
  }
}

/** Whether a status puts the child in school at all, for "who was here today". */
export function wasInSchool(status: AttendanceStatus): boolean {
  return status === "present" || status === "late" || status === "half_day";
}

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
  /** 0 until the first save; each save or correction adds one. */
  revision: number;
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
  half_day: number;
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
  const counts = { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 };

  for (const student of roll) {
    const status = marks.get(student.studentId);
    if (status) counts[status] += 1;
  }

  const marked = counts.present + counts.absent + counts.half_day + counts.late + counts.leave;

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
 * so a child who was properly on leave for a week is not punished for it. A
 * half day adds the school's credit. A denominator of zero returns null rather
 * than 0 or 100: "no data" and "never came" must not look the same.
 *
 * `present` is the days credited, so it can be a half: 17.5 of 20.
 */
export function attendancePercent(
  statuses: AttendanceStatus[],
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
): { percent: number | null; counted: number; present: number } {
  let counted = 0;
  let present = 0;
  for (const status of statuses) {
    const credit = dayCredit(status, rules);
    if (credit === null) continue;
    counted += 1;
    present += credit;
  }

  if (counted === 0) return { percent: null, counted: 0, present };

  return {
    percent: Math.round((present / counted) * 1000) / 10,
    counted,
    present,
  };
}

/* ------------------------------------------------------- validation */

/**
 * One save of one daily register, as the browser sends it (P6).
 *
 * `commandId` is minted once per save and reused on every retry of it.
 * `expectedRevision` is the revision the page showed — 0 for a register
 * never saved — so a register somebody else saved meanwhile is refused as
 * stale rather than overwritten. A correction carries a reason.
 */
export const saveRegisterSchema = z
  .object({
    commandId: z.uuid(),
    classId: z.uuid({ message: encodeMessage(t("कक्षा चुनें", "Choose a class")) }),
    day: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, {
        message: encodeMessage(t("तारीख़ चुनें", "Choose a date")),
      }),
    kind: z.enum(["save", "correction"]),
    expectedRevision: z.number().int().min(0),
    reason: z
      .string()
      .trim()
      .max(200, { message: encodeMessage(t("कारण बहुत लंबा है", "That reason is too long")) })
      .nullish()
      .transform((value) => (value ? value : null)),
    marks: z
      .array(z.object({ studentId: z.uuid(), status: z.enum(attendanceStatuses) }))
      .min(1, {
        message: encodeMessage(t("कक्षा में कोई बच्चा नहीं", "The class has nobody on its roll")),
      }),
  })
  .refine((value) => value.kind === "save" || value.reason !== null, {
    message: encodeMessage(t("सुधार का कारण लिखें", "Say why you are correcting it")),
    path: ["reason"],
  });

export type SaveRegisterInput = z.infer<typeof saveRegisterSchema>;

/**
 * What this person may do with a class's daily register (P6).
 *
 * The register belongs to the class teacher, or the assistant, as of today —
 * a former one does not keep it, and corrects it directly with a reason; no
 * admin approves it (D-248). The office may record it on the class teacher's
 * behalf and may correct any register; a subject teacher may read the classes
 * she teaches, but not take or change the register. The database applies the
 * same rule again when it saves.
 */
export function registerAuthority(input: {
  /** Class teacher or assistant of this class today. */
  isOwner: boolean;
  hasMarkPermission: boolean;
  hasMarkOnBehalfPermission: boolean;
  hasCorrectPermission: boolean;
}): { save: boolean; correct: boolean; onBehalf: boolean; reason?: Localized } {
  const owner = input.isOwner && input.hasMarkPermission;
  const save = owner || input.hasMarkOnBehalfPermission;
  const correct = owner || input.hasCorrectPermission;

  if (save || correct) {
    return { save, correct, onBehalf: !owner && input.hasMarkOnBehalfPermission };
  }

  return {
    save: false,
    correct: false,
    onBehalf: false,
    reason: input.hasMarkPermission
      ? t(
          "दैनिक उपस्थिति कक्षा-अध्यापक लेते हैं। गलती दिखे तो कक्षा-अध्यापक को बताएँ — वे खुद सुधार सकते हैं।",
          "The class teacher takes this register. If something is wrong, tell the class teacher — they can correct it themselves.",
        )
      : t(
          "आपको उपस्थिति दर्ज करने की अनुमति नहीं है।",
          "You do not have permission to record attendance.",
        ),
  };
}

/** Recorded means saved at least once: revision 1 or more. */
export function isRecorded(register: { revision: number } | null): boolean {
  return register !== null && register.revision >= 1;
}
