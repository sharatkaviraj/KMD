/**
 * The timetable parser, ported from `timetable2025/scripts/data.js`.
 *
 * This code has run the school's timetable for a year. It is ported with its
 * behaviour intact and its counts pinned by fixture tests
 * (`tests/parse-timetable.test.ts`), because a parser that has been right
 * every day since last April is evidence and a rewrite is a guess (rule 4).
 *
 * What changed in the port:
 *   - TypeScript types instead of duck-typed objects;
 *   - `parseTimetable` reports *problems* rather than silently accepting a
 *     malformed line, because task 2.2 has to show the school what is wrong
 *     with a sheet before anybody publishes it;
 *   - `SHORT_SUBJECTS` is not here at all. It belongs at render time, and
 *     applying it while parsing produces labels that match no subject row
 *     (docs/SOURCES.md says so in as many words).
 *
 * What did not change: the cell grammar, the parallel-versus-shared rule, and
 * the combined-section merging in `buildTeacherMap`.
 */

export const PERIOD_COUNT = 8;

/** A cell is `Subject (Teacher)`, `Subject (A / B)`, `Free`, or blank. */
const CELL_PATTERN = /^(.*)\(([^)]*)\)\s*$/;

export type TimetableCell = {
  /** The whole subject text as written: "Biology / Maths". */
  subject: string;
  teachers: string[];
  /** Nobody is teaching this period. */
  free: boolean;
  /**
   * Two lessons side by side, one cohort each.
   *
   * `Biology / Maths (Hemlata / Prateek)` — if Hemlata is away, her Biology
   * group needs cover, because Prateek is busy teaching Maths. Contrast with
   * `ELGA (Bindu / Anita / Rashmita / Kusum / Ravina)`, which is one lesson
   * with five teachers: the rest absorb it.
   *
   * A cell is parallel when the subject splits into exactly as many parts as
   * it has teachers. That one rule is what decides whether an absence needs a
   * substitute, which is why it is recorded rather than re-derived.
   */
  parallel: boolean;
  /** The split subjects, when parallel. Same length as `teachers`. */
  subjects: string[];
};

export type ParseProblem = {
  /** 1-based, as a person counting lines in a spreadsheet would. */
  line: number;
  kind:
    | "no-day-header"
    | "wrong-column-count"
    | "duplicate-class-in-day"
    | "unclosed-bracket"
    | "empty-teacher";
  detail: string;
};

export type ParsedTimetable = {
  days: string[];
  /** `timetable[day][className][periodIndex]` */
  timetable: Record<string, Record<string, TimetableCell[]>>;
  classNames: string[];
  /** Every teacher named anywhere, sorted. The teaching roster. */
  teacherNames: string[];
  /** Every subject label seen, sorted. Includes each half of a parallel cell. */
  subjectNames: string[];
  problems: ParseProblem[];
  /** Total cells, including free ones. */
  cellCount: number;
};

function freeCell(): TimetableCell {
  return { subject: "Free", teachers: [], free: true, parallel: false, subjects: [] };
}

/**
 * One cell of the grid.
 *
 * Exported because task 2.2 resolves cells one at a time against master data,
 * and because it is the piece most worth testing directly.
 */
export function parseCell(raw: string): TimetableCell {
  const cell = raw.trim();

  if (!cell || cell.toLowerCase() === "free") {
    return freeCell();
  }

  const match = CELL_PATTERN.exec(cell);

  if (!match) {
    // A subject with no teacher in brackets. Kept rather than dropped: the
    // sheet says something happens this period, and task 2.2 reports it.
    return { subject: cell, teachers: [], free: false, parallel: false, subjects: [] };
  }

  const subject = match[1].trim();
  const teachers = match[2]
    .split("/")
    .map((name) => name.trim())
    .filter(Boolean);
  const subjects = subject
    .split(" / ")
    .map((name) => name.trim())
    .filter(Boolean);

  // The rule. Equal counts means one lesson each; anything else means one
  // lesson shared.
  if (subjects.length > 1 && subjects.length === teachers.length) {
    return { subject, teachers, free: false, parallel: true, subjects };
  }

  return { subject, teachers, free: false, parallel: false, subjects: [] };
}

