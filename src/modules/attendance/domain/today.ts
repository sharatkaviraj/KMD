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
