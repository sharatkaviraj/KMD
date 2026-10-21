import { describe, expect, it } from "vitest";

import type { Assessment, AssessmentSubject, Mark } from "@/modules/assessments/domain/assessments";
import { buildReportCard, cardResult, cardWeights, type CardScheme } from "@/modules/assessments/domain/report-card";
import { cellState, paperEvents } from "@/vx/screens/exams/domain/board";
import { supportLine, weightsLine } from "@/vx/screens/exams/domain/card-words";
import { subjectPair } from "@/vx/screens/exams/domain/groups";
import { paperBlockers, paperMix } from "@/vx/screens/exams/domain/progress";
import { isPaperComplete, overall, paperStatus, teacherLoads, type PaperFacts } from "@/vx/screens/exams/domain/tracker";

/*
 * The 20 Oct school day, results stream: a report card said "Pass" for a
 * child the Grace screen listed as short 26; the class list and the card gave
 * two percentages; the tracker ticked papers that still had marks to correct.
 * Synthetic data only.
 */

const exam = (id: string, code: string, weight: number, startsOn: string): Assessment => ({
  id,
  sessionLabel: "2026-27",
  term: "Term 1",
  code,
  labelHi: code === "FA1" ? "प्रथम रचनात्मक" : "अर्धवार्षिक",
  labelEn: code === "FA1" ? "First formative" : "Half yearly",
  kind: code === "FA1" ? "formative" : "summative",
  startsOn,
  endsOn: startsOn,
  weight,
  status: "open",
  lockedAt: null,
  lockedByName: null,
});

const EXAMS = [exam("fa1", "FA1", 1, "2026-08-13"), exam("sa1", "SA1", 2, "2026-09-23")];

const paper = (id: string, assessmentId: string, subjectCode: string, maxMarks: number, passMarks: number | null): AssessmentSubject => ({
  id,
  assessmentId,
  classId: "c9",
  classLabel: "Class 9",
  subjectId: `s-${subjectCode}`,
  subjectCode,
  maxMarks,
  passMarks,
  sortOrder: 0,
  markStep: 0.5,
  allowExempt: false,
  entryStatus: "submitted",
  entryRevision: 1,
  submittedAt: "2026-10-01T10:00:00Z",
});

const PAPERS = [
  paper("m-fa1", "fa1", "MATHS", 20, 7),
  paper("m-sa1", "sa1", "MATHS", 80, 26),
  paper("e-fa1", "fa1", "ENGLISH", 20, 7),
  paper("e-sa1", "sa1", "ENGLISH", 80, 26),
];

const mark = (over: Partial<Mark>): Mark => ({ studentId: "kid", value: null, absent: false, exempt: false, enteredByName: null, enteredAt: null, ...over });

const SCHEME: CardScheme = { id: "sch", revision: 1, percentDecimals: 1, passPercent: 33, bands: [{ from: 0, label: "E", en: "Needs work", hi: "मेहनत चाहिए" }], headerEn: null, headerHi: null, signatories: [] };

const card = (marks: Record<string, Partial<Mark>>, grace?: Record<string, number>) =>
  buildReportCard({
    sessionLabel: "2026-27",
    term: "Term 1",
    student: { id: "kid", fullName: "Test Child", admissionNo: null, rollNo: null, classLabel: "Class 9", fatherName: null },
    assessments: EXAMS,
    papers: PAPERS,
    marks: new Map(Object.entries(marks).map(([paperId, m]) => [`${paperId}|kid`, mark(m)])),
    attendance: null,
    scheme: SCHEME,
    grace: grace ? new Map(Object.entries(grace)) : undefined,
    generatedAt: "2026-10-20T10:00:00Z",
  });

describe("a report card's result is the Grace screen's per-paper rule", () => {
  it("is not Pass for a child with 0 of 80 in Half yearly Maths, however high the overall", () => {
    // Smoke: Dhruv-like — strong FA1 and English, 0/80 in SA1 Maths, card said "Pass".
    const c = card({ "m-fa1": { value: 15.5 }, "m-sa1": { value: 0 }, "e-fa1": { value: 20 }, "e-sa1": { value: 80 } });
    expect(c.totals.percent).toBeGreaterThan(33);
    expect(c.passed).toBe(false);
    expect(c.shortIn).toEqual(["MATHS"]);
  });

  it("is not Pass for a child absent from a paper, unless excused", () => {
    const absent = card({ "m-fa1": { value: 17.5 }, "m-sa1": { absent: true }, "e-fa1": { value: 18 }, "e-sa1": { value: 70 } });
    expect(absent.passed).toBe(false);
    expect(absent.absentIn).toEqual(["MATHS"]);

    const excused = card({ "m-fa1": { value: 17.5 }, "m-sa1": { exempt: true }, "e-fa1": { value: 18 }, "e-sa1": { value: 70 } });
    expect(excused.passed).toBe(true);
  });

  it("counts grace given on the paper, to a tenth", () => {
    const marks = { "m-fa1": { value: 10 }, "m-sa1": { value: 23.5 }, "e-fa1": { value: 12 }, "e-sa1": { value: 50 } };
    expect(card(marks).passed).toBe(false);
    expect(card(marks, { "m-sa1": 2 }).passed).toBe(false);
    expect(card(marks, { "m-sa1": 2.5 }).passed).toBe(true);
  });

  it("waits for a blank paper, but a failed paper decides it at once", () => {
    expect(card({ "m-fa1": { value: 15 }, "m-sa1": { value: 60 }, "e-fa1": { value: 15 } }).passed).toBeNull();
    expect(card({ "m-fa1": { value: 15 }, "m-sa1": { value: 3 }, "e-fa1": { value: 15 } }).passed).toBe(false);
  });

  it("still needs the overall pass percentage", () => {
    expect(cardResult({ percent: 30, passPercent: 33, papers: [{ subjectCode: "X", value: 9, absent: false, exempt: false, passMarks: 7 }] }).passed).toBe(false);
  });

  it("has no verdict when neither the scheme nor a paper names a pass mark", () => {
    expect(cardResult({ percent: 50, passPercent: null, papers: [{ subjectCode: "X", value: 1, absent: false, exempt: false, passMarks: null }] }).passed).toBeNull();
  });
});

