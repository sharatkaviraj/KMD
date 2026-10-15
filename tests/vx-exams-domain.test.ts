import { describe, expect, it } from "vitest";

import {
  addDays,
  copyOnto,
  examDays,
  findClashes,
  fixesFor,
  lengthLabel,
  slotTimeLabel,
  weekday,
  type Slot,
} from "@/vx/screens/exams/domain/datesheet";
import { groupOf } from "@/vx/screens/exams/domain/groups";
import {
  changedIds,
  checkSummary,
  counts,
  nextBlank,
  parseMark,
  pressKey,
  shouldAdvance,
  cleanTyped,
  misfits,
  toEntries,
  type Cell,
} from "@/vx/screens/exams/domain/entry";
import { firstName, reminderText, remarkText, suggestRemarks, waLink } from "@/vx/screens/exams/domain/messages";
import {
  averagePct,
  graceVerdict,
  pipelineStates,
  unusualAverages,
  type PaperAverage,
} from "@/vx/screens/exams/domain/results";
import { assignDuties, chartRows, dutySpread, invigilatorsFor, sameClassNeighbours, seatPlan } from "@/vx/screens/exams/domain/rooms";
import {
  classRows,
  expectedShare,
  isLate,
  onRoll,
  overall,
  paperStatus,
  teacherLoads,
  type PaperFacts,
} from "@/vx/screens/exams/domain/tracker";

describe("class bands", () => {
  it.each([
    ["Nursery", "pre"],
    ["JKG", "pre"],
    ["SKG", "pre"],
    ["Class 1", "c1_5"],
    ["Class 5", "c1_5"],
    ["Class 6", "c6_8"],
    ["Class 8", "c6_8"],
    ["Class 9", "c9_10"],
    ["Class 10", "c9_10"],
    ["11 Arts", "c11_12"],
    ["12 Science", "c11_12"],
  ])("%s sits in %s", (name, band) => {
    expect(groupOf(name)).toBe(band);
  });

  it("leaves a class it cannot place off the sheet", () => {
    expect(groupOf("Alumni")).toBeNull();
  });
});

describe("the date sheet", () => {
  const slot = (id: string, groupKey: Slot["groupKey"], day: string, start = "08:30", minutes = 90): Slot => ({
    id,
    groupKey,
    subject: id,
    day,
    start,
    minutes,
  });

  it("prints times the way the sheet does", () => {
    expect(slotTimeLabel({ start: "08:30", minutes: 90 })).toBe("8:30–10:00");
    expect(lengthLabel(45)).toBe("45 min");
    expect(lengthLabel(90)).toBe("1 h 30 min");
    expect(lengthLabel(60)).toBe("1 h");
  });

  it("leaves Sundays and holidays out of the exam days", () => {
    expect(weekday("2026-12-13")).toBe(0);
    expect(examDays("2026-12-07", "2026-12-14")).toEqual([
      "2026-12-07", "2026-12-08", "2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12", "2026-12-14",
    ]);
    expect(examDays("2026-12-07", "2026-12-09", new Set(["2026-12-08"]))).toEqual(["2026-12-07", "2026-12-09"]);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("calls two papers for one band on one day a clash, and says whether they overlap", () => {
    const clashes = findClashes([
      slot("maths", "c9_10", "2026-12-10"),
      slot("science", "c9_10", "2026-12-10", "11:00"),
      slot("english", "c6_8", "2026-12-10"),
    ]);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]).toMatchObject({ kind: "same_day", groupKey: "c9_10", slotIds: ["maths", "science"], overlap: false });

    const overlapping = findClashes([slot("a", "pre", "2026-12-07", "09:00", 60), slot("b", "pre", "2026-12-07", "09:30", 45)]);
    expect(overlapping[0]).toMatchObject({ overlap: true });
  });

  it("flags a Sunday and a holiday", () => {
    expect(findClashes([slot("a", "pre", "2026-12-13")])[0].kind).toBe("sunday");
    expect(findClashes([slot("a", "pre", "2026-12-14")], new Set(["2026-12-14"]))[0].kind).toBe("holiday");
  });

  it("suggests moving the later paper to the nearest day the band has free, at its usual time", () => {
    const slots = [
      slot("en", "c9_10", "2026-12-07"),
      slot("hi", "c9_10", "2026-12-08"),
      slot("ss", "c9_10", "2026-12-09"),
      slot("ma", "c9_10", "2026-12-10"),
      slot("sc", "c9_10", "2026-12-10", "11:00"),
      slot("sa", "c9_10", "2026-12-11"),
    ];
    const [clash] = findClashes(slots);
    const fixes = fixesFor(clash, slots, examDays("2026-12-07", "2026-12-12"));
    expect(fixes[0]).toEqual({ slotId: "sc", toDay: "2026-12-12", start: "08:30" });
  });

  it("copies last exam's order onto this exam's days", () => {
    const source = [
      { groupKey: "c6_8" as const, subject: "Science", day: "2026-07-14", start: "08:30", minutes: 90 },
      { groupKey: "c6_8" as const, subject: "English", day: "2026-07-15", start: "08:30", minutes: 90 },
      { groupKey: "c1_5" as const, subject: "English", day: "2026-07-14", start: "08:30", minutes: 60 },
    ];
    const { slots, overflow } = copyOnto(source, ["2026-12-07", "2026-12-08"]);
    expect(overflow).toBe(0);
    expect(slots.map((s) => `${s.subject}@${s.day}`)).toEqual(["Science@2026-12-07", "English@2026-12-08", "English@2026-12-07"]);
    expect(copyOnto(source, ["2026-12-07"]).overflow).toBe(1);
  });
});

