import { describe, expect, it } from "vitest";

import type { Assessment, AssessmentSubject, Mark } from "@/modules/assessments/domain/assessments";
import { absentExams, buildReportCard, partialSubjects } from "@/modules/assessments/domain/report-card";
import { absentLine, cardNotes } from "@/vx/screens/exams/domain/card-notes";

/*
 * Verification 21 Oct: a child absent in FA1 read "15.5/100" with nothing to
 * say the 20 marks of FA1 were an absence counted as 0 (D-319), and ELGA read
 * "out of 80" beside subjects out of 100. ELGA is set only in SA1 on dev (5
 * classes, SA1 out of 80, no FA1 paper), so 80 is its real total: the card
 * now says so rather than leaving it to look like a slip in the sums.
 */

const assessment = (over: Partial<Assessment> & { id: string; code: string }): Assessment => ({
  sessionLabel: "2026-27",
  term: "Term 1",
  labelHi: over.code,
  labelEn: over.code,
  kind: "summative",
  startsOn: null,
  endsOn: null,
  weight: 1,
  status: "open",
  lockedAt: null,
  lockedByName: null,
  ...over,
});

const paper = (over: Partial<AssessmentSubject> & { id: string; assessmentId: string; subjectCode: string }): AssessmentSubject => ({
  classId: "c4",
  classLabel: "Class 4",
  subjectId: over.subjectCode,
  maxMarks: 80,
  passMarks: null,
  sortOrder: 0,
  markStep: 0.5,
  allowExempt: false,
  entryStatus: "submitted",
  entryRevision: 1,
  submittedAt: null,
  ...over,
});

const mark = (over: Partial<Mark> = {}): Mark => ({ studentId: "st1", value: null, absent: false, exempt: false, enteredByName: null, enteredAt: null, ...over });

const card = buildReportCard({
  sessionLabel: "2026-27",
  term: "Term 1",
  student: { id: "st1", fullName: "Test Child", admissionNo: "T-1", rollNo: "4", classLabel: "Class 4", fatherName: "Test Parent" },
  assessments: [
    assessment({ id: "a-fa1", code: "FA1", labelEn: "Formative 1", labelHi: "रचनात्मक 1", startsOn: "2026-07-20" }),
    assessment({ id: "a-sa1", code: "SA1", labelEn: "Half yearly", labelHi: "अर्धवार्षिक", startsOn: "2026-09-21" }),
  ],
  papers: [
    paper({ id: "elga-sa1", assessmentId: "a-sa1", subjectCode: "ELGA", maxMarks: 80 }),
    paper({ id: "maths-fa1", assessmentId: "a-fa1", subjectCode: "MATHS", maxMarks: 20 }),
    paper({ id: "maths-sa1", assessmentId: "a-sa1", subjectCode: "MATHS", maxMarks: 80 }),
    paper({ id: "hindi-fa1", assessmentId: "a-fa1", subjectCode: "HINDI", maxMarks: 20 }),
    paper({ id: "hindi-sa1", assessmentId: "a-sa1", subjectCode: "HINDI", maxMarks: 80 }),
  ],
  marks: new Map([
    ["elga-sa1|st1", mark({ value: 52 })],
    ["maths-fa1|st1", mark({ absent: true })],
    ["maths-sa1|st1", mark({ value: 15.5 })],
    ["hindi-fa1|st1", mark({ value: 14 })],
    ["hindi-sa1|st1", mark({ value: 60 })],
  ]),
  attendance: null,
  generatedAt: "2026-10-21T10:00:00Z",
});
const row = (code: string) => card.rows.find((r) => r.subjectCode === code)!;

describe("an absent paper on the report card", () => {
  it("counts as 0 out of its paper (D-319), which is why the subject reads 15.5/100", () => {
    expect(row("MATHS").scored).toBe(15.5);
    expect(row("MATHS").outOf).toBe(100);
  });

  it("is named, so the card says why", () => {
    expect(absentExams(row("MATHS"))).toEqual([{ code: "FA1", en: "Formative 1", hi: "रचनात्मक 1" }]);
    expect(absentExams(row("HINDI"))).toEqual([]);
    expect(absentLine(absentExams(row("MATHS")))).toBe("Absent in Formative 1 (counted as 0) · रचनात्मक 1 में अनुपस्थित (0 गिना गया)");
    expect(absentLine([])).toBe("");
  });

  it("is not an absence when the child was excused", () => {
    const excused = { marks: [{ ...row("MATHS").marks[0], exempt: true }] };
    expect(absentExams(excused)).toEqual([]);
  });
});

describe("a subject set in fewer exams (ELGA out of 80)", () => {
  it("is out of its own papers, not a slip in the totals", () => {
    expect(row("ELGA").outOf).toBe(80);
    expect(row("HINDI").outOf).toBe(100);
    expect(partialSubjects(card.rows)).toEqual([{ subjectCode: "ELGA", outOf: 80, sat: [{ code: "SA1", en: "Half yearly", hi: "अर्धवार्षिक" }] }]);
  });

  it("is never flagged on a card with one exam", () => {
    expect(partialSubjects([row("ELGA")])).toEqual([]);
  });
});

describe("the notes under the card's table", () => {
  it("say what * means and why ELGA is out of 80, in both languages", () => {
    expect(cardNotes(card.rows)).toEqual([
      { en: "* Absent from a paper: it counts as 0 out of that paper's marks.", hi: "पेपर में अनुपस्थित: उस पेपर के अंक 0 गिने गए।" },
      { en: "Elga is examined in Half yearly only, so it is out of 80.", hi: "अंग्रेज़ी भाषा की परीक्षा केवल अर्धवार्षिक में है, इसलिए पूर्णांक 80 है।" },
    ]);
  });

  it("are empty on a card with nothing to explain", () => {
    expect(cardNotes([row("HINDI")])).toEqual([]);
  });
});
