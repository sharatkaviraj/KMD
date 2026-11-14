import { describe, expect, it } from "vitest";

import type { Assessment, AssessmentSubject, Mark } from "@/modules/assessments/domain/assessments";
import { buildReportCard, rankClassCards } from "@/modules/assessments/domain/report-card";
import { gradeWith } from "@/modules/assessments/domain/report-scheme";
import { percentText, rankLine, ruledResult } from "@/vx/screens/exams/domain/card-words";
import {
  classRanks,
  divisionFor,
  LETTER_BANDS,
  ordinal,
  ruleForClass,
  WORD_BANDS,
} from "@/modules/assessments/domain/result-rules";

/*
 * D-611: the school's result rules per class group, read off its own Half
 * Yearly Result Register. Every child here is synthetic; the numbers are made
 * up to sit on the register's boundaries.
 */

const assessment = (over: Partial<Assessment> & { id: string; code: string }): Assessment => ({
  sessionLabel: "TEST-2026-27",
  term: "Term 1",
  labelHi: over.code,
  labelEn: over.code,
  kind: "formative",
  startsOn: null,
  endsOn: null,
  weight: 1,
  status: "open",
  lockedAt: null,
  lockedByName: null,
  ...over,
});

const EXAMS = [
  assessment({ id: "fa1", code: "FA1", labelEn: "Test I" }),
  assessment({ id: "fa2", code: "FA2", labelEn: "Test II" }),
  assessment({ id: "sa1", code: "SA1", labelEn: "Half Yearly", kind: "summative" }),
];

const paper = (classLabel: string, assessmentId: string, subjectCode: string, maxMarks: number): AssessmentSubject => ({
  id: `${subjectCode}-${assessmentId}`,
  assessmentId,
  classId: "c",
  classLabel,
  subjectId: subjectCode,
  subjectCode,
  maxMarks,
  passMarks: null,
  sortOrder: 0,
  markStep: 0.5,
  allowExempt: false,
  entryStatus: "submitted",
  entryRevision: 1,
  submittedAt: null,
});

type Cell = number | "A" | null;

/** A Class 1–8 layout: each subject 20 + 20 + 60, Robotics 50 on the Half Yearly only. */
function primaryCard(classLabel: string, marks: Record<string, [Cell, Cell, Cell]>, robotics: Cell = 40, id = "kid", grace?: Map<string, number>) {
  const papers: AssessmentSubject[] = [];
  const map = new Map<string, Mark>();
  const put = (p: AssessmentSubject, cell: Cell) => {
    papers.push(p);
    if (cell === null) return;
    map.set(`${p.id}|${id}`, { studentId: id, value: cell === "A" ? null : cell, absent: cell === "A", exempt: false, enteredByName: null, enteredAt: null });
  };
  for (const [subject, [a, b, c]] of Object.entries(marks)) {
    put(paper(classLabel, "fa1", subject, 20), a);
    put(paper(classLabel, "fa2", subject, 20), b);
    put(paper(classLabel, "sa1", subject, 60), c);
  }
  put(paper(classLabel, "sa1", "Robotics", 50), robotics);
  return buildReportCard({
    sessionLabel: "TEST-2026-27",
    term: "Term 1",
    student: { id, fullName: "Test Child", admissionNo: null, rollNo: null, classLabel, fatherName: null },
    assessments: EXAMS,
    papers,
    marks: map,
    attendance: null,
    grace,
    rule: ruleForClass(classLabel),
    generatedAt: "2026-11-14T00:00:00Z",
  });
}

describe("which rule a class follows", () => {
  it("reads it off the class name", () => {
    expect(ruleForClass("Nursery")?.key).toBe("pre_primary");
    expect(ruleForClass("JKG")?.key).toBe("pre_primary");
    expect(ruleForClass("SKG")?.key).toBe("pre_primary");
    expect(ruleForClass("Class 1")?.key).toBe("primary");
    expect(ruleForClass("Class 4")?.key).toBe("primary");
    expect(ruleForClass("Class 5")?.key).toBe("board");
    expect(ruleForClass("Class 6")?.key).toBe("primary");
    expect(ruleForClass("Class 8")?.key).toBe("board");
    expect(ruleForClass("Class 10")?.key).toBe("senior");
    expect(ruleForClass("11 Science")?.key).toBe("senior");
    expect(ruleForClass("QA Isolated")).toBeNull();
  });

  it("grades in the register's own bands", () => {
    expect(gradeWith(96, WORD_BANDS)?.label).toBe("Outstanding");
    expect(gradeWith(95.5, WORD_BANDS)?.label).toBe("Excellent");
    expect(gradeWith(80, WORD_BANDS)?.label).toBe("Very Good");
    expect(gradeWith(69.5, WORD_BANDS)?.label).toBe("Growing");
    expect(gradeWith(91, LETTER_BANDS)?.label).toBe("A1");
    expect(gradeWith(90.99, LETTER_BANDS)?.label).toBe("A2");
    expect(gradeWith(33, LETTER_BANDS)?.label).toBe("D");
    expect(gradeWith(32.99, LETTER_BANDS)?.label).toBe("E");
  });
});