describe("the marks tracker", () => {
  const paper = (over: Partial<PaperFacts>): PaperFacts => ({
    paperId: "p",
    classId: "c",
    classLabel: "Class 7",
    classSort: 10,
    subjectCode: "Science",
    teacherId: "t",
    teacherName: "Teacher A",
    total: 20,
    entered: 0,
    entryStatus: "open",
    entryRevision: 0,
    maxMarks: 80,
    passMarks: 26,
    ...over,
  });

  it("uses the same roll rule as paper_roster", () => {
    const exam = { startsOn: "2026-09-23", endsOn: "2026-10-03" };
    const base = { studentId: "s", classId: "c", status: "enrolled", enrolledOn: "2026-04-20", leftOn: null };
    expect(onRoll(base, exam, "2026-10-10")).toBe(true);
    expect(onRoll({ ...base, enrolledOn: "2026-10-05" }, exam, "2026-10-10")).toBe(false);
    expect(onRoll({ ...base, status: "left", leftOn: "2026-09-30" }, exam, "2026-10-10")).toBe(true);
    expect(onRoll({ ...base, status: "left", leftOn: "2026-09-01" }, exam, "2026-10-10")).toBe(false);
  });

  it("names a paper's state", () => {
    expect(paperStatus(paper({ entryStatus: "submitted", entered: 20 }))).toBe("done");
    expect(paperStatus(paper({ entered: 0 }))).toBe("not_started");
    expect(paperStatus(paper({ entered: 5 }))).toBe("in_progress");
    expect(paperStatus(paper({ total: 0 }))).toBe("empty");
  });

  it("expects an even pace from the exam's end to the due date", () => {
    expect(expectedShare("2026-10-03", "2026-10-13", "2026-10-03")).toBe(0);
    expect(expectedShare("2026-10-03", "2026-10-13", "2026-10-08")).toBe(0.5);
    expect(expectedShare("2026-10-03", "2026-10-13", "2026-10-14")).toBe(1);
    expect(expectedShare(null, null, "2026-10-14")).toBe(0);
  });

  it("calls a paper late when it is well behind, or untouched past half-time", () => {
    expect(isLate(paper({ entered: 0 }), 0.4)).toBe(false);
    expect(isLate(paper({ entered: 0 }), 0.5)).toBe(true);
    expect(isLate(paper({ entered: 4 }), 0.6)).toBe(true);
    expect(isLate(paper({ entered: 10 }), 0.6)).toBe(false);
    expect(isLate(paper({ entered: 19 }), 1)).toBe(true);
    expect(isLate(paper({ entered: 20, entryStatus: "submitted" }), 1)).toBe(false);
  });

  it("lists unfinished teachers, the late first", () => {
    const loads = teacherLoads(
      [
        paper({ paperId: "1", teacherId: "a", teacherName: "A", entered: 18 }),
        paper({ paperId: "2", teacherId: "b", teacherName: "B", entered: 0 }),
        paper({ paperId: "3", teacherId: "c", teacherName: "C", entered: 20, entryStatus: "submitted" }),
      ],
      0.6,
    );
    expect(loads.map((l) => l.teacherId)).toEqual(["b", "a"]);
    expect(loads[0]).toMatchObject({ late: true, notStarted: true });
  });

  it("adds up a whole exam and each class", () => {
    const papers = [
      paper({ paperId: "1", classId: "x", classLabel: "Class 2", classSort: 5, entered: 10 }),
      paper({ paperId: "2", classId: "x", classLabel: "Class 2", classSort: 5, entered: 20, entryStatus: "submitted" }),
      paper({ paperId: "3", classId: "y", classLabel: "Class 1", classSort: 4, entered: 20, entryStatus: "submitted" }),
    ];
    expect(overall(papers)).toEqual({ entered: 50, total: 60, percent: 83, done: 2, papers: 3 });
    const rows = classRows(papers, 0);
    expect(rows.map((r) => r.classLabel)).toEqual(["Class 1", "Class 2"]);
    expect(rows[1]).toMatchObject({ percent: 75, allSubmitted: false });
  });
});

