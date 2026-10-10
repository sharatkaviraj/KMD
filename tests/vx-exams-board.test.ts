import { describe, expect, it } from "vitest";

import { cellCounts, cellMatches, cellState, codeFor, neighbours, papersToCreate } from "@/vx/screens/exams/domain/board";
import type { PaperFacts } from "@/vx/screens/exams/domain/tracker";

const paper = (over: Partial<PaperFacts> = {}): PaperFacts => ({
  paperId: "p1",
  classId: "c1",
  classLabel: "Class 4",
  classSort: 4,
  subjectCode: "Maths",
  teacherId: "t1",
  teacherName: "Teacher A",
  total: 20,
  entered: 0,
  entryStatus: "open",
  entryRevision: 0,
  maxMarks: 50,
  passMarks: 17,
  ...over,
});

describe("cellState", () => {
  it("shows a locked class as locked whatever its papers say", () => {
    expect(cellState(paper({ entered: 3 }), true)).toBe("locked");
  });
  it("calls a sent paper done, typed marks in progress, nothing not started", () => {
    expect(cellState(paper({ entered: 20, entryStatus: "submitted" }), false)).toBe("done");
    expect(cellState(paper({ entered: 20 }), false)).toBe("in_progress");
    expect(cellState(paper({ entered: 0 }), false)).toBe("not_started");
  });
  it("has nothing to enter for a class with nobody on the roll", () => {
    expect(cellState(paper({ total: 0 }), false)).toBe("empty");
  });
});

describe("cellCounts and filters", () => {
  const papers = [
    paper({ paperId: "a", entered: 0 }),
    paper({ paperId: "b", entered: 5 }),
    paper({ paperId: "c", entered: 20, entryStatus: "submitted" }),
    paper({ paperId: "d", classId: "c2", entered: 20, entryStatus: "submitted" }),
  ];
  it("counts each state and the late ones", () => {
    const c = cellCounts(papers, new Set(["c2"]), 1);
    expect(c).toMatchObject({ all: 4, not_started: 1, in_progress: 1, done: 1, locked: 1 });
    expect(c.late).toBe(2);
  });
  it("only counts unfinished papers as late", () => {
    expect(cellCounts(papers, new Set(), 0).late).toBe(0);
  });
  it("filters by state, and late only among unfinished cells", () => {
    expect(cellMatches("all", "done", false)).toBe(true);
    expect(cellMatches("done", "done", false)).toBe(true);
    expect(cellMatches("done", "locked", false)).toBe(false);
    expect(cellMatches("late", "not_started", true)).toBe(true);
    expect(cellMatches("late", "done", true)).toBe(false);
  });
});

describe("papersToCreate", () => {
  const classes = [
    { id: "k9", label: "Class 9", sort: 9 },
    { id: "nur", label: "Nursery", sort: 0 },
    { id: "odd", label: "Hobby club", sort: 50 },
  ];
  const subjects = [
    { id: "m", code: "MATHS", sortOrder: 2, isActive: true },
    { id: "e", code: "English", sortOrder: 1, isActive: true },
    { id: "s", code: "Sports", sortOrder: 3, isActive: true },
    { id: "x", code: "Old", sortOrder: 4, isActive: false },
  ];
  const plan = papersToCreate({
    assignments: [
      { classId: "k9", subjectId: "m" },
      { classId: "k9", subjectId: "m" },
      { classId: "k9", subjectId: "e" },
      { classId: "k9", subjectId: "s" },
      { classId: "k9", subjectId: "x" },
      { classId: "nur", subjectId: "e" },
      { classId: "odd", subjectId: "e" },
    ],
    classes,
    subjects,
    maxFor: (g) => (g === "pre" ? 25 : 80),
  });
  it("makes one paper per class-subject, in class then subject order", () => {
    expect(plan.map((x) => `${x.classLabel}/${x.subjectCode}/${x.sortOrder}`)).toEqual(["Nursery/English/0", "Class 9/English/0", "Class 9/MATHS/1"]);
  });
  it("leaves out sports, inactive subjects and classes in no band", () => {
    expect(plan.some((x) => x.subjectCode === "Sports" || x.subjectCode === "Old" || x.classId === "odd")).toBe(false);
  });
  it("takes the band's maximum and a third of it as the pass mark", () => {
    expect(plan[0]).toMatchObject({ maxMarks: 25, passMarks: 9 });
    expect(plan[1]).toMatchObject({ maxMarks: 80, passMarks: 27 });
  });
});

describe("neighbours and codeFor", () => {
  it("gives the child before and after", () => {
    expect(neighbours(["a", "b", "c"], 1)).toEqual({ prev: "a", next: "c", position: 2, of: 3 });
    expect(neighbours(["a"], 0)).toEqual({ prev: null, next: null, position: 1, of: 1 });
    expect(neighbours(["a"], 5).position).toBe(0);
  });
  it("makes a short code from a name", () => {
    expect(codeFor("Unit Test 3")).toBe("UT3");
    expect(codeFor("Half-yearly")).toBe("HY");
    expect(codeFor("  ")).toBe("EXAM");
  });
});
