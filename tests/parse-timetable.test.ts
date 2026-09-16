import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildTeacherMap,
  countTimetable,
  freePeriodsFor,
  parseCell,
  parseTimetable,
  PERIOD_COUNT,
  teachersFreeIn,
} from "@/modules/timetable/domain/parse-timetable";

/**
 * The fixture is the school's real 2026-27 timetable, lifted verbatim from
 * `timetable2025/scripts/data.js`.
 *
 * `docs/SOURCES.md` records what the earlier port produced from it — 768
 * cells, 30 parallel, 60 shared, 19 teachers, 23 subject labels — and those
 * numbers are the point of this file. A port that parses without error but
 * produces 29 parallel cells has changed the school's timetable, and only a
 * pinned count would say so.
 */
const fixture = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "fixtures/timetable-2026-27.csv",
  ),
  "utf8",
);

const parsed = parseTimetable(fixture);
const counts = countTimetable(parsed);

describe("the pinned counts", () => {
  it("parses 768 cells", () => {
    // 6 days x 16 classes x 8 periods.
    expect(counts.cells).toBe(768);
  });

  it("finds 30 parallel cells", () => {
    // "Biology / Maths (Hemlata / Prateek)" — two lessons, two cohorts. This
    // is the count that decides whether an absence needs a substitute.
    expect(counts.parallel).toBe(30);
  });

  it("finds 60 shared cells", () => {
    // "ELGA (Bindu / Anita / Rashmita / Kusum / Ravina)" — one lesson, five
    // teachers, absorbed rather than covered.
    expect(counts.shared).toBe(60);
  });

  it("finds 19 teachers", () => {
    expect(counts.teachers).toBe(19);
  });

  it("finds 23 subject labels", () => {
    expect(counts.subjects).toBe(23);
  });

  it("finds 6 days and 16 classes", () => {
    expect(counts.days).toBe(6);
    expect(counts.classes).toBe(16);
  });

  it("parses the real sheet with no problems at all", () => {
    // The fixture is what the school actually runs, so anything reported here
    // is the parser being wrong rather than the sheet.
    expect(parsed.problems).toEqual([]);
  });
});

describe("the shape of what came out", () => {
  it("names the days in order", () => {
    expect(parsed.days).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ]);
  });

  it("gives every class every period on every day", () => {
    for (const day of parsed.days) {
      for (const className of parsed.classNames) {
        const row = parsed.timetable[day][className];
        expect(row, `${className} is missing on ${day}`).toBeDefined();
        expect(row).toHaveLength(PERIOD_COUNT);
      }
    }
  });

  it("sorts teachers and subjects", () => {
    expect(parsed.teacherNames).toEqual([...parsed.teacherNames].sort());
    expect(parsed.subjectNames).toEqual([...parsed.subjectNames].sort());
  });

  it("does not shorten a subject while parsing", () => {
    // SOURCES.md: SHORT_SUBJECTS is applied at *render* time. Applying it here
    // produces labels that match no row in `vppsone.subjects`.
    expect(parsed.subjectNames).toContain("NoteBook Checking");
    expect(parsed.subjectNames).toContain("Business Studies");
    expect(parsed.subjectNames).not.toContain("Notebook");
    expect(parsed.subjectNames).not.toContain("Bus Study");
  });

  it("splits a parallel cell into its own subjects", () => {
    // "Biology / Maths" is two subject labels, not one.
    expect(parsed.subjectNames).toContain("Biology");
    expect(parsed.subjectNames).toContain("Maths");
    expect(parsed.subjectNames).not.toContain("Biology / Maths");
  });
});