describe("results", () => {
  it("averages a paper without the absent", () => {
    expect(averagePct([{ value: 40, absent: false, exempt: false }, { value: null, absent: true, exempt: false }, { value: 80, absent: false, exempt: false }], 80)).toBe(75);
    expect(averagePct([], 80)).toBeNull();
  });

  it("flags averages that moved since the last exam, or stand out from the school", () => {
    const papers: PaperAverage[] = [
      { paperId: "a", classId: "1", classLabel: "Class 9", subjectCode: "Science", avgPct: 52, prevPct: 74 },
      { paperId: "b", classId: "2", classLabel: "Class 10", subjectCode: "Science", avgPct: 70, prevPct: 66 },
      { paperId: "c", classId: "1", classLabel: "Class 9", subjectCode: "Maths", avgPct: 90, prevPct: null },
      { paperId: "d", classId: "2", classLabel: "Class 10", subjectCode: "Maths", avgPct: 60, prevPct: null },
      { paperId: "e", classId: "3", classLabel: "Class 8", subjectCode: "Maths", avgPct: 62, prevPct: null },
    ];
    const flagged = unusualAverages(papers);
    expect(flagged.map((u) => [u.paperId, u.basis, u.delta])).toEqual([
      ["c", "school", 29],
      ["a", "previous", -22],
      ["d", "school", -16],
    ]);
  });

  it("offers grace only when the rule carries every failed paper", () => {
    const paper = (paperId: string, value: number | null, absent = false) => ({
      paperId,
      subjectCode: paperId,
      value,
      absent,
      exempt: false,
      passMarks: 26,
      maxMarks: 80,
    });
    const rule = { maxPerPaper: 3, maxSubjects: 2 };
    expect(graceVerdict("s", [paper("hi", 40)], rule)).toBeNull();
    expect(graceVerdict("s", [paper("hi", 24), paper("en", 25)], rule)).toMatchObject({ canPass: true, total: 3 });
    expect(graceVerdict("s", [paper("hi", 20)], rule)).toMatchObject({ canPass: false });
    expect(graceVerdict("s", [paper("hi", 25), paper("en", 25), paper("ma", 25)], rule)).toMatchObject({ canPass: false });
    expect(graceVerdict("s", [paper("hi", 25), paper("en", null, true)], rule)).toMatchObject({ canPass: false });
  });

  it("walks the six steps in order", () => {
    const states = pipelineStates({
      enteredPct: 68,
      unusualOpen: 2,
      graceOpen: 11,
      lockedClasses: 0,
      totalClasses: 19,
      cardsIssued: 0,
      cardsDue: 434,
      published: false,
    });
    expect(states).toEqual({ entered: "active", checked: "can_start", grace: "can_start", locked: "can_start", cards: "waiting", published: "waiting" });
    const finished = pipelineStates({ enteredPct: 100, unusualOpen: 0, graceOpen: 0, lockedClasses: 19, totalClasses: 19, cardsIssued: 434, cardsDue: 434, published: false });
    expect(finished.published).toBe("active");
  });
});