/**
 * Parse the whole sheet.
 *
 * The format is the school's own: a bare line names a day, a `Class,…` line is
 * a header to skip, and everything else is a class row of `PERIOD_COUNT`
 * cells.
 */
export function parseTimetable(raw: string): ParsedTimetable {
  const days: string[] = [];
  const timetable: Record<string, Record<string, TimetableCell[]>> = {};
  const classNames: string[] = [];
  const teacherSet = new Set<string>();
  const subjectSet = new Set<string>();
  const problems: ParseProblem[] = [];
  let currentDay: string | null = null;
  let cellCount = 0;

  const lines = String(raw).split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const text = line.trim();
    if (!text) return;

    // A line with no comma is a day header.
    if (!text.includes(",")) {
      currentDay = text;
      if (!days.includes(text)) days.push(text);
      timetable[text] = timetable[text] ?? {};
      return;
    }

    if (text.startsWith("Class,")) return;

    if (!currentDay) {
      problems.push({
        line: lineNumber,
        kind: "no-day-header",
        detail: text.split(",")[0],
      });
      return;
    }

    const columns = text.split(",");
    const className = columns[0].trim();
    const cells = columns.slice(1, PERIOD_COUNT + 1);

    if (cells.length !== PERIOD_COUNT) {
      // Reported, and still parsed as far as it goes: a sheet with one short
      // row should show that one row, not fail entirely.
      problems.push({
        line: lineNumber,
        kind: "wrong-column-count",
        detail: `${className}: ${cells.length} of ${PERIOD_COUNT}`,
      });
    }

    if (timetable[currentDay][className]) {
      problems.push({
        line: lineNumber,
        kind: "duplicate-class-in-day",
        detail: `${className} on ${currentDay}`,
      });
    }

    if (!classNames.includes(className)) classNames.push(className);

    const parsed: TimetableCell[] = [];
    for (let period = 0; period < PERIOD_COUNT; period += 1) {
      const rawCell = cells[period] ?? "";
      const cell = parseCell(rawCell);
      parsed.push(cell);
      cellCount += 1;

      const trimmed = rawCell.trim();
      // An opening bracket with no closing one is a truncated cell — the
      // teacher's name is simply gone, and nothing downstream would notice.
      if (trimmed.includes("(") && !trimmed.includes(")")) {
        problems.push({
          line: lineNumber,
          kind: "unclosed-bracket",
          detail: `${className} P${period + 1}: ${trimmed}`,
        });
      }

      if (!cell.free && cell.teachers.length === 0 && trimmed.includes("(")) {
        problems.push({
          line: lineNumber,
          kind: "empty-teacher",
          detail: `${className} P${period + 1}: ${trimmed}`,
        });
      }

      if (!cell.free) {
        // Each half of a parallel cell is its own subject; a shared cell has
        // one. This is the list task 2.2 resolves against `vppsone.subjects`.
        if (cell.parallel) {
          cell.subjects.forEach((name) => subjectSet.add(name));
        } else {
          subjectSet.add(cell.subject);
        }
      }

      cell.teachers.forEach((teacher) => teacherSet.add(teacher));
    }

    timetable[currentDay][className] = parsed;
  });

  return {
    days,
    timetable,
    classNames,
    teacherNames: [...teacherSet].sort(),
    subjectNames: [...subjectSet].sort(),
    problems,
    cellCount,
  };
}

/* ---------------------------------------------------------- teacher map */

