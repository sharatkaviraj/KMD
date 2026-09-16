import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildTeacherMap,
  parseTimetable,
  PERIOD_COUNT,
} from "@/modules/timetable/domain/parse-timetable";
import {
  buildContext,
  FIX_SCREEN,
  groupByFixScreen,
  MISSING_HINT,
  resolveImport,
} from "@/modules/timetable/domain/resolve-import";
import {
  buildAssignments,
  findClashes,
  freeTeachers,
  gridForClass,
  gridForDay,
  gridForTeacher,
  teacherLoad,
  type StoredSlot,
} from "@/modules/timetable/domain/views";

const fixture = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures/timetable-2026-27.csv",
  ),
  "utf8",
);

const parsed = parseTimetable(fixture);

/**
 * Master data that resolves the fixture completely: every class label, every
 * teacher short name and every subject the sheet uses.
 *
 * Built from the parse rather than typed out, because the point of these
 * tests is the resolver's behaviour, not a transcription of 19 names.
 */
const completeContext = buildContext({
  classAliases: parsed.classNames.map((label, index) => ({
    timetableLabel: label,
    classId: `class-${index}`,
  })),
  teachers: parsed.teacherNames.map((shortName, index) => ({
    shortName,
    id: `staff-${index}`,
  })),
  subjects: parsed.subjectNames.map((code, index) => ({
    code,
    id: `subject-${index}`,
  })),
});

describe("resolveImport() against complete master data", () => {
  const report = resolveImport(parsed, completeContext);

  it("resolves the whole sheet", () => {
    expect(report.missing).toEqual([]);
    expect(report.counts.unresolved).toBe(0);
  });

  it("says it can be published", () => {
    expect(report.canPublish).toBe(true);
  });

  it("produces one slot per teacher per cell", () => {
    // A shared ELGA cell with five teachers becomes five slots; a parallel
    // cell with two becomes two. Every one is a person in a room.
    let expected = 0;
    for (const day of parsed.days) {
      for (const className of parsed.classNames) {
        for (const cell of parsed.timetable[day][className]) {
          expected += cell.teachers.length;
        }
      }
    }
    expect(report.slots).toHaveLength(expected);
  });

  it("gives each half of a parallel cell its own subject", () => {
    const parallel = report.slots.filter((slot) => slot.parallel);
    expect(parallel.length).toBeGreaterThan(0);
    // "Biology / Maths" must never survive as one subject code.
    expect(parallel.every((slot) => !slot.subjectCode.includes(" / "))).toBe(true);
  });

  it("flags shared slots without flagging parallel ones", () => {
    const shared = report.slots.filter((slot) => slot.shared);
    expect(shared.length).toBeGreaterThan(0);
    expect(shared.every((slot) => !slot.parallel)).toBe(true);
  });

  it("accounts for every cell", () => {
    // The school's real sheet has no free periods at all — all 768 cells are
    // taught. That is a fact about this timetable, not about the parser, so
    // it is asserted rather than assumed either way.
    expect(report.counts.cells).toBe(768);
    expect(report.counts.free).toBe(0);
    expect(report.counts.unresolved).toBe(0);
  });

  it("counts a free period as neither resolved nor a problem", () => {
    const withFree = parseTimetable(
      "Monday\nClass 1,Maths (Bindu),Free,,,,,,",
    );
    const result = resolveImport(
      withFree,
      buildContext({
        classAliases: [{ timetableLabel: "Class 1", classId: "c1" }],
        teachers: [{ shortName: "Bindu", id: "s1" }],
        subjects: [{ code: "Maths", id: "sub1" }],
      }),
    );

    // Seven free cells (one "Free" plus six blanks), one taught, nothing
    // unresolved — a free period is not a gap in the master data.
    expect(result.counts.free).toBe(7);
    expect(result.counts.unresolved).toBe(0);
    expect(result.canPublish).toBe(true);
  });
});