describe("seating and duties", () => {
  const students = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ studentId: `${prefix}${i + 1}`, roll: String(i + 1) }));

  it("seats two classes per room, alternating, so neighbours sit different papers", () => {
    const rooms = [
      { id: "r1", name: "Room 1", seats: 10, cols: 5 },
      { id: "r2", name: "Room 2", seats: 10, cols: 5 },
    ];
    const { seats, unseated } = seatPlan(rooms, [
      { classId: "A", label: "A", students: students("a", 8) },
      { classId: "B", label: "B", students: students("b", 7) },
    ]);
    expect(unseated).toBe(0);
    expect(seats).toHaveLength(15);
    expect(seats.slice(0, 4).map((s) => s.classId)).toEqual(["A", "B", "A", "B"]);
    expect(sameClassNeighbours(seats.filter((s) => s.roomId === "r1"), 5)).toBe(0);
    expect(seats[0]).toMatchObject({ roomId: "r1", seatNo: 1, studentId: "a1" });
  });

  it("says how many could not be seated", () => {
    const { unseated } = seatPlan([{ id: "r", name: "R", seats: 3, cols: 3 }], [{ classId: "A", label: "A", students: students("a", 5) }]);
    expect(unseated).toBe(2);
  });

  it("draws a room as rows", () => {
    const rows = chartRows([{ seatNo: 1 }, { seatNo: 4 }], 5, 2);
    expect(rows).toEqual([[{ seatNo: 1 }, null], [null, { seatNo: 4 }], [null]]);
  });

  it("shares duties fairly and never twice in a day", () => {
    const staff = ["Asha", "Bina", "Chetan", "Deepa"].map((name) => ({ id: name.toLowerCase(), name }));
    const duties = assignDuties({
      days: ["d1", "d2", "d3"],
      rooms: [{ id: "r1", need: 1 }, { id: "r2", need: 1 }],
      staff,
    });
    expect(duties).toHaveLength(6);
    for (const day of ["d1", "d2", "d3"]) {
      const people = duties.filter((d) => d.day === day).map((d) => d.staffId);
      expect(new Set(people).size).toBe(people.length);
    }
    expect(dutySpread(duties, staff).fair).toBe(true);
    expect(invigilatorsFor(30)).toBe(1);
    expect(invigilatorsFor(80)).toBe(2);
  });

  it("keeps fixed duties and counts them", () => {
    const staff = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
    const duties = assignDuties({ days: ["d1", "d2"], rooms: [{ id: "r", need: 1 }], staff, fixed: [{ day: "d1", roomId: "r", staffId: "a" }] });
    expect(duties).toEqual([
      { day: "d1", roomId: "r", staffId: "a" },
      { day: "d2", roomId: "r", staffId: "b" },
    ]);
  });
});