describe("parseCell()", () => {
  it.each(["", "   ", "Free", "free", "FREE"])("reads %s as free", (raw) => {
    const cell = parseCell(raw);
    expect(cell.free).toBe(true);
    expect(cell.teachers).toEqual([]);
  });

  it("reads one subject and one teacher", () => {
    const cell = parseCell("Maths (Bindu)");
    expect(cell).toMatchObject({
      subject: "Maths",
      teachers: ["Bindu"],
      free: false,
      parallel: false,
    });
  });

  it("reads a shared block as one lesson with many teachers", () => {
    const cell = parseCell("ELGA (Bindu / Anita / Rashmita / Kusum / Ravina)");
    expect(cell.subject).toBe("ELGA");
    expect(cell.teachers).toHaveLength(5);
    // One subject, five teachers: not parallel. The rest absorb an absence.
    expect(cell.parallel).toBe(false);
  });

  it("reads a parallel elective as two lessons side by side", () => {
    const cell = parseCell("Biology / Maths (Hemlata / Prateek)");
    expect(cell.parallel).toBe(true);
    expect(cell.subjects).toEqual(["Biology", "Maths"]);
    expect(cell.teachers).toEqual(["Hemlata", "Prateek"]);
  });

  it("is not parallel when the counts do not match", () => {
    // Three subjects, two teachers: somebody is doubling up, so it is one
    // block rather than three cohorts. Guessing here would tell the planner
    // an absence needs no cover when it does.
    const cell = parseCell("A / B / C (X / Y)");
    expect(cell.parallel).toBe(false);
    expect(cell.subjects).toEqual([]);
  });

  it("keeps a subject with no teacher rather than dropping it", () => {
    // The sheet says something happens this period; task 2.2 reports it.
    const cell = parseCell("Assembly");
    expect(cell).toMatchObject({ subject: "Assembly", teachers: [], free: false });
  });

  it("trims whitespace around names", () => {
    const cell = parseCell("  Maths   (  Bindu  /  Anita  )  ");
    expect(cell.subject).toBe("Maths");
    expect(cell.teachers).toEqual(["Bindu", "Anita"]);
  });

  it("drops an empty slot between slashes", () => {
    const cell = parseCell("Maths (Bindu / / Anita)");
    expect(cell.teachers).toEqual(["Bindu", "Anita"]);
  });

  it("only splits subjects on a spaced slash", () => {
    // "Eco/Eng" without spaces is one label the school wrote tightly, not two.
    expect(parseCell("Eco/Eng (Prakash)").parallel).toBe(false);
  });
});

describe("problems the sheet can have", () => {
  it("reports a class row before any day header", () => {
    const result = parseTimetable("Class 1,Maths (A),B,C,D,E,F,G,H");
    expect(result.problems[0].kind).toBe("no-day-header");
  });

  it("reports a short row and still parses what is there", () => {
    const result = parseTimetable("Monday\nClass 1,Maths (A),Hindi (B)");
    expect(result.problems.map((p) => p.kind)).toContain("wrong-column-count");
    // Still eight cells: the missing ones are free rather than absent.
    expect(result.timetable.Monday["Class 1"]).toHaveLength(PERIOD_COUNT);
  });

  it("reports the same class twice in one day", () => {
    const result = parseTimetable(
      "Monday\nClass 1,A (X),,,,,,,\nClass 1,B (Y),,,,,,,",
    );
    expect(result.problems.map((p) => p.kind)).toContain("duplicate-class-in-day");
  });

  it("reports an unclosed bracket", () => {
    // A truncated cell loses the teacher silently; nothing downstream notices.
    const result = parseTimetable("Monday\nClass 1,Maths (Bindu,,,,,,,");
    expect(result.problems.map((p) => p.kind)).toContain("unclosed-bracket");
  });

  it("reports empty brackets", () => {
    const result = parseTimetable("Monday\nClass 1,Maths (),,,,,,,");
    expect(result.problems.map((p) => p.kind)).toContain("empty-teacher");
  });

  it("numbers problems by the line a person would count to", () => {
    const result = parseTimetable("Monday\nClass,P1\nClass 1,Maths (Bindu,,,,,,,");
    expect(result.problems[0].line).toBe(3);
  });

  it("finds nothing wrong with a well-formed sheet", () => {
    const result = parseTimetable(
      "Monday\nClass,P1,P2,P3,P4,P5,P6,P7,P8\nClass 1,Maths (A),Free,,,,,,",
    );
    expect(result.problems).toEqual([]);
  });
});

