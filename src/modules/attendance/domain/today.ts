import type { RegisterStatus } from "@/modules/attendance/domain/attendance";

/**
 * What a teacher has to do today.
 *
 * The Today card answers one question — "is there anything I have not done?" —
 * and it has to answer it correctly on a morning when the timetable is not
 * published, the calendar says holiday, or the teacher holds no class. Each of
 * those is a different empty screen, and getting them confused tells somebody
 * they are free when they are not.
 *
 * Structural inputs rather than the repo's own types, so this stays a pure
 * module with tests and no database anywhere near it.
 */

export type HeldClass = { classId: string; classLabel: string };

export type PeriodSlot = {
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string;
};

export type ExistingRegister = {
  classId: string;
  period: number | null;
  status: RegisterStatus;
};

export type RegisterTask = {
  classId: string;
  classLabel: string;
  /** Null is the daily register — the one the class teacher takes. */
  period: number | null;
  done: boolean;
};

/**
 * The registers this teacher is expected to take, and whether they are in.
 *
 * Only the daily register, and only for classes they actually hold. The school
 * takes one register a day, so listing a task per period would turn a card
 * that should read "nothing left" into eight rows of noise — and a teacher who
 * learns to ignore the card stops seeing the day they really did miss one.
 */
export function registersDue(input: {
  heldClasses: HeldClass[];
  registers: ExistingRegister[];
  schoolOpen: boolean;
}): RegisterTask[] {
  if (!input.schoolOpen) return [];

  const submitted = new Set(
    input.registers
      .filter((entry) => entry.period === null && entry.status === "submitted")
      .map((entry) => entry.classId),
  );

  return input.heldClasses.map((held) => ({
    classId: held.classId,
    classLabel: held.classLabel,
    period: null,
    done: submitted.has(held.classId),
  }));
}

export function outstanding(tasks: RegisterTask[]): RegisterTask[] {
  return tasks.filter((task) => !task.done);
}

/**
 * Why there is nothing to do, when there is nothing to do.
 *
 * "Everything is done" and "you hold no class" and "school is closed" look
 * identical on a card that only counts rows, and they are not the same news.
 */
export type QuietReason = "closed" | "none-held" | "all-done" | null;

export function quietReason(input: {
  schoolOpen: boolean;
  heldClasses: HeldClass[];
  tasks: RegisterTask[];
}): QuietReason {
  if (!input.schoolOpen) return "closed";
  if (input.heldClasses.length === 0) return "none-held";
  if (input.tasks.every((task) => task.done)) return "all-done";
  return null;
}

/**
 * Today's periods, in the order they are taught.
 *
 * The timetable stores a period number; a sheet that skips a number (a school
 * with no period 4) must not grow a gap row, so this sorts rather than
 * indexes.
 */
export function periodsInOrder(slots: PeriodSlot[]): PeriodSlot[] {
  return [...slots].sort((a, b) => a.period - b.period);
}

/**
 * Which classes a teacher can reach from today's screen.
 *
 * Their own classes first — the ones they hold — then everything they teach
 * today, without repeating a class that appears in both.
 */
export function classesToday(input: {
  heldClasses: HeldClass[];
  slots: PeriodSlot[];
}): HeldClass[] {
  const seen = new Set(input.heldClasses.map((held) => held.classId));
  const extra: HeldClass[] = [];

  for (const slot of input.slots) {
    if (seen.has(slot.classId)) continue;
    seen.add(slot.classId);
    extra.push({ classId: slot.classId, classLabel: slot.classLabel });
  }

  return [...input.heldClasses, ...extra];
}

/* ------------------------------------------------- what the day looks like */

/**
 * One lesson, which is not the same thing as one timetable slot.
 *
 * A subject taught to five classes at once — ELGA, games, assembly — is five
 * rows in `timetable_slots`, because the slot is per class. Rendering them as
 * five rows gave a teacher **twenty entries for an eight-period day** and told
 * her she was in five rooms at 11:00 (B-20). She is in one.
 *
 * So a lesson is a period and a subject, and the classes are a list on it.
 * Two *different* subjects in one period stay two lessons: that is a clash,
 * and merging it would hide the thing worth seeing.
 */
export type Lesson = {
  period: number;
  subjectCode: string;
  classes: HeldClass[];
  /** Set only when the lesson is one class, so a link can be exact. */
  classId: string | null;
};

export function lessonsToday(slots: PeriodSlot[]): Lesson[] {
  const byKey = new Map<string, Lesson>();

  for (const slot of periodsInOrder(slots)) {
    const key = `${slot.period}|${slot.subjectCode}`;
    const existing = byKey.get(key);

    if (existing) {
      // A class can appear twice in one period on a combined sheet; the
      // teacher is still only in one room, and the list should say so once.
      if (!existing.classes.some((entry) => entry.classId === slot.classId)) {
        existing.classes.push({
          classId: slot.classId,
          classLabel: slot.classLabel,
        });
      }
      continue;
    }

    byKey.set(key, {
      period: slot.period,
      subjectCode: slot.subjectCode,
      classes: [{ classId: slot.classId, classLabel: slot.classLabel }],
      classId: slot.classId,
    });
  }

  return [...byKey.values()]
    .map((lesson) => ({
      ...lesson,
      // A combined lesson has no single class to open, and offering one of the
      // five would be picking a room at random.
      classId: lesson.classes.length === 1 ? lesson.classes[0].classId : null,
    }))
    .sort((a, b) => a.period - b.period || a.subjectCode.localeCompare(b.subjectCode, "en"));
}

/**
 * The one thing to do next, or nothing at all.
 *
 * PLAN §1 asks for "one prominent next action" and for a teacher to reach
 * today's attendance in two taps. One action, not a ranked list: a screen that
 * offers three equally-weighted next steps has not decided anything, and the
 * deciding is the part a teacher standing in a corridor cannot do.
 *
 * Registers first because they are the only thing with a deadline measured in
 * minutes. When they are all in, there is deliberately no fallback action —
 * "you are finished" is the most useful thing the screen can say, and
 * inventing a task to fill the space is how it stops being believed.
 */
export type NextAction =
  | { kind: "register"; task: RegisterTask }
  | { kind: "none"; reason: QuietReason };

export function nextAction(input: {
  schoolOpen: boolean;
  heldClasses: HeldClass[];
  tasks: RegisterTask[];
}): NextAction {
  const due = outstanding(input.tasks);

  if (due.length > 0) return { kind: "register", task: due[0] };

  return { kind: "none", reason: quietReason(input) };
}
