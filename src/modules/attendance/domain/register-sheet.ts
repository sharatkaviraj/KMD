import {
  attendancePercent,
  compareRoll,
  dayCredit,
  DEFAULT_ATTENDANCE_RULES,
  type AttendanceRules,
  type AttendanceStatus,
  type RollStudent,
} from "@/modules/attendance/domain/attendance";

/**
 * The monthly register — the paper sheet, as a value.
 *
 * One row per child, one column per day, a letter in each cell. It is the
 * artefact the school already keeps by hand and the one an inspector asks for,
 * so the layout is not a design decision: it is a transcription.
 *
 * Built here rather than in the page because the interesting parts are rules,
 * not markup — which days get a column, what an empty cell means, and how a
 * percentage is arrived at — and rules deserve tests.
 */

export type SheetCell = AttendanceStatus | null;

export type SheetRow = {
  student: RollStudent;
  cells: SheetCell[];
  present: number;
  absent: number;
  half_day: number;
  late: number;
  leave: number;
  /** Null when there is nothing to divide by — never 0, never 100. */
  percent: number | null;
};

export type MonthlySheet = {
  month: string;
  /** The columns, in order. */
  days: string[];
  rows: SheetRow[];
  /** Days with at least one mark — the honest denominator for the class. */
  daysRecorded: number;
};

/**
 * Which days get a column.
 *
 * The union of "school was open" and "somebody took a register", not either
 * alone:
 *
 *  - open days with no register are the interesting gap — a blank column is
 *    how a head of school sees that Tuesday was missed;
 *  - a register taken on a day the calendar calls closed is still a fact about
 *    the children, and dropping the column would silently delete marks from
 *    the sheet.
 */
export function sheetDays(
  openDays: string[],
  markedDays: Iterable<string>,
): string[] {
  return [...new Set([...openDays, ...markedDays])].sort();
}

export function buildMonthlySheet(input: {
  month: string;
  roll: RollStudent[];
  openDays: string[];
  marks: { studentId: string; day: string; status: AttendanceStatus }[];
  /** How a half day counts — the school's rule for the session (P6). */
  rules?: AttendanceRules;
}): MonthlySheet {
  const rules = input.rules ?? DEFAULT_ATTENDANCE_RULES;
  const byStudent = new Map<string, Map<string, AttendanceStatus>>();

  for (const mark of input.marks) {
    const days = byStudent.get(mark.studentId) ?? new Map();
    days.set(mark.day, mark.status);
    byStudent.set(mark.studentId, days);
  }

  const days = sheetDays(
    input.openDays,
    input.marks.map((mark) => mark.day),
  );

  const rows = [...input.roll].sort(compareRoll).map((student) => {
    const marked = byStudent.get(student.studentId);
    const cells = days.map<SheetCell>((day) => marked?.get(day) ?? null);
    const statuses = cells.filter((cell): cell is AttendanceStatus => cell !== null);

    const counts = { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 };
    for (const status of statuses) counts[status] += 1;

    return {
      student,
      cells,
      ...counts,
      percent: attendancePercent(statuses, rules).percent,
    };
  });

  return {
    month: input.month,
    days,
    rows,
    daysRecorded: new Set(input.marks.map((mark) => mark.day)).size,
  };
}

/**
 * The class's attendance over the month.
 *
 * Marks, not children × days: a child with no mark on a day was not recorded,
 * and counting that as an absence would invent absences out of a teacher's
 * forgotten register.
 */
export function sheetTotals(
  sheet: MonthlySheet,
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
): {
  present: number;
  absent: number;
  half_day: number;
  late: number;
  leave: number;
  percent: number | null;
} {
  const totals = { present: 0, absent: 0, half_day: 0, late: 0, leave: 0 };

  for (const row of sheet.rows) {
    totals.present += row.present;
    totals.absent += row.absent;
    totals.half_day += row.half_day;
    totals.late += row.late;
    totals.leave += row.leave;
  }

  // The same rule as a child's own percentage: leave out of both halves, a
  // half day at the school's credit.
  const counted = totals.present + totals.absent + totals.half_day + totals.late;
  const attended = totals.present + totals.late + totals.half_day * rules.halfDayCredit;

  return {
    ...totals,
    percent: counted === 0 ? null : Math.round((attended / counted) * 1000) / 10,
  };
}

/**
 * Children whose attendance is below a threshold.
 *
 * The one derived number a class teacher actually acts on. Rows with no marks
 * at all are left out — "no data" is not "below 75%".
 */
export function belowThreshold(
  sheet: MonthlySheet,
  threshold: number,
): SheetRow[] {
  return sheet.rows.filter(
    (row) => row.percent !== null && row.percent < threshold,
  );
}

/** How many days a set of statuses is worth under the school's rule. */
export function attendedDays(
  statuses: AttendanceStatus[],
  rules: AttendanceRules = DEFAULT_ATTENDANCE_RULES,
): number {
  return statuses.reduce((sum, status) => sum + (dayCredit(status, rules) ?? 0), 0);
}