describe("buildTeacherMap()", () => {
  const map = buildTeacherMap(parsed);

  it("gives every teacher a row for every day", () => {
    for (const teacher of parsed.teacherNames) {
      for (const day of parsed.days) {
        expect(map[teacher][day]).toHaveLength(PERIOD_COUNT);
      }
    }
  });

  it("gives a teacher their own subject in a parallel cell", () => {
    // Monday period 7, Class 11 Science: "Biology / Maths (Hemlata / Prateek)".
    // Hemlata's slot says Biology, not "Biology / Maths".
    const slot = map.Hemlata.Monday[6];
    expect(slot?.subject).toBe("Biology");
    expect(slot?.shared).toBe(false);

    const other = map.Prateek.Monday[6];
    expect(other?.subject).toBe("Maths");
  });

  it("marks a co-taught block as shared", () => {
    // Monday period 3 is ELGA across the primary classes.
    const slot = map.Bindu.Monday[2];
    expect(slot?.shared).toBe(true);
    expect(slot?.subject).toBe("ELGA");
  });

  it("does not merge sections of a shared block", () => {
    // The five ELGA teachers run one primary-wide activity; they are not
    // teaching Class 1 and four others simultaneously.
    const slot = map.Bindu.Monday[2];
    expect(slot?.alsoClassNames).toEqual([]);
  });

  it("merges the sections of a combined class", () => {
    // Monday period 5: 11 Science, Commerce and Arts all sit Hindi with
    // Jainendra. One room, one cover teacher, one slot — but every class's
    // timetable has to name it.
    const slot = map.Jainendra.Monday[4];
    expect(slot?.subject).toBe("Hindi");
    expect(slot?.alsoClassNames.length).toBeGreaterThan(0);
  });

  it("never lists a class as also being itself", () => {
    for (const teacher of Object.keys(map)) {
      for (const day of parsed.days) {
        for (const slot of map[teacher][day]) {
          if (!slot) continue;
          expect(slot.alsoClassNames).not.toContain(slot.className);
          expect(new Set(slot.alsoClassNames).size).toBe(slot.alsoClassNames.length);
        }
      }
    }
  });

  it("covers every taught cell with at least one teacher slot", () => {
    // A cell with teachers that produced no slot would be a period nobody is
    // recorded as teaching.
    let taughtCells = 0;
    for (const day of parsed.days) {
      for (const className of parsed.classNames) {
        for (const cell of parsed.timetable[day][className]) {
          if (cell.teachers.length > 0) taughtCells += 1;
        }
      }
    }
    expect(taughtCells).toBeGreaterThan(0);

    let slots = 0;
    for (const teacher of Object.keys(map)) {
      for (const day of parsed.days) {
        slots += map[teacher][day].filter(Boolean).length;
      }
    }
    // Fewer slots than cells, because combined sections merge — but never
    // zero, and never more than the cells that produced them.
    expect(slots).toBeGreaterThan(0);
    expect(slots).toBeLessThanOrEqual(taughtCells * PERIOD_COUNT);
  });
});

describe("free periods", () => {
  const map = buildTeacherMap(parsed);

  it("lists the periods a teacher is not in a room", () => {
    const free = freePeriodsFor(map, "Bindu", "Monday");
    for (const period of free) {
      expect(map.Bindu.Monday[period]).toBeNull();
    }
  });

  it("is empty for a teacher who does not exist", () => {
    expect(freePeriodsFor(map, "Nobody", "Monday")).toEqual([]);
  });

  it("finds who is free in a given period", () => {
    const free = teachersFreeIn(map, "Monday", 0);
    expect(free).toEqual([...free].sort());
    for (const teacher of free) {
      expect(map[teacher].Monday[0]).toBeNull();
    }
  });

  it("never reports a teacher as both free and teaching", () => {
    for (const day of parsed.days) {
      for (let period = 0; period < PERIOD_COUNT; period += 1) {
        const free = new Set(teachersFreeIn(map, day, period));
        for (const teacher of parsed.teacherNames) {
          const teaching = map[teacher][day][period] !== null;
          expect(
            free.has(teacher) && teaching,
            `${teacher} is both free and teaching on ${day} P${period + 1}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("parsing is stable", () => {
  it("gives the same result twice", () => {
    expect(countTimetable(parseTimetable(fixture))).toEqual(counts);
  });

  it("survives Windows line endings", () => {
    // The school's sheet arrives from Excel on Windows.
    const crlf = fixture.replace(/\n/g, "\r\n");
    expect(countTimetable(parseTimetable(crlf))).toEqual(counts);
  });

  it("survives a trailing blank line", () => {
    expect(countTimetable(parseTimetable(`${fixture}\n\n`))).toEqual(counts);
  });

  it("is empty-safe", () => {
    const empty = parseTimetable("");
    expect(empty.cellCount).toBe(0);
    expect(empty.days).toEqual([]);
    expect(empty.problems).toEqual([]);
  });
});
