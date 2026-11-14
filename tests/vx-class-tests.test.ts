import { describe, expect, it } from "vitest";

import {
  classSubjectTargets,
  countLine,
  countTargets,
  defaultTitle,
  fillAll,
  fillFor,
  filledLine,
  newTestProblem,
  roundToStep,
  testTitle,
  type CountedTest,
} from "@/vx/screens/exams/domain/class-tests";

const ID = "00000000-0000-4000-8000-000000000001";
const SUB = "00000000-0000-4000-8000-000000000002";

const test = (max: number, marks: Record<string, { value: number | null; absent?: boolean }>): CountedTest => ({
  id: `t${max}`,
  maxMarks: max,
  marks: new Map(Object.entries(marks).map(([k, v]) => [k, { value: v.value, absent: v.absent ?? false }])),
});

describe("class tests: a new test", () => {
  it("needs a class-subject, a sane out-of and a day not after today", () => {
    expect(newTestProblem({ classId: "x", subjectId: SUB, maxMarks: 20 }, "2026-11-14")).toBe("pick_class");
    expect(newTestProblem({ classId: ID, subjectId: SUB, maxMarks: 0 }, "2026-11-14")).toBe("bad_marks");
    expect(newTestProblem({ classId: ID, subjectId: SUB, maxMarks: 501 }, "2026-11-14")).toBe("bad_marks");
    expect(newTestProblem({ classId: ID, subjectId: SUB, maxMarks: 12.3 }, "2026-11-14")).toBe("bad_marks");
    expect(newTestProblem({ classId: ID, subjectId: SUB, maxMarks: 20, heldOn: "2026-11-15" }, "2026-11-14")).toBe("bad_day");
    expect(newTestProblem({ classId: ID, subjectId: SUB, maxMarks: 20, title: "x".repeat(81) }, "2026-11-14")).toBe("bad_title");
    expect(newTestProblem({ classId: ID, subjectId: SUB, maxMarks: 12.5, heldOn: "2026-11-13" }, "2026-11-14")).toBeNull();
  });

  it("names an untitled test by its day, in both languages", () => {
    expect(defaultTitle("2026-11-14")).toBe("Test · 14 Nov");
    expect(testTitle({ title: "Test · 14 Nov", heldOn: "2026-11-14" })).toEqual({ en: "Test · 14 Nov", hi: "टेस्ट · 14 नवं" });
    expect(testTitle({ title: "Chapter 3 quiz", heldOn: "2026-11-14" })).toEqual({ en: "Chapter 3 quiz", hi: "Chapter 3 quiz" });
  });
});

describe("class tests: filling a school exam paper", () => {
  it("rounds half up to the paper's step", () => {
    expect(roundToStep(12.5, 1)).toBe(13);
    expect(roundToStep(12.49, 1)).toBe(12);
    expect(roundToStep(12.25, 0.5)).toBe(12.5);
  });

  it("is total scored over total out of, times the paper's maximum", () => {
    const tests = [test(10, { a: { value: 8 } }), test(25, { a: { value: 20 } })];
    // 28 of 35 = 0.8 of 20 = 16
    expect(fillFor("a", tests, 20, 1)).toEqual({ value: 16, sat: 2, scored: 28, outOf: 35 });
  });

  it("leaves out a test the child missed, never counting it as zero", () => {
    const tests = [test(10, { a: { value: 9 } }), test(10, { a: { value: null, absent: true } }), test(10, {})];
    expect(fillFor("a", tests, 20, 1).value).toBe(18);
  });

  it("suggests nothing for a child who sat none of them", () => {
    const tests = [test(10, { a: { value: null, absent: true } })];
    expect(fillFor("a", tests, 20, 1).value).toBeNull();
    expect(fillAll(["a", "b"], [test(10, { b: { value: 5 } })], 20, 1)).toEqual({ b: 10 });
  });

  it("never goes past the paper's maximum", () => {
    expect(fillFor("a", [test(10, { a: { value: 10 } })], 15, 1).value).toBe(15);
  });

  it("says what it did, and that she checks", () => {
    expect(filledLine(3, 1).en).toContain("3 blank boxes were filled");
    expect(filledLine(1, 0).en).toContain("1 blank box was filled");
    expect(filledLine(3, 1).en).toContain("Check each mark");
  });
});

describe("class tests: which exams they can count in", () => {
  const exams = [
    { id: "fa1", code: "FA1", labelEn: "Test I", labelHi: "टेस्ट I", kind: "formative", status: "open", startsOn: "2026-08-01" },
    { id: "hy", code: "SA1", labelEn: "Half Yearly", labelHi: "अर्धवार्षिक", kind: "summative", status: "open", startsOn: "2026-09-20" },
    { id: "fa2", code: "FA2", labelEn: "Test II", labelHi: "टेस्ट II", kind: "formative", status: "draft", startsOn: "2026-12-01" },
    { id: "fa3", code: "FA3", labelEn: "Test III", labelHi: "टेस्ट III", kind: "formative", status: "open", startsOn: "2026-12-20" },
  ];

  it("offers open formative exams with a paper for the class-subject, never a summative one", () => {
    expect(countTargets(exams, (id) => id !== "fa3").map((t) => t.id)).toEqual(["fa1"]);
    expect(countTargets(exams, () => true).map((t) => t.id)).toEqual(["fa1", "fa3"]);
  });

  it("offers only an exam whose paper here is still open, and keeps the one a test already counts in", () => {
    const papers = [
      { assessment_id: "fa1", class_id: "c", subject_id: "s", entry_status: "submitted" },
      { assessment_id: "fa3", class_id: "c", subject_id: "s", entry_status: "open" },
      { assessment_id: "fa1", class_id: "c", subject_id: "other", entry_status: "open" },
    ];
    expect(classSubjectTargets(exams, papers, "c", "s").map((t) => t.id)).toEqual(["fa3"]);
    expect(classSubjectTargets(exams, papers, "c", "s", "fa1").map((t) => t.id)).toEqual(["fa1", "fa3"]);
    expect(classSubjectTargets(exams, papers, "c", "s", "hy").map((t) => t.id)).toEqual(["fa3"]);
    expect(classSubjectTargets(exams, papers, "c", "none")).toEqual([]);
  });

  it("says where a test counts", () => {
    expect(countLine(null).en).toBe("Progress only");
    expect(countLine({ en: "Test I", hi: "टेस्ट I" })).toEqual({ en: "Counts in Test I", hi: "टेस्ट I में जुड़ेगा" });
  });
});
