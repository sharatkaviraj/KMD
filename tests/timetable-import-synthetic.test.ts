import { describe, expect, it } from "vitest";
import { parseTimetable } from "@/modules/timetable/domain/parse-timetable";
import { buildContext, groupByFixScreen, resolveImport } from "@/modules/timetable/domain/resolve-import";
import { buildAssignments, findClashes, freeTeachers, gridForClass, gridForDay, gridForTeacher, teacherLoad } from "@/modules/timetable/domain/views";
import { SUBJECTS, SYNTHETIC_TIMETABLE, TEACHERS, syntheticMasters, syntheticTimetable } from "./fixtures/timetable-synthetic";

describe("synthetic timetable import and readback integration", () => {
  const { parsed, report, slots } = syntheticTimetable();

  it("resolves the literal master data and accounts for every taught/free cell", () => {
    expect(report).toMatchObject({ canPublish: true, missing: [], problems: [], counts: { cells: 48, free: 25, unresolved: 0 } });
    expect(slots).toHaveLength(29);
    expect(slots.filter((slot) => slot.parallel)).toHaveLength(4);
    expect(slots.filter((slot) => slot.shared)).toHaveLength(8);
    expect(slots.filter((slot) => slot.parallel).map((slot) => slot.subjectCode)).toEqual(["Science", "Maths", "Science", "Maths"]);
  });

  it("deduplicates missing teachers, bounds examples, and refuses publication", () => {
    const masters = syntheticMasters(); masters.teachers = masters.teachers.filter((teacher) => teacher.shortName !== "QA Alpha");
    const result = resolveImport(parsed, buildContext(masters));
    expect(result.canPublish).toBe(false);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ kind: "teacher", name: "QA Alpha", cells: 6 });
    expect(result.missing[0].examples.length).toBeLessThanOrEqual(3);
  });

  it("reports unknown classes, subjects and malformed rows instead of claiming publication readiness", () => {
    const masters = syntheticMasters(); masters.subjects = masters.subjects.filter((subject) => subject.code !== "Studio");
    const missingSubject = resolveImport(parsed, buildContext(masters));
    expect(missingSubject.canPublish).toBe(false);
    // The resolver counts unresolved teacher/subject pairs: four shared cells, two teachers each.
    expect(missingSubject.missing).toEqual([expect.objectContaining({ kind: "subject", name: "Studio", cells: 8 })]);
    const missing = resolveImport(parsed, buildContext({ classAliases: [], teachers: [], subjects: [] }));
    expect(missing.canPublish).toBe(false);
    expect(missing.missing.map((item) => item.kind)).toEqual(["class", "class", "class"]);
    expect(groupByFixScreen(missing.missing).flatMap((group) => group.items)).toHaveLength(3);
    expect(resolveImport(parseTimetable("Monday\nQA Blue,Maths (QA Alpha"), buildContext(syntheticMasters())).canPublish).toBe(false);
  });

  it("resolves case-insensitive masters without shortening subject labels", () => {
    const masters = syntheticMasters();
    masters.classAliases = masters.classAliases.map((entry) => ({ ...entry, timetableLabel: entry.timetableLabel.toUpperCase() }));
    masters.teachers = masters.teachers.map((entry) => ({ ...entry, shortName: entry.shortName.toUpperCase() }));
    masters.subjects = SUBJECTS.map((code) => ({ code: code.toUpperCase(), id: code }));
    expect(resolveImport(parseTimetable(SYNTHETIC_TIMETABLE), buildContext(masters)).canPublish).toBe(true);
  });

  it("stores master IDs rather than display labels when those differ", () => {
    const result = resolveImport(parseTimetable("Monday\nQA Blue,Numeracy (QA Alpha),Free,Free,Free,Free,Free,Free,Free"), buildContext({
      classAliases: [{ timetableLabel: "QA Blue", classId: "class-101" }],
      teachers: [{ shortName: "QA Alpha", id: "staff-201" }],
      subjects: [{ code: "Numeracy", id: "subject-301" }],
    }));
    expect(result.canPublish).toBe(true);
    expect(result.slots).toEqual([expect.objectContaining({
      classId: "class-101", classLabel: "QA Blue", staffProfileId: "staff-201",
      teacherShortName: "QA Alpha", subjectId: "subject-301", subjectCode: "Numeracy",
    })]);
  });

  it("preserves parallel groups and class/day/teacher scope in the grids", () => {
    const grid = gridForClass(slots, "QA Blue", parsed.days);
    expect(grid.rows.Monday).toHaveLength(8);
    expect(grid.rows.Monday[1].slots.map((slot) => slot.subjectCode)).toEqual(["Science", "Maths"]);
    expect(grid.rows.Monday[4].slots).toEqual([]);
    expect(Object.values(grid.rows).flatMap((row) => row.flatMap((cell) => cell.slots)).every((slot) => slot.classId === "QA Blue")).toBe(true);
    const teacher = gridForTeacher(slots, "QA Epsilon", parsed.days);
    expect(teacher.rows.Monday[3].slots.map((slot) => slot.classId)).toEqual(["QA Blue", "QA Green"]);
    const teacherSlots = Object.values(teacher.rows).flatMap((row) => row.flatMap((cell) => cell.slots));
    expect(teacherSlots).toHaveLength(4);
    expect(teacherSlots.every((slot) => slot.staffProfileId === "QA Epsilon")).toBe(true);
    const day = gridForDay(slots, "Monday", ["QA Blue"]);
    expect(Object.keys(day)).toEqual(["QA Blue"]);
    expect(day["QA Blue"]).toHaveLength(8);
    const daySlots = day["QA Blue"].flatMap((cell) => cell.slots);
    expect(daySlots).toHaveLength(7);
    expect(daySlots.every((slot) => slot.day === "Monday" && slot.classId === "QA Blue")).toBe(true);
    expect(day["QA Blue"][0].slots).toEqual([expect.objectContaining({ subjectCode: "Numeracy", staffProfileId: "QA Alpha" })]);
    expect(teacherLoad(slots, "QA Epsilon", parsed.days)).toEqual({ perDay: { Monday: 1, Tuesday: 1 }, total: 2 });
  });

  it("distinguishes actual clashes from combined lessons", () => {
    expect(findClashes(slots)).toEqual([]);
    const conflicting = { ...slots[0], classId: "QA Other", classLabel: "QA Other", subjectId: "Other", subjectCode: "Other" };
    expect(findClashes([...slots, conflicting])).toEqual([expect.objectContaining({ day: "Monday", period: 0, staffProfileId: "QA Alpha" })]);
  });

  it("counts teaching assignments and keeps free and occupied teachers disjoint", () => {
    const assignments = buildAssignments(slots);
    expect(assignments.reduce((sum, assignment) => sum + assignment.periodsPerWeek, 0)).toBe(29);
    expect(assignments.find((assignment) => assignment.staffProfileId === "QA Epsilon" && assignment.classId === "QA Blue")).toMatchObject({ periodsPerWeek: 2 });
    expect(new Set(assignments.map((assignment) => `${assignment.staffProfileId}:${assignment.classId}:${assignment.subjectId}`)).size).toBe(assignments.length);
    expect(freeTeachers(slots, [...TEACHERS, "QA Reserve"], "Monday", 0)).toEqual(["QA Delta", "QA Epsilon", "QA Zeta", "QA Reserve"]);
    expect(freeTeachers(slots, TEACHERS, "Sunday", 0)).toEqual(TEACHERS);
  });
});