describe("the card explains its weighting", () => {
  it("lists each exam's weight when they differ, and nothing when they are equal", () => {
    const c = card({ "m-fa1": { value: 10 }, "m-sa1": { value: 40 } });
    expect(cardWeights(c).map((w) => [w.code, w.weight])).toEqual([
      ["FA1", 1],
      ["SA1", 2],
    ]);
    expect(weightsLine(cardWeights(c).map((w) => ({ name: { en: w.en, hi: w.hi }, weight: w.weight })))).toContain("Half yearly ×2");
    expect(weightsLine([{ name: { en: "A" }, weight: 1 }, { name: { en: "B" }, weight: 1 }])).toBe("");
  });

  it("names the subjects in both languages when a child needs support", () => {
    expect(supportLine([subjectPair("MATHS")])).toBe("Needs support in Maths · गणित में सहायता चाहिए");
    expect(supportLine([])).toContain("Needs support");
  });
});

const facts = (over: Partial<PaperFacts>): PaperFacts => ({
  paperId: "p",
  classId: "c9",
  classLabel: "Class 9",
  classSort: 9,
  subjectCode: "SCIENCE",
  teacherId: "t1",
  teacherName: "Teacher",
  total: 14,
  entered: 14,
  invalid: 0,
  entryStatus: "submitted",
  entryRevision: 1,
  maxMarks: 80,
  passMarks: 26,
  ...over,
});

describe("never Done over blanks or invalid marks", () => {
  it("does not tick a sent paper with a mark to correct or a blank", () => {
    expect(isPaperComplete(facts({}))).toBe(true);
    expect(isPaperComplete(facts({ invalid: 2 }))).toBe(false);
    expect(isPaperComplete(facts({ entered: 12 }))).toBe(false);
    expect(paperStatus(facts({ invalid: 2 }))).toBe("in_progress");
    expect(cellState(facts({ invalid: 2 }), false)).toBe("in_progress");
    expect(cellState(facts({ entered: 13 }), false)).toBe("in_progress");
    expect(cellState(facts({}), false)).toBe("done");
    expect(cellState(facts({ invalid: 2 }), true)).toBe("locked");
  });

  it("counts only finished papers as done, and keeps chasing their teacher", () => {
    expect(overall([facts({}), facts({ invalid: 1 })]).done).toBe(1);
    expect(teacherLoads([facts({ invalid: 1 })], 1).map((t) => t.teacherId)).toEqual(["t1"]);
  });

  it("says which papers keep a class's cards from being ready", () => {
    const blockers = paperBlockers([
      facts({ paperId: "sci", subjectCode: "SCIENCE", invalid: 2 }),
      facts({ paperId: "eng", subjectCode: "ENGLISH", entryStatus: "open" }),
      facts({ paperId: "hin", subjectCode: "HINDI", entered: 11 }),
      facts({ paperId: "mat", subjectCode: "MATHS" }),
    ]);
    expect(blockers).toEqual([
      { paperId: "sci", subjectCode: "SCIENCE", reason: "needs_correction", count: 2 },
      { paperId: "eng", subjectCode: "ENGLISH", reason: "not_sent", count: 0 },
      { paperId: "hin", subjectCode: "HINDI", reason: "missing", count: 3 },
    ]);
  });

  it("spells out a paper's mix of marks, absences, exemptions and blanks", () => {
    expect(paperMix({ marks: 12, absent: 2, exempt: 0, blank: 0 })).toEqual({
      en: "12 marks · 2 absent · 0 excused · 0 blank",
      hi: "12 अंक · 2 अनुपस्थित · 0 को छूट · 0 खाली",
    });
  });
});

describe("a paper's history keeps every send and take-back", () => {
  const rows = [
    { kind: "submitted", text_en: "T sent Class 9 MATHS", text_hi: "T ने Class 9 MATHS के अंक भेजे", created_at: "2026-10-20T18:05:00Z" },
    { kind: "withdrawn", text_en: "T took back Class 9 MATHS to change it", text_hi: null, created_at: "2026-10-20T18:06:00Z" },
    { kind: "submitted", text_en: "T sent Class 9 MATHS", text_hi: null, created_at: "2026-10-20T18:06:30Z" },
    { kind: "submitted", text_en: "T sent Class 9 MATHS EXTRA", text_hi: null, created_at: "2026-10-20T18:07:00Z" },
    { kind: "submitted", text_en: "U sent Class 1 EVS", text_hi: null, created_at: "2026-10-20T18:08:00Z" },
    { kind: "locked", text_en: "X locked Class 9 MATHS", text_hi: null, created_at: "2026-10-20T18:09:00Z" },
  ];

  it("lists sent, took back, sent for the paper, newest first, and nothing for another", () => {
    expect(paperEvents(rows, "Class 9", "MATHS").map((e) => e.kind)).toEqual(["submitted", "withdrawn", "submitted"]);
    expect(paperEvents(rows, "Class 11", "EVS")).toEqual([]);
    expect(paperEvents(rows, "Class 1", "EVS")).toHaveLength(1);
  });
});

describe("subject names in Hindi", () => {
  it("has a Hindi name for Sports papers and remarks", () => {
    expect(subjectPair("Sports").hi).toBe("खेल");
  });
});
