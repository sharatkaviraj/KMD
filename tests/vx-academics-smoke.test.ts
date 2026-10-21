import { describe, expect, it } from "vitest";

import { totalsFor, type PaperResult } from "@/modules/assessments/domain/assessments";
import { attentionChips, childExams, classPair, marksFlags, pooledPct, presentPct, repeatedNames, tally, type MarkRow } from "@/vx/screens/academics/domain";

/*
 * The academic coordinator's findings from the 20 Oct school-day smoke run,
 * pinned on synthetic records (no real names).
 */

const FA = "exam-fa";
const SA = "exam-sa";
const REHEARSAL = "exam-undated";

const mark = (patch: Partial<MarkRow> & Pick<MarkRow, "studentId" | "examId" | "subject">): MarkRow => ({
  classId: "class-1",
  subjectId: `sub-${patch.subject}`,
  value: null,
  absent: false,
  exempt: false,
  maxMarks: 100,
  passMarks: 33,
  ...patch,
});

describe("needs attention · marks rules (finding ebf5260f)", () => {
  it("does not read a blank, an absent or an exempt as 0%", () => {
    const flags = marksFlags(
      [
        mark({ studentId: "a", examId: FA, subject: "MATHS", value: 80 }),
        mark({ studentId: "a", examId: SA, subject: "MATHS", value: null }),
        mark({ studentId: "a", examId: SA, subject: "EVS", absent: true }),
        mark({ studentId: "a", examId: SA, subject: "Hindi", exempt: true }),
        mark({ studentId: "a", examId: SA, subject: "English", value: 79 }),
      ],
      [FA, SA],
    );
    expect(flags.has("a")).toBe(false);
  });

  it("ignores an exam that is not one of the school's dated exams", () => {
    // A rehearsal run put 0 in every Class 1 paper; the child's real marks are strong.
    const rows = [
      mark({ studentId: "top", examId: FA, subject: "EVS", value: 95 }),
      mark({ studentId: "top", examId: SA, subject: "EVS", value: 97 }),
      mark({ studentId: "top", examId: REHEARSAL, subject: "EVS", value: 0, maxMarks: 40 }),
      mark({ studentId: "top", examId: REHEARSAL, subject: "MATHS", value: 0, maxMarks: 40 }),
    ];
    expect(marksFlags(rows, [FA, SA]).has("top")).toBe(false);
  });

  it("flags a real low mark and a real drop, by the subject's latest paper", () => {
    const flags = marksFlags(
      [
        mark({ studentId: "b", examId: FA, subject: "MATHS", value: 70 }),
        mark({ studentId: "b", examId: SA, subject: "MATHS", value: 30 }),
        mark({ studentId: "b", examId: FA, subject: "EVS", value: 20 }),
        mark({ studentId: "b", examId: SA, subject: "EVS", value: 60 }),
        mark({ studentId: "b", examId: FA, subject: "Hindi", value: 90, maxMarks: 100 }),
        mark({ studentId: "b", examId: SA, subject: "Hindi", value: 60, maxMarks: 80 }),
      ],
      [FA, SA],
    );
    // EVS was below 33 in FA but not in its latest paper.
    expect(flags.get("b")).toEqual({ below33Subjects: ["MATHS"], dropPoints: 40, dropSubject: "MATHS" });
  });

  it("does not call a first paper a drop", () => {
    const flags = marksFlags([mark({ studentId: "c", examId: SA, subject: "MATHS", value: 50 })], [FA, SA]);
    expect(flags.has("c")).toBe(false);
  });

  it("names subjects in Hindi for a Hindi reader", () => {
    const chips = attentionChips(
      { reasons: ["below_33"], attendancePct: null, below33Subjects: ["MATHS", "EVS"], dropPoints: null, dropSubject: null, openNotes: 0 },
      (code) => ({ MATHS: "गणित", EVS: "पर्यावरण" })[code] ?? code,
    );
    expect(chips[0].text).toEqual({ en: "Below 33% in Maths & EVS", hi: "गणित व पर्यावरण में 33% से कम" });
  });
});