describe("typing marks", () => {
  it("reads a mark against the paper", () => {
    expect(parseMark("", 80, 1)).toEqual({ ok: true, value: null });
    expect(parseMark("72", 80, 1)).toEqual({ ok: true, value: 72 });
    expect(parseMark("81", 80, 1)).toEqual({ ok: false, reason: "over" });
    expect(parseMark("7.5", 80, 1)).toEqual({ ok: false, reason: "step" });
    expect(parseMark("7.5", 80, 0.5)).toEqual({ ok: true, value: 7.5 });
    expect(parseMark("x", 80, 1)).toEqual({ ok: false, reason: "nan" });
  });

  it("never lets the pad type a mark the paper cannot hold", () => {
    expect(pressKey("6", "1", 60, 1)).toBe("6");
    expect(pressKey("6", "0", 60, 1)).toBe("60");
    expect(pressKey("7", ".", 80, 1)).toBe("7");
    expect(pressKey("7", ".", 80, 0.5)).toBe("7.");
    expect(pressKey("7.5", "5", 80, 0.5)).toBe("7.5");
    expect(pressKey("72", "del", 80, 1)).toBe("7");
    expect(pressKey("0", "5", 80, 1)).toBe("5");
  });

  it("moves on once another digit could not fit", () => {
    expect(shouldAdvance("7", 80)).toBe(false);
    expect(shouldAdvance("72", 80)).toBe(true);
    expect(shouldAdvance("", 80)).toBe(false);
  });

  it("never moves on after one digit of a mark that could be a slip (ST-03: 95 on an 80 paper)", () => {
    // "9" then "5" used to save 9 for one child and 5 for the next.
    expect(shouldAdvance("9", 80)).toBe(false);
    expect(parseMark("95", 80, 1)).toEqual({ ok: false, reason: "over" });
    expect(shouldAdvance("80", 80)).toBe(true);
    expect(shouldAdvance("45", 100)).toBe(true);
    expect(shouldAdvance("10", 100)).toBe(false);
    expect(shouldAdvance("100", 100)).toBe(true);
    // A paper out of 10: single digits are the marks, so they still move on.
    expect(shouldAdvance("9", 10)).toBe(true);
    expect(shouldAdvance("1", 10)).toBe(false);
    expect(shouldAdvance("7.5", 80)).toBe(true);
  });

  it("waits for the point on a paper that takes halves (N1: 72.5 split into 72 and .5)", () => {
    expect(shouldAdvance("72", 80, 0.5)).toBe(false);
    expect(shouldAdvance("72.", 80, 0.5)).toBe(false);
    expect(shouldAdvance("72.5", 80, 0.5)).toBe(true);
    expect(shouldAdvance("80", 80, 0.5)).toBe(true);
    expect(shouldAdvance("7.2", 80, 0.25)).toBe(false);
    expect(shouldAdvance("7.25", 80, 0.25)).toBe(true);
    // Whole-mark papers are unchanged.
    expect(shouldAdvance("72", 80, 1)).toBe(true);
  });

  it("refuses a minus sign or a letter instead of stripping it (BUG-09: -5 saved as 5)", () => {
    expect(cleanTyped("-5")).toBeNull();
    expect(cleanTyped("7a")).toBeNull();
    expect(cleanTyped("72")).toBe("72");
    expect(cleanTyped("7.5")).toBe("7.5");
    expect(cleanTyped("")).toBe("");
  });

  it("names every mark the paper cannot hold at once (ST-04: legacy half marks)", () => {
    const sheet: Record<string, Cell> = {
      a: { state: "value", value: 61.5 },
      b: { state: "value", value: 70 },
      c: { state: "value", value: 70.5 },
      d: { state: "absent", value: null },
      e: { state: "value", value: 85 },
    };
    expect(misfits(["a", "b", "c", "d", "e"], sheet, 80, 1)).toEqual(["a", "c", "e"]);
    expect(misfits(["a", "b", "c"], sheet, 80, 0.5)).toEqual([]);
  });

  const order = ["a", "b", "c", "d"];
  const cells: Record<string, Cell> = {
    a: { state: "value", value: 50 },
    b: { state: "absent", value: null },
    c: { state: "blank", value: null },
    d: { state: "value", value: 20 },
  };

  it("jumps to the next child without a mark", () => {
    expect(nextBlank(order, cells, 0)).toBe(2);
    expect(nextBlank(order, cells, 2)).toBe(2);
    expect(nextBlank(order, { ...cells, c: { state: "value", value: 1 } }, 0)).toBe(-1);
  });

  it("counts, compares and sends the whole column", () => {
    expect(counts(order, cells)).toEqual({ entered: 2, absent: 1, exempt: 0, filled: 3, blank: 1, total: 4 });
    expect(changedIds(order, cells, { a: { state: "value", value: 50 } })).toEqual(["b", "d"]);
    expect(toEntries(["a", "c"], cells)).toEqual([
      { studentId: "a", state: "value", value: 50 },
      { studentId: "c", state: "blank", value: null },
    ]);
    expect(checkSummary(order, cells, 26)).toMatchObject({ highest: 50, lowest: 20, average: 35, below: ["d"], blanks: ["c"], absent: ["b"] });
  });
});

describe("words that leave the app", () => {
  it("builds a WhatsApp link with the country code", () => {
    expect(waLink("98290 12345", "Hi there")).toBe("https://wa.me/919829012345?text=Hi%20there");
    expect(waLink(null, "x")).toBe("https://wa.me/?text=x");
  });

  it("says what is pending and carries the link", () => {
    const text = reminderText({ teacherName: "Asha", examName: "Half-yearly", pending: ["Class 7 Science"], dueLabel: "Wed 14 Oct", link: "https://x/t/marks/abc", from: "Exam office" });
    expect(text).toContain("Class 7 Science");
    expect(text).toContain("https://x/t/marks/abc");
  });

  it("suggests remarks in both languages, from marks, subjects and attendance", () => {
    const list = suggestRemarks({ percent: 58, attendancePct: 70, strongest: "Hindi", weakest: "Maths" });
    expect(list.map((r) => r.source)).toEqual(["marks", "marks", "subjects", "attendance"]);
    expect(list[0].basis).toBe("58%");
    expect(list[2].text.en).toContain("Maths");
    expect(list.every((r) => r.text.hi)).toBe(true);
    expect(suggestRemarks({ percent: null, attendancePct: 90, strongest: null, weakest: null }).map((r) => r.source)).toEqual(["attendance"]);
    expect(remarkText({ en: "Good", hi: "अच्छा" })).toBe("Good\nअच्छा");
    expect(firstName("  Asha Devi ")).toBe("Asha");
  });
});
