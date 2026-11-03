import { describe, expect, it } from "vitest";
import { buildTeacherMap, countTimetable, freePeriodsFor, parseCell, parseTimetable, teachersFreeIn } from "@/modules/timetable/domain/parse-timetable";
import { SYNTHETIC_TIMETABLE } from "./fixtures/timetable-synthetic";

describe("synthetic timetable parser integration (not the pinned school sheet)", () => {
  const parsed = parseTimetable(SYNTHETIC_TIMETABLE);
  const map = buildTeacherMap(parsed);

  it("preserves the hand-counted shape, subjects and group kinds", () => {
    expect(countTimetable(parsed)).toMatchObject({ cells: 48, days: 2, classes: 3, teachers: 6, subjects: 7, parallel: 2, shared: 4 });
    expect(parsed.problems).toEqual([]);
    expect(parsed.days).toEqual(["Monday", "Tuesday"]);
    expect(parsed.subjectNames).toContain("Community Studies");
    expect(parsed.subjectNames).not.toContain("Science / Maths");
    for (const day of parsed.days) for (const cls of parsed.classNames) expect(parsed.timetable[day][cls]).toHaveLength(8);
  });

  it("keeps parallel subjects separate and shared teaching together", () => {
    expect(map["QA Alpha"].Monday[1]).toMatchObject({ subject: "Science", shared: false });
    expect(map["QA Beta"].Monday[1]).toMatchObject({ subject: "Maths", shared: false });
    expect(map["QA Gamma"].Monday[2]).toMatchObject({ subject: "Studio", shared: true, alsoClassNames: [] });
    expect(map["QA Epsilon"].Monday[3]).toMatchObject({ subject: "Community Studies", alsoClassNames: ["QA Green"] });
  });

  it("reports exact free periods without losing a teaching assignment", () => {
    expect(freePeriodsFor(map, "QA Alpha", "Monday")).toEqual([2, 3, 5, 6, 7]);
    expect(teachersFreeIn(map, "Monday", 0)).toEqual(["QA Delta", "QA Epsilon", "QA Zeta"]);
    expect(freePeriodsFor(map, "QA Missing", "Monday")).toEqual([]);
    for (const teacher of parsed.teacherNames) for (const day of parsed.days) {
      expect(map[teacher][day]).toHaveLength(8);
      for (let period = 0; period < 8; period++) expect(teachersFreeIn(map, day, period).includes(teacher)).toBe(map[teacher][day][period] === null);
    }
  });

  it.each(["", " Free ", "FREE"])("recognizes free cells: %j", (cell) => {
    expect(parseCell(cell)).toMatchObject({ free: true, teachers: [] });
  });

  it("does not invent parallel cohorts from mismatched counts or unspaced slashes", () => {
    expect(parseCell("One / Two / Three (QA Alpha / QA Beta)")).toMatchObject({ parallel: false, subjects: [] });
    expect(parseCell("One/Two (QA Alpha)")).toMatchObject({ parallel: false, subject: "One/Two" });
    expect(parseCell("  Studio ( QA Alpha / / QA Beta )  ").teachers).toEqual(["QA Alpha", "QA Beta"]);
  });

  it.each([
    ["QA Blue,Maths (QA Alpha),Free,Free,Free,Free,Free,Free,Free", "no-day-header"],
    ["Monday\nQA Blue,Maths (QA Alpha)", "wrong-column-count"],
    ["Monday\nQA Blue,Maths (),Free,Free,Free,Free,Free,Free,Free", "empty-teacher"],
    ["Monday\nQA Blue,Maths (QA Alpha,Free,Free,Free,Free,Free,Free,Free", "unclosed-bracket"],
    ["Monday\nQA Blue,,,,,,,,\nQA Blue,,,,,,,,", "duplicate-class-in-day"],
  ])("reports malformed input without hiding the problem: %s", (raw, kind) => {
    expect(parseTimetable(raw).problems.map((problem) => problem.kind)).toContain(kind);
  });

  it("keeps Windows line endings and blank lines equivalent, and handles empty input", () => {
    expect(parseTimetable(SYNTHETIC_TIMETABLE.replaceAll("\n", "\r\n"))).toEqual(parsed);
    expect(parseTimetable(`${SYNTHETIC_TIMETABLE}\n\n`)).toEqual(parsed);
    expect(parseTimetable("")).toMatchObject({ cellCount: 0, days: [], problems: [] });
  });
});