describe("resolveImport() when master data is missing", () => {
  it("reports an unknown teacher once, with a cell count", () => {
    const context = buildContext({
      classAliases: parsed.classNames.map((label, i) => ({
        timetableLabel: label,
        classId: `c${i}`,
      })),
      // Everybody except Bindu.
      teachers: parsed.teacherNames
        .filter((name) => name !== "Bindu")
        .map((shortName, i) => ({ shortName, id: `s${i}` })),
      subjects: parsed.subjectNames.map((code, i) => ({ code, id: `sub${i}` })),
    });

    const report = resolveImport(parsed, context);
    const teacherMisses = report.missing.filter((item) => item.kind === "teacher");

    expect(teacherMisses).toHaveLength(1);
    expect(teacherMisses[0].name).toBe("Bindu");
    // Collapsed into one entry, but the count says how much of the sheet is
    // blocked by it.
    expect(teacherMisses[0].cells).toBeGreaterThan(1);
    expect(report.canPublish).toBe(false);
  });

  it("gives a couple of places to look, not all of them", () => {
    const context = buildContext({
      classAliases: parsed.classNames.map((label, i) => ({
        timetableLabel: label,
        classId: `c${i}`,
      })),
      teachers: [],
      subjects: parsed.subjectNames.map((code, i) => ({ code, id: `sub${i}` })),
    });

    const report = resolveImport(parsed, context);
    for (const item of report.missing) {
      expect(item.examples.length).toBeGreaterThan(0);
      expect(item.examples.length).toBeLessThanOrEqual(3);
    }
  });

  it("reports an unmapped class without also reporting its every subject", () => {
    // A class with no label blocks the whole row. Listing all eight of its
    // subjects as missing too would bury the one thing to fix.
    const context = buildContext({
      classAliases: parsed.classNames
        .filter((name) => name !== "Class 1")
        .map((label, i) => ({ timetableLabel: label, classId: `c${i}` })),
      teachers: parsed.teacherNames.map((shortName, i) => ({ shortName, id: `s${i}` })),
      subjects: parsed.subjectNames.map((code, i) => ({ code, id: `sub${i}` })),
    });

    const report = resolveImport(parsed, context);
    expect(report.missing.filter((item) => item.kind === "class")).toHaveLength(1);
    expect(report.missing.filter((item) => item.kind === "subject")).toEqual([]);
  });

  it("keeps resolving after the first thing it cannot find", () => {
    // A dry run that stopped at the first unknown name would make the school
    // fix one, re-upload, and find the next — nineteen times.
    const report = resolveImport(
      parsed,
      buildContext({ classAliases: [], teachers: [], subjects: [] }),
    );
    expect(report.missing.length).toBeGreaterThan(1);
  });

  it("matches master data case-insensitively", () => {
    // Every unique index behind these is case-insensitive, so a sheet written
    // "MATHS" must match a subject coded "Maths".
    const context = buildContext({
      classAliases: parsed.classNames.map((label, i) => ({
        timetableLabel: label.toUpperCase(),
        classId: `c${i}`,
      })),
      teachers: parsed.teacherNames.map((shortName, i) => ({
        shortName: shortName.toUpperCase(),
        id: `s${i}`,
      })),
      subjects: parsed.subjectNames.map((code, i) => ({
        code: code.toUpperCase(),
        id: `sub${i}`,
      })),
    });

    expect(resolveImport(parsed, context).missing).toEqual([]);
  });

  it("orders classes before teachers before subjects", () => {
    const report = resolveImport(
      parsed,
      buildContext({ classAliases: [], teachers: [], subjects: [] }),
    );
    const kinds = [...new Set(report.missing.map((item) => item.kind))];
    expect(kinds[0]).toBe("class");
  });

  it("refuses to publish a sheet the parser complained about", () => {
    // Nothing missing, but a malformed row: still not publishable.
    const malformed = parseTimetable("Monday\nClass 1,Maths (Bindu,,,,,,,");
    const report = resolveImport(
      malformed,
      buildContext({
        classAliases: [{ timetableLabel: "Class 1", classId: "c1" }],
        teachers: [{ shortName: "Bindu", id: "s1" }],
        subjects: [{ code: "Maths", id: "sub1" }],
      }),
    );
    expect(report.problems.length).toBeGreaterThan(0);
    expect(report.canPublish).toBe(false);
  });
});