export type TeacherSlot = {
  className: string;
  /** This teacher's own subject — their half of a parallel cell. */
  subject: string;
  /**
   * Co-taught with others, so an absence can be absorbed rather than covered.
   * A parallel elective is *not* shared in this sense.
   */
  shared: boolean;
  /**
   * The other sections sitting in the same room for the same period.
   *
   * The senior school sits 11 Science, Commerce and Arts together for Hindi
   * and English. That is one room and one cover teacher, so it stays one slot
   * — but every one of those class timetables has to name the cover, which is
   * what this list is for.
   */
  alsoClassNames: string[];
};

export type TeacherMap = Record<string, Record<string, (TeacherSlot | null)[]>>;

export function buildTeacherMap(parsed: ParsedTimetable): TeacherMap {
  const map: TeacherMap = {};

  for (const teacher of parsed.teacherNames) {
    map[teacher] = {};
    for (const day of parsed.days) {
      map[teacher][day] = new Array(PERIOD_COUNT).fill(null);
    }
  }

  for (const day of parsed.days) {
    for (const className of parsed.classNames) {
      const row = parsed.timetable[day]?.[className];
      if (!row) continue;

      row.forEach((cell, period) => {
        cell.teachers.forEach((teacher, teacherIndex) => {
          if (!map[teacher]) return;

          const subject = cell.parallel ? cell.subjects[teacherIndex] : cell.subject;
          const shared = !cell.parallel && cell.teachers.length > 1;
          const slot = map[teacher][day][period];

          if (!slot) {
            map[teacher][day][period] = {
              className,
              subject,
              shared,
              alsoClassNames: [],
            };
            return;
          }

          // Same teacher, same subject, same period, another section — a
          // combined class. Shared blocks are excluded: the five ELGA
          // teachers are running one primary-wide activity, not teaching
          // Class 1 and four others at once.
          if (
            !shared &&
            !slot.shared &&
            slot.subject === subject &&
            slot.className !== className &&
            !slot.alsoClassNames.includes(className)
          ) {
            slot.alsoClassNames.push(className);
          }
        });
      });
    }
  }

  return map;
}

/* --------------------------------------------------------------- counts */

export type TimetableCounts = {
  cells: number;
  free: number;
  taught: number;
  parallel: number;
  shared: number;
  days: number;
  classes: number;
  teachers: number;
  subjects: number;
};

/**
 * The numbers a person checks a sheet by.
 *
 * `docs/SOURCES.md` pins the 2026-27 fixture at 768 cells, 30 parallel, 60
 * shared, 19 teachers and 23 subject labels. Task 2.2 shows these next to the
 * previous version's so a re-upload that silently loses a day is visible.
 */
export function countTimetable(parsed: ParsedTimetable): TimetableCounts {
  let free = 0;
  let parallel = 0;
  let shared = 0;

  for (const day of parsed.days) {
    for (const className of parsed.classNames) {
      const row = parsed.timetable[day]?.[className];
      if (!row) continue;

      for (const cell of row) {
        if (cell.free) free += 1;
        if (cell.parallel) parallel += 1;
        if (!cell.parallel && cell.teachers.length > 1) shared += 1;
      }
    }
  }

  return {
    cells: parsed.cellCount,
    free,
    taught: parsed.cellCount - free,
    parallel,
    shared,
    days: parsed.days.length,
    classes: parsed.classNames.length,
    teachers: parsed.teacherNames.length,
    subjects: parsed.subjectNames.length,
  };
}

/**
 * Every (day, class, period) a teacher is not in a room.
 *
 * The basis of "who is free in period 4" (task 2.4) and of the substitution
 * planner (Phase 4).
 */
export function freePeriodsFor(
  map: TeacherMap,
  teacher: string,
  day: string,
): number[] {
  const row = map[teacher]?.[day];
  if (!row) return [];

  const free: number[] = [];
  row.forEach((slot, period) => {
    if (!slot) free.push(period);
  });
  return free;
}

export function teachersFreeIn(
  map: TeacherMap,
  day: string,
  period: number,
): string[] {
  return Object.keys(map)
    .filter((teacher) => map[teacher][day] && !map[teacher][day][period])
    .sort();
}