describe("a Class 3 card under the register's rule", () => {
  const full = primaryCard("Class 3", { HINDI: [17, 18, 50], ENGLISH: [15, 16, 40], MATHS: [14, 15, 49], EVS: [15, 16, 32], CCS: [15, 16, 47] }, 45);

  it("keeps Robotics apart from the total, as the register prints it", () => {
    expect(full.rows.map((r) => r.subjectCode)).not.toContain("Robotics");
    expect(full.apart?.map((r) => r.subjectCode)).toEqual(["Robotics"]);
    expect(full.apart?.[0].scored).toBe(45);
    expect(full.totals.scored).toBe(375);
    expect(full.totals.outOf).toBe(500);
  });

  it("prints the percentage at two decimals and grades it", () => {
    expect(full.totals.percent).toBe(75);
    expect(full.grade).toBe("B1");
    expect(full.status).toBe("complete");
    expect(full.passed).toBe(true);
  });

  it("is not passed when one subject is under 33% of its own total", () => {
    const short = primaryCard("Class 3", { HINDI: [17, 18, 50], MATHS: [5, 5, 22] });
    expect(short.rows.find((r) => r.subjectCode === "MATHS")?.percent).toBe(32);
    expect(short.passed).toBe(false);
    expect(short.shortIn).toEqual(["MATHS"]);
  });

  it("counts grace towards the subject's 33%", () => {
    const grace = new Map([["MATHS-sa1", 1]]);
    const lifted = primaryCard("Class 3", { HINDI: [17, 18, 50], MATHS: [5, 5, 22] }, 40, "kid", grace);
    expect(lifted.passed).toBe(true);
    expect(lifted.shortIn).toEqual([]);
  });

  it("holds the result while a paper is missed: no percentage, grade or rank", () => {
    const pending = primaryCard("Class 3", { HINDI: [17, 18, "A"], MATHS: [14, 15, 49] });
    expect(pending.status).toBe("pending");
    expect(pending.pendingIn).toEqual(["HINDI"]);
    expect(pending.totals.percent).toBeNull();
    expect(pending.grade).toBeNull();
    expect(pending.passed).toBeNull();
    expect(pending.rows.find((r) => r.subjectCode === "HINDI")?.percent).toBeNull();
    // The marks it has still add up on the card.
    expect(pending.totals.scored).toBe(17 + 18 + 14 + 15 + 49);
  });

  it("holds it while a paper has no mark yet, too", () => {
    expect(primaryCard("Class 3", { HINDI: [17, 18, null] }).status).toBe("pending");
  });

  it("reads Absent for a child who missed every paper, and a missed Robotics holds nothing", () => {
    expect(primaryCard("Class 3", { HINDI: ["A", "A", "A"], MATHS: ["A", "A", "A"] }).status).toBe("absent");
    expect(primaryCard("Class 3", { HINDI: [17, 18, 50] }, "A").status).toBe("complete");
  });
});

describe("the board classes and Nursery to SKG", () => {
  it("never says Pass or Not passed for Class 5 or 8, but still names a weak subject", () => {
    const board = primaryCard("Class 8", { HINDI: [17, 18, 50], MATHS: [5, 5, 22] });
    expect(board.passed).toBeNull();
    expect(board.shortIn).toEqual(["MATHS"]);
    expect(board.rule?.verdict).toBe(false);
    expect(board.grade).not.toBeNull();
  });

  it("grades Nursery in words at one decimal, with no pass or fail", () => {
    const papers = ["HINDI", "MATHS"].flatMap((s) => [paper("Nursery", "fa1", s, 15), paper("Nursery", "fa2", s, 15), paper("Nursery", "sa1", s, 20)]);
    const values: Record<string, number> = { "HINDI-fa1": 13, "HINDI-fa2": 13, "HINDI-sa1": 20, "MATHS-fa1": 3, "MATHS-fa2": 4, "MATHS-sa1": 5 };
    const card = buildReportCard({
      sessionLabel: "TEST-2026-27",
      term: "Term 1",
      student: { id: "k", fullName: "Test Child", admissionNo: null, rollNo: null, classLabel: "Nursery", fatherName: null },
      assessments: EXAMS,
      papers,
      marks: new Map(Object.entries(values).map(([id, v]) => [`${id}|k`, { studentId: "k", value: v, absent: false, exempt: false, enteredByName: null, enteredAt: null }])),
      attendance: null,
      rule: ruleForClass("Nursery"),
      generatedAt: "2026-11-14T00:00:00Z",
    });
    // 58 of 100.
    expect(card.totals.percent).toBe(58);
    expect(card.grade).toBe("Growing");
    expect(card.passed).toBeNull();
    expect(card.shortIn).toEqual([]);
  });
});