describe("grouping by the screen that fixes it", () => {
  it("names a screen and a hint for every kind", () => {
    for (const kind of ["class", "teacher", "subject"] as const) {
      expect(FIX_SCREEN[kind].href).toMatch(/^\//);
      expect(FIX_SCREEN[kind].label.hi).toBeTruthy();
      expect(FIX_SCREEN[kind].label.en).toBeTruthy();
      expect(MISSING_HINT[kind].hi).toBeTruthy();
      expect(MISSING_HINT[kind].en).toBeTruthy();
    }
  });

  it("points each kind at a real screen", () => {
    expect(FIX_SCREEN.class.href).toBe("/academics/classes");
    expect(FIX_SCREEN.teacher.href).toBe("/staff");
    expect(FIX_SCREEN.subject.href).toBe("/academics/subjects");
  });

  it("groups without losing anything", () => {
    const report = resolveImport(
      parsed,
      buildContext({ classAliases: [], teachers: [], subjects: [] }),
    );
    const grouped = groupByFixScreen(report.missing);
    const total = grouped.reduce((sum, group) => sum + group.items.length, 0);
    expect(total).toBe(report.missing.length);
  });

  it("is empty when nothing is missing", () => {
    expect(groupByFixScreen([])).toEqual([]);
  });
});

/* ----------------------------------------------------------------- views */

const report = resolveImport(parsed, completeContext);
const stored: StoredSlot[] = report.slots.map((slot) => ({
  day: slot.day,
  period: slot.period,
  classId: slot.classId,
  classLabel: slot.classLabel,
  subjectId: slot.subjectId,
  subjectCode: slot.subjectCode,
  staffProfileId: slot.staffProfileId,
  teacherShortName: slot.teacherShortName,
  parallel: slot.parallel,
  shared: slot.shared,
}));

describe("gridForClass()", () => {
  const grid = gridForClass(stored, "class-0", parsed.days);

  it("has every day and every period, including the empty ones", () => {
    for (const day of parsed.days) {
      expect(grid.rows[day]).toHaveLength(PERIOD_COUNT);
    }
  });

  it("only contains that class", () => {
    for (const day of parsed.days) {
      for (const cell of grid.rows[day]) {
        for (const slot of cell.slots) {
          expect(slot.classId).toBe("class-0");
        }
      }
    }
  });

  it("keeps both halves of a parallel cell together", () => {
    // The class is split into two groups in one room. Showing one would send
    // half the children to the wrong place.
    const parallelCells = parsed.days
      .flatMap((day) => grid.rows[day])
      .filter((cell) => cell.slots.some((slot) => slot.parallel));

    for (const cell of parallelCells) {
      expect(cell.slots.length).toBeGreaterThan(1);
    }
  });
});

describe("gridForTeacher()", () => {
  it("only contains that teacher", () => {
    const grid = gridForTeacher(stored, "staff-0", parsed.days);
    for (const day of parsed.days) {
      for (const cell of grid.rows[day]) {
        for (const slot of cell.slots) {
          expect(slot.staffProfileId).toBe("staff-0");
        }
      }
    }
  });

  it("collapses combined sections into one cell", () => {
    // 11 Science, Commerce and Arts in one Hindi lesson is one entry with
    // three class labels, not three entries.
    const grid = gridForTeacher(stored, "staff-0", parsed.days);
    for (const day of parsed.days) {
      for (const cell of grid.rows[day]) {
        const periods = new Set(cell.slots.map((slot) => slot.period));
        expect(periods.size).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("gridForDay()", () => {
  it("gives every class a full row", () => {
    const rows = gridForDay(stored, "Monday", ["class-0", "class-1"]);
    expect(Object.keys(rows)).toEqual(["class-0", "class-1"]);
    expect(rows["class-0"]).toHaveLength(PERIOD_COUNT);
  });

  it("only contains that day", () => {
    const rows = gridForDay(stored, "Monday", ["class-0"]);
    for (const cell of rows["class-0"]) {
      for (const slot of cell.slots) {
        expect(slot.day).toBe("Monday");
      }
    }
  });
});

describe("freeTeachers()", () => {
  const roster = parsed.teacherNames.map((_, index) => `staff-${index}`);

  it("never reports somebody who is teaching", () => {
    for (const day of parsed.days) {
      for (let period = 0; period < PERIOD_COUNT; period += 1) {
        const free = new Set(freeTeachers(stored, roster, day, period));
        const busy = stored.filter(
          (slot) => slot.day === day && slot.period === period,
        );
        for (const slot of busy) {
          expect(free.has(slot.staffProfileId)).toBe(false);
        }
      }
    }
  });

  it("includes somebody with no periods at all", () => {
    // The most free person there is. Deriving the roster from the timetable
    // is the bug the old planner needed a hard-coded reserve list to work
    // around.
    const withReserve = [...roster, "staff-reserve"];
    expect(freeTeachers(stored, withReserve, "Monday", 0)).toContain("staff-reserve");
  });

  it("is the whole roster for a day nobody teaches", () => {
    expect(freeTeachers(stored, roster, "Sunday", 0)).toEqual(roster);
  });
});

describe("teacherLoad()", () => {
  it("counts a combined period once", () => {
    // The teacher stands in one room for one period, however many sections
    // are sitting in it.
    const load = teacherLoad(stored, "staff-0", parsed.days);
    for (const day of parsed.days) {
      expect(load.perDay[day]).toBeLessThanOrEqual(PERIOD_COUNT);
    }
  });

  it("totals the days", () => {
    const load = teacherLoad(stored, "staff-0", parsed.days);
    const sum = Object.values(load.perDay).reduce((a, b) => a + b, 0);
    expect(load.total).toBe(sum);
  });

  it("is zero for somebody who teaches nothing", () => {
    const load = teacherLoad(stored, "staff-nobody", parsed.days);
    expect(load.total).toBe(0);
  });
});

describe("findClashes()", () => {
  it("finds none in the school's real timetable", () => {
    // If this ever fails, the sheet has a teacher in two rooms at once.
    expect(findClashes(stored)).toEqual([]);
  });

  it("does not call a combined class a clash", () => {
    const combined: StoredSlot[] = [
      {
        day: "Monday", period: 0, classId: "a", classLabel: "11 Sci",
        subjectId: "s", subjectCode: "Hindi", staffProfileId: "t1",
        teacherShortName: "JN", parallel: false, shared: false,
      },
      {
        day: "Monday", period: 0, classId: "b", classLabel: "11 Com",
        subjectId: "s", subjectCode: "Hindi", staffProfileId: "t1",
        teacherShortName: "JN", parallel: false, shared: false,
      },
    ];
    expect(findClashes(combined)).toEqual([]);
  });

  it("finds one teacher in two different lessons", () => {
    const clashing: StoredSlot[] = [
      {
        day: "Monday", period: 0, classId: "a", classLabel: "Class 1",
        subjectId: "s1", subjectCode: "Maths", staffProfileId: "t1",
        teacherShortName: "BN", parallel: false, shared: false,
      },
      {
        day: "Monday", period: 0, classId: "b", classLabel: "Class 2",
        subjectId: "s2", subjectCode: "Hindi", staffProfileId: "t1",
        teacherShortName: "BN", parallel: false, shared: false,
      },
    ];
    const clashes = findClashes(clashing);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].subjects.sort()).toEqual(["Hindi", "Maths"]);
    expect(clashes[0].classLabels.sort()).toEqual(["Class 1", "Class 2"]);
  });
});

describe("buildAssignments()", () => {
  const assignments = buildAssignments(stored);

  it("produces one row per teacher, class and subject", () => {
    const keys = assignments.map(
      (a) => `${a.staffProfileId}:${a.classId}:${a.subjectId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("counts periods a week", () => {
    for (const assignment of assignments) {
      expect(assignment.periodsPerWeek).toBeGreaterThan(0);
    }
  });

  it("accounts for every slot", () => {
    const total = assignments.reduce((sum, a) => sum + a.periodsPerWeek, 0);
    expect(total).toBe(stored.length);
  });

  it("is empty for no slots", () => {
    expect(buildAssignments([])).toEqual([]);
  });
});

describe("the teacher map and the resolved slots agree", () => {
  it("names the same teachers", () => {
    const map = buildTeacherMap(parsed);
    const fromSlots = new Set(stored.map((slot) => slot.teacherShortName));
    for (const teacher of Object.keys(map)) {
      expect(fromSlots.has(teacher), `${teacher} has no slot`).toBe(true);
    }
  });
});
