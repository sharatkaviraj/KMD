import { PERIOD_COUNT } from "@/modules/timetable/domain/parse-timetable";

/**
 * Turning stored slots back into the four grids the school reads (task 2.4):
 * by class, by teacher, by day, and who is free in a given period.
 *
 * Pure, so every one of them is testable against a fixture rather than a
 * database — which matters because these are the screens a teacher looks at
 * every morning, and an off-by-one in a period index is invisible until
 * somebody walks into the wrong room.
 */

export type StoredSlot = {
  day: string;
  period: number;
  classId: string;
  classLabel: string;
  subjectCode: string;
  subjectId: string;
  staffProfileId: string;
  teacherShortName: string;
  parallel: boolean;
  shared: boolean;
};

/** A grid cell: the slots that share one (day, period) for one subject. */
export type GridCell = {
  day: string;
  period: number;
  slots: StoredSlot[];
};

export type Grid = {
  days: string[];
  /** `rows[day][period]` — always `PERIOD_COUNT` long, empty cells included. */
  rows: Record<string, GridCell[]>;
};

function emptyGrid(days: string[]): Grid {
  const rows: Record<string, GridCell[]> = {};
  for (const day of days) {
    rows[day] = Array.from({ length: PERIOD_COUNT }, (_, period) => ({
      day,
      period,
      slots: [],
    }));
  }
  return { days, rows };
}

/**
 * Every period of the week for one class.
 *
 * A parallel cell keeps both its slots in the same grid cell: the class is
 * split into two groups in one room, and a timetable that showed only one of
 * them would send half the children to the wrong place.
 */
export function gridForClass(
  slots: StoredSlot[],
  classId: string,
  days: string[],
): Grid {
  const grid = emptyGrid(days);

  for (const slot of slots) {
    if (slot.classId !== classId) continue;
    const row = grid.rows[slot.day];
    if (!row || !row[slot.period]) continue;
    row[slot.period].slots.push(slot);
  }

  return grid;
}

/**
 * Every period of the week for one teacher.
 *
 * Combined sections collapse: 11 Science, Commerce and Arts sitting one Hindi
 * lesson is one entry with three class labels, not three entries, because it
 * is one room and the teacher is in it once.
 */
export function gridForTeacher(
  slots: StoredSlot[],
  staffProfileId: string,
  days: string[],
): Grid {
  const grid = emptyGrid(days);

  for (const slot of slots) {
    if (slot.staffProfileId !== staffProfileId) continue;
    const row = grid.rows[slot.day];
    if (!row || !row[slot.period]) continue;
    row[slot.period].slots.push(slot);
  }

  return grid;
}

/** Every class's row for one day — the printable day grid. */
export function gridForDay(
  slots: StoredSlot[],
  day: string,
  classIds: string[],
): Record<string, GridCell[]> {
  const rows: Record<string, GridCell[]> = {};

  for (const classId of classIds) {
    rows[classId] = Array.from({ length: PERIOD_COUNT }, (_, period) => ({
      day,
      period,
      slots: [],
    }));
  }

  for (const slot of slots) {
    if (slot.day !== day) continue;
    const row = rows[slot.classId];
    if (!row || !row[slot.period]) continue;
    row[slot.period].slots.push(slot);
  }

  return rows;
}

/**
 * Who is not in a room, for one day and period.
 *
 * `staffIds` is the whole teaching roster, not just the teachers on this
 * timetable: somebody with no periods at all is the *most* free, and deriving
 * the roster from the timetable is exactly the bug the substitution planner
 * in `timetable2025` had to work around with a hard-coded reserve list.
 */
export function freeTeachers(
  slots: StoredSlot[],
  staffIds: string[],
  day: string,
  period: number,
): string[] {
  const busy = new Set(
    slots
      .filter((slot) => slot.day === day && slot.period === period)
      .map((slot) => slot.staffProfileId),
  );

  return staffIds.filter((id) => !busy.has(id));
}

/** How many periods a teacher has, per day and for the week. */
export function teacherLoad(
  slots: StoredSlot[],
  staffProfileId: string,
  days: string[],
): { perDay: Record<string, number>; total: number } {
  const perDay: Record<string, number> = {};
  for (const day of days) perDay[day] = 0;

  // A period is counted once even when it covers three combined sections:
  // the teacher stands in one room for one period.
  const counted = new Set<string>();

  for (const slot of slots) {
    if (slot.staffProfileId !== staffProfileId) continue;
    const key = `${slot.day}:${slot.period}`;
    if (counted.has(key)) continue;
    counted.add(key);
    perDay[slot.day] = (perDay[slot.day] ?? 0) + 1;
  }

  return {
    perDay,
    total: Object.values(perDay).reduce((sum, count) => sum + count, 0),
  };
}

/**
 * A clash: one teacher in two different rooms in the same period.
 *
 * Combined sections are not a clash — they are one room. Nor is a parallel
 * cell, where two teachers share a room but teach different groups. What
 * counts is the same teacher against two different *classes* that are not
 * part of the same cell.
 */
export type Clash = {
  day: string;
  period: number;
  staffProfileId: string;
  teacherShortName: string;
  classLabels: string[];
  subjects: string[];
};

export function findClashes(slots: StoredSlot[]): Clash[] {
  const byTeacherPeriod = new Map<string, StoredSlot[]>();

  for (const slot of slots) {
    const key = `${slot.staffProfileId}:${slot.day}:${slot.period}`;
    const list = byTeacherPeriod.get(key) ?? [];
    list.push(slot);
    byTeacherPeriod.set(key, list);
  }

  const clashes: Clash[] = [];

  for (const group of byTeacherPeriod.values()) {
    if (group.length < 2) continue;

    const subjects = [...new Set(group.map((slot) => slot.subjectCode))];
    const classLabels = [...new Set(group.map((slot) => slot.classLabel))];

    // Same subject in several sections is a combined class, which is one
    // room and not a clash. Different subjects at the same moment is one
    // person expected in two places.
    if (subjects.length === 1) continue;

    clashes.push({
      day: group[0].day,
      period: group[0].period,
      staffProfileId: group[0].staffProfileId,
      teacherShortName: group[0].teacherShortName,
      classLabels,
      subjects,
    });
  }

  return clashes.sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    return a.period - b.period;
  });
}

/**
 * The rollup a publish writes into `teaching_assignments`: one row per
 * (teacher, class, subject), with how many periods a week it is.
 */
export function buildAssignments(
  slots: StoredSlot[],
): {
  staffProfileId: string;
  classId: string;
  subjectId: string;
  periodsPerWeek: number;
}[] {
  const counts = new Map<
    string,
    { staffProfileId: string; classId: string; subjectId: string; periodsPerWeek: number }
  >();

  for (const slot of slots) {
    const key = `${slot.staffProfileId}:${slot.classId}:${slot.subjectId}`;
    const existing = counts.get(key);

    if (existing) {
      existing.periodsPerWeek += 1;
      continue;
    }

    counts.set(key, {
      staffProfileId: slot.staffProfileId,
      classId: slot.classId,
      subjectId: slot.subjectId,
      periodsPerWeek: 1,
    });
  }

  return [...counts.values()];
}