describe("rank in class", () => {
  it("ranks by percentage with ties sharing a place, leaving pending children out", () => {
    const a = primaryCard("Class 6", { HINDI: [20, 20, 60] }, 40, "a");
    const b = primaryCard("Class 6", { HINDI: [18, 18, 50] }, 40, "b");
    const c = primaryCard("Class 6", { HINDI: [18, 18, 50] }, 40, "c");
    const d = primaryCard("Class 6", { HINDI: [10, 10, 40] }, 40, "d");
    const e = primaryCard("Class 6", { HINDI: [10, 10, "A"] }, 40, "e");
    const ranked = rankClassCards([a, b, c, d, e]);
    expect(ranked.map((x) => x.rank)).toEqual([1, 2, 2, 4, null]);
    expect(ranked[0].rankOf).toBe(4);
  });

  it("never ranks Nursery to SKG", () => {
    expect(classRanks([{ id: "x", percent: 90, ranked: false }]).size).toBe(0);
  });

  it("says a place the way people say it", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
  });
});

describe("Rajasthan Board divisions for 9–12", () => {
  it("is First at 60, Second at 45, Third at 33", () => {
    expect(divisionFor(60)?.key).toBe("first");
    expect(divisionFor(59.99)?.key).toBe("second");
    expect(divisionFor(45)?.key).toBe("second");
    expect(divisionFor(33)?.key).toBe("third");
    expect(divisionFor(32.99)).toBeNull();
  });

  it("names it on a complete Class 10 card", () => {
    const card = primaryCard("Class 10", { HINDI: [15, 15, 40], MATHS: [12, 12, 40] });
    expect(card.totals.percent).toBe(67);
    expect(card.division?.key).toBe("first");
  });
});

describe("what the card says under the rule", () => {
  const base = { rule: { key: "primary", verdict: true }, status: "complete" as const, passed: true, shortIn: [], pendingIn: [] };
  const maths = { en: "Maths", hi: "गणित" };

  it("says Pass, or names the subjects needing support", () => {
    expect(ruledResult(base)?.text).toBe("Pass · उत्तीर्ण");
    expect(ruledResult({ ...base, passed: false, shortIn: [maths] })?.text).toBe("Needs support in Maths · गणित में सहायता चाहिए");
  });

  it("says Result pending with the subjects, and Absent for a child who missed everything", () => {
    expect(ruledResult({ ...base, status: "pending", passed: null, pendingIn: [maths] })?.text).toBe("Result pending: Maths · परिणाम लंबित: गणित");
    expect(ruledResult({ ...base, status: "absent", passed: null })?.tone).toBe("bad");
  });

  it("never says Pass for a board class", () => {
    const board = { ...base, rule: { key: "board", verdict: false }, passed: null };
    expect(ruledResult(board)?.text).toContain("the board declares the result");
    expect(ruledResult({ ...board, shortIn: [maths] })?.text).toContain("Needs support in Maths");
  });

  it("says nothing more for Nursery to SKG, whose grade is the result, or a class with no rule", () => {
    expect(ruledResult({ ...base, rule: { key: "pre_primary", verdict: false }, passed: null })).toBeNull();
    expect(ruledResult({ ...base, rule: null })).toBeNull();
  });

  it("adds the division for 9–12", () => {
    expect(ruledResult({ ...base, rule: { key: "senior", verdict: true }, division: { en: "First division", hi: "प्रथम श्रेणी" } })?.text).toBe("Pass · First division · उत्तीर्ण · प्रथम श्रेणी");
  });

  it("prints the place and the percentage the way the register does", () => {
    expect(rankLine(3, 32)).toBe("3rd of 32 · कक्षा में 3वाँ स्थान (32 में)");
    expect(rankLine(null, 32)).toBe("");
    expect(percentText(75, 2)).toBe("75.00%");
    expect(percentText(95.5, 1)).toBe("95.5%");
    expect(percentText(null, 2)).toBe("—");
  });
});