describe("a child's exam result (finding 4ecf0659)", () => {
  const rows = [
    mark({ studentId: "s", examId: SA, subject: "Hindi", value: 90, maxMarks: 100 }),
    mark({ studentId: "s", examId: SA, subject: "English", value: 98, maxMarks: 100 }),
    mark({ studentId: "s", examId: SA, subject: "MATHS", absent: true, maxMarks: 100 }),
    mark({ studentId: "s", examId: SA, subject: "Science", value: null, maxMarks: 100 }),
    mark({ studentId: "s", examId: SA, subject: "Sanskrit", exempt: true, maxMarks: 100 }),
  ];

  it("counts an absent as 0 out of the paper's marks and leaves a blank and an exempt out", () => {
    const [r] = childExams(rows);
    expect(r).toMatchObject({ scored: 188, outOf: 300, absent: 1, missing: 1, counted: 2, failed: 1 });
    expect(r.pct).toBe(62.7);
  });

  it("gives the report card's percentage (totalsFor)", () => {
    const results: PaperResult[] = rows.map((m) => ({
      paper: { maxMarks: m.maxMarks } as unknown as PaperResult["paper"],
      mark: { studentId: m.studentId, value: m.value, absent: m.absent, exempt: m.exempt, enteredByName: null, enteredAt: null },
    }));
    expect(childExams(rows)[0].pct).toBe(totalsFor(results).percent);
  });

  it("ranks a child who missed a paper below one who sat every paper", () => {
    const sat = [
      mark({ studentId: "t", examId: SA, subject: "Hindi", value: 80 }),
      mark({ studentId: "t", examId: SA, subject: "English", value: 80 }),
      mark({ studentId: "t", examId: SA, subject: "MATHS", value: 80 }),
    ];
    const missed = [
      mark({ studentId: "u", examId: SA, subject: "Hindi", value: 95 }),
      mark({ studentId: "u", examId: SA, subject: "English", value: 95 }),
      mark({ studentId: "u", examId: SA, subject: "MATHS", absent: true }),
    ];
    const by = new Map(childExams([...sat, ...missed]).map((c) => [c.studentId, c.pct]));
    expect(by.get("t")).toBe(80);
    expect(by.get("u")).toBeCloseTo(63.3, 1);
  });

  it("has no percentage while nothing is entered", () => {
    expect(childExams([mark({ studentId: "v", examId: SA, subject: "Hindi" })])[0].pct).toBeNull();
  });
});

describe("one attendance number per class and month (finding 144ea003)", () => {
  it("pools every child-day rather than averaging daily percentages", () => {
    // Day 1: 9 of 10 present. Day 2: 2 of 4 present (a small register).
    const day1 = tally([...Array(9).fill("present"), "absent"]);
    const day2 = tally(["present", "present", "absent", "absent"]);
    expect(pooledPct([day1, day2])).toBe(78.6);
    // The register's class average pools the same child-days.
    const register = tally([...Array(9).fill("present"), "absent", "present", "present", "absent", "absent"]);
    expect(presentPct(register)).toBe(pooledPct([day1, day2]));
  });

  it("is empty when nothing was saved", () => {
    expect(pooledPct([])).toBeNull();
  });
});

describe("class names in Hindi (finding ce7bb85a)", () => {
  it("says the class and its stream in Hindi", () => {
    expect(classPair("Class 12 Commerce")).toEqual({ en: "Class 12 Commerce", hi: "कक्षा 12 वाणिज्य" });
    expect(classPair("11 Science").hi).toBe("कक्षा 11 विज्ञान");
    expect(classPair("Class 11 Arts").hi).toBe("कक्षा 11 कला");
    expect(classPair("Class 4").hi).toBe("कक्षा 4");
    expect(classPair("Nursery").hi).toBe("नर्सरी");
    expect(classPair("JKG")).toEqual({ en: "JKG" });
  });
});

describe("children with the same name (finding f485619d)", () => {
  it("marks every child whose name another child in the class has", () => {
    const rows = [
      { studentId: "1", name: "Test Child" },
      { studentId: "2", name: "test  child" },
      { studentId: "3", name: "Other Child" },
    ];
    expect([...repeatedNames(rows)].sort()).toEqual(["1", "2"]);
  });
});
