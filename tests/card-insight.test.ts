import { describe, expect, it } from "vitest";

import type { ReportCard, ReportRow } from "@/modules/assessments/domain/report-card";
import { cardInsight, trendOf, withInsights } from "@/modules/assessments/domain/card-insight";

/*
 * D-612: each subject beside the class, and effort measured as the change in
 * the child's gap to the class average from the first exam of the term to the
 * last. Every child here is made up.
 */

type Cell = number | "A" | null;
const EXAMS = [
  { code: "FA1", en: "Test I", hi: "टेस्ट I", max: 20 },
  { code: "FA2", en: "Test II", hi: "टेस्ट II", max: 20 },
  { code: "SA1", en: "Half Yearly", hi: "अर्धवार्षिक", max: 60 },
];

function row(subjectCode: string, cells: [Cell, Cell, Cell]): ReportRow {
  return {
    subjectCode,
    classLabel: "Class 3",
    marks: EXAMS.map((e, i) => ({
      assessmentCode: e.code,
      assessmentLabelEn: e.en,
      assessmentLabelHi: e.hi,
      value: typeof cells[i] === "number" ? (cells[i] as number) : null,
      absent: cells[i] === "A",
      exempt: false,
      maxMarks: e.max,
      weight: 1,
    })),
    scored: 0,
    outOf: 100,
    percent: null,
    grade: null,
  };
}

const card = (id: string, subjects: Record<string, [Cell, Cell, Cell]>): Pick<ReportCard, "studentId" | "rows"> => ({
  studentId: id,
  rows: Object.entries(subjects).map(([code, cells]) => row(code, cells)),
});

describe("trendOf", () => {
  it("counts five points against the class as a real move", () => {
    expect(trendOf(5)).toBe("up");
    expect(trendOf(4.9)).toBe("steady");
    expect(trendOf(-5)).toBe("down");
    expect(trendOf(null)).toBeNull();
  });
});

describe("cardInsight", () => {
  // Maths: the class does 10/20 in Test I and 30/60 in the Half Yearly (50% each time).
  const others = [
    card("b", { Maths: [10, 10, 30], Hindi: [14, 14, 42], English: [12, 12, 36] }),
    card("c", { Maths: [10, 10, 30], Hindi: [14, 14, 42], English: [12, 12, 36] }),
  ];

  it("measures growth against the class, not the raw marks", () => {
    // 8/20 = 40% (10 under the class at 46.7%), then 39/60 = 65% (about 10 over it).
    const kid = card("a", { Maths: [8, 10, 39], Hindi: [14, 14, 42], English: [12, 12, 36] });
    const insight = cardInsight(kid, [kid, ...others]);
    const maths = insight.subjects.find((s) => s.subjectCode === "Maths")!;
    expect(maths.exams.map((e) => e.percent)).toEqual([40, 50, 65]);
    expect(maths.exams[0].classAvg).toBe(46.7);
    expect(maths.exams[2].classAvg).toBe(55);
    expect(maths.growth).toBe(16.7);
    expect(maths.trend).toBe("up");
    const hindi = insight.subjects.find((s) => s.subjectCode === "Hindi")!;
    expect(hindi.trend).toBe("steady");
    expect(insight.effort).toEqual({ measured: 3, up: 1, steady: 2, down: 0 });
  });

  it("does not punish a hard paper the whole class found hard", () => {
    // Everyone drops from 80% to 50%; this child drops with them and stays level.
    const a = card("a", { Maths: [16, 16, 30] });
    const b = card("b", { Maths: [16, 16, 30] });
    const insight = cardInsight(a, [a, b]);
    expect(insight.subjects[0].growth).toBe(0);
    expect(insight.subjects[0].trend).toBe("steady");
  });

  it("leaves a missed paper out instead of counting it as nought", () => {
    const kid = card("a", { Maths: ["A", 10, 30] });
    const insight = cardInsight(kid, [kid, card("b", { Maths: [10, 10, 30] })]);
    const maths = insight.subjects[0];
    expect(maths.exams[0].percent).toBeNull();
    // Measured from Test II, the first paper sat.
    expect(maths.growth).toBe(0);
    expect(maths.percent).toBe(50);
  });

  it("measures nothing from a single exam", () => {
    const kid = card("a", { Maths: [null, null, 45] });
    const insight = cardInsight(kid, [kid, card("b", { Maths: [null, null, 30] })]);
    expect(insight.subjects[0].growth).toBeNull();
    expect(insight.subjects[0].trend).toBeNull();
    expect(insight.effort.measured).toBe(0);
  });

  it("names the best subjects and the ones well under the class", () => {
    const kid = card("a", { Maths: [18, 19, 57], Hindi: [6, 7, 20], English: [15, 15, 45], EVS: [12, 12, 36] });
    const peer = card("b", { Maths: [12, 12, 36], Hindi: [14, 14, 42], English: [12, 12, 36], EVS: [12, 12, 36] });
    const insight = cardInsight(kid, [kid, peer]);
    expect(insight.strengths).toEqual(["Maths", "English"]);
    expect(insight.focus).toEqual(["Hindi"]);
    expect(insight.subjects.find((s) => s.subjectCode === "Maths")!.classTop).toBe(94);
  });

  it("follows the term overall, exam by exam", () => {
    const kid = card("a", { Maths: [10, 15, 54], Hindi: [10, 15, 54] });
    const peer = card("b", { Maths: [10, 10, 30], Hindi: [10, 10, 30] });
    const insight = cardInsight(kid, [kid, peer]);
    expect(insight.journey.map((j) => j.percent)).toEqual([50, 75, 90]);
    expect(insight.journey.map((j) => j.classAvg)).toEqual([50, 62.5, 70]);
    expect(insight.growth).toBe(20);
    expect(insight.trend).toBe("up");
    expect(insight.classSize).toBe(2);
  });

  it("gives every card of a class its own insight", () => {
    const cards = [card("a", { Maths: [10, 10, 30] }), card("b", { Maths: [20, 20, 60] })];
    const out = withInsights(cards);
    expect(out.map((c) => c.insight.subjects[0].percent)).toEqual([50, 100]);
    expect(out[0].insight.subjects[0].classAvg).toBe(75);
  });
});
