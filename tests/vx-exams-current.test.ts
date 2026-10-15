import { describe, expect, it } from "vitest";

import { currentTerm, termsByDate, type Assessment, type AssessmentSubject, type Mark } from "@/modules/assessments/domain/assessments";
import { buildReportCard, isEmptyCard, markIn, reportColumns } from "@/modules/assessments/domain/report-card";
import { subjectName } from "@/vx/screens/academics/domain";
import { openExamsForMarks, pickCurrentExam, type ExamLike } from "@/vx/screens/exams/domain/current";
import { subjectPair } from "@/vx/screens/exams/domain/groups";
import { isLate } from "@/vx/screens/exams/domain/tracker";

/*
 * Regressions from the 14 Oct school-day run (coordinators report): the exam
 * every screen focuses, the term a report card opens on, the card's columns,
 * and an empty card that could be issued.
 */

const exam = (over: Partial<ExamLike> & { id: string }): ExamLike & { code: string } => ({
  startsOn: null,
  status: "open",
  papers: 10,
  plan: null,
  code: over.id,
  ...over,
});

describe("pickCurrentExam — B2", () => {
  const today = "2026-10-15";
  const halfYearly = exam({ id: "hy", startsOn: "2026-09-21", plan: { marksDueOn: "2026-10-15" } });
  const unitTest2 = exam({ id: "ut2", startsOn: "2026-11-09" });
  const unitTest1 = exam({ id: "ut1", startsOn: "2026-07-20", status: "locked" });
  const qa = exam({ id: "qa", startsOn: null, papers: 1 });

  it("never lets an undated test exam hijack the exam office", () => {
    // The order listExams returns: dated by date, undated last.
    expect(pickCurrentExam([unitTest1, halfYearly, unitTest2, qa], today)?.id).toBe("hy");
  });

  it("takes the open exam that began most recently", () => {
    const ut2Begun = { ...unitTest2, startsOn: "2026-10-12" };
    expect(pickCurrentExam([unitTest1, halfYearly, ut2Begun], today)?.id).toBe("ut2");
  });

  it("skips exams with no papers and drafts", () => {
    const empty = exam({ id: "empty", startsOn: "2026-10-10", papers: 0 });
    const draft = exam({ id: "draft", startsOn: "2026-10-11", status: "draft" });
    expect(pickCurrentExam([halfYearly, empty, draft], today)?.id).toBe("hy");
  });

  it("falls back to the latest begun exam, then the next one, then an undated one", () => {
    expect(pickCurrentExam([unitTest1, unitTest2, qa], today)?.id).toBe("ut1");
    expect(pickCurrentExam([unitTest2, qa], today)?.id).toBe("ut2");
    expect(pickCurrentExam([qa], today)?.id).toBe("qa");
    expect(pickCurrentExam([], today)).toBeNull();
  });

  it("honours an exam asked for by id", () => {
    expect(pickCurrentExam([halfYearly, qa], today, "qa")?.id).toBe("qa");
    expect(pickCurrentExam([halfYearly, qa], today, "nope")?.id).toBe("hy");
  });

  it("works on exams whose paper count is unknown (the coordinator's list)", () => {
    const noCount = { id: "x", startsOn: "2026-09-21", status: "open" };
    expect(pickCurrentExam([noCount], today)?.id).toBe("x");
  });
});

describe("openExamsForMarks — every open exam, overdue first", () => {
  it("lists overdue, then begun, then upcoming, then undated; drops locked and paperless", () => {
    const today = "2026-10-15";
    const list = openExamsForMarks(
      [
        exam({ id: "undated" }),
        exam({ id: "upcoming", startsOn: "2026-11-09" }),
        exam({ id: "begun", startsOn: "2026-10-12", plan: { marksDueOn: "2026-10-25" } }),
        exam({ id: "overdue", startsOn: "2026-09-21", plan: { marksDueOn: "2026-10-10" } }),
        exam({ id: "locked", startsOn: "2026-07-20", status: "locked" }),
        exam({ id: "paperless", startsOn: "2026-10-01", papers: 0 }),
      ],
      today,
    );
    expect(list.map((e) => e.id)).toEqual(["overdue", "begun", "upcoming", "undated"]);
  });
});

/* -------------------------------------------------------------- terms */

const assessment = (over: Partial<Assessment> & { id: string; term: string }): Assessment => ({
  sessionLabel: "2026-27",
  code: over.id,
  labelHi: over.id,
  labelEn: over.id,
  kind: "summative",
  startsOn: null,
  endsOn: null,
  weight: 1,
  status: "open",
  lockedAt: null,
  lockedByName: null,
  ...over,
});

describe("report card term — B3", () => {
  const all = [
    assessment({ id: "slug", term: "phoneops-20261011-marks-0fac57f2" }),
    assessment({ id: "qa", term: "QA-P8E-1" }),
    assessment({ id: "fa1", term: "Term 1", startsOn: "2026-07-20" }),
    assessment({ id: "sa1", term: "Term 1", startsOn: "2026-09-21" }),
    assessment({ id: "fa3", term: "Term 2", startsOn: "2026-12-07" }),
  ];

  it("opens on the term of the exam that began most recently, not the first label", () => {
    expect(currentTerm(all, "2026-10-15")).toBe("Term 1");
    expect(currentTerm(all, "2026-12-10")).toBe("Term 2");
  });

  it("before any exam has begun, opens on the first one to come", () => {
    expect(currentTerm(all, "2026-04-01")).toBe("Term 1");
  });

  it("orders the chips by date with undated test terms last", () => {
    expect(termsByDate(all)).toEqual(["Term 1", "Term 2", "phoneops-20261011-marks-0fac57f2", "QA-P8E-1"]);
  });

  it("ignores drafts when choosing", () => {
    const withDraft = [...all, assessment({ id: "d", term: "Draft term", startsOn: "2026-10-14", status: "draft" })];
    expect(currentTerm(withDraft, "2026-10-15")).toBe("Term 1");
  });
});

/* -------------------------------------------------------- the columns */

const paper = (over: Partial<AssessmentSubject> & { id: string; assessmentId: string; subjectCode: string }): AssessmentSubject => ({
  classId: "c3",
  classLabel: "Class 3",
  subjectId: over.subjectCode,
  maxMarks: 80,
  passMarks: null,
  sortOrder: 0,
  markStep: 1,
  allowExempt: false,
  entryStatus: "submitted",
  entryRevision: 1,
  submittedAt: null,
  ...over,
});

const mark = (over: Partial<Mark> = {}): Mark => ({ studentId: "st1", value: null, absent: false, exempt: false, enteredByName: null, enteredAt: null, ...over });

describe("report card columns — B5", () => {
  const assessments = [
    assessment({ id: "a-fa1", term: "Term 1", code: "FA1", startsOn: "2026-07-20" }),
    assessment({ id: "a-sa1", term: "Term 1", code: "SA1", startsOn: "2026-09-21" }),
  ];
  // ELGA sat only the half-yearly; it sorts first, so its row used to be the header.
  const papers = [
    paper({ id: "elga-sa1", assessmentId: "a-sa1", subjectCode: "ELGA", maxMarks: 50 }),
    paper({ id: "evs-fa1", assessmentId: "a-fa1", subjectCode: "EVS", maxMarks: 20 }),
    paper({ id: "evs-sa1", assessmentId: "a-sa1", subjectCode: "EVS", maxMarks: 80 }),
    paper({ id: "maths-fa1", assessmentId: "a-fa1", subjectCode: "MATHS", maxMarks: 20 }),
    paper({ id: "maths-sa1", assessmentId: "a-sa1", subjectCode: "MATHS", maxMarks: 80 }),
  ];
  const card = buildReportCard({
    sessionLabel: "2026-27",
    term: "Term 1",
    student: { id: "st1", fullName: "Test Child", admissionNo: "T-1", rollNo: "4", classLabel: "Class 3", fatherName: "Test Parent" },
    assessments,
    papers,
    marks: new Map([
      ["elga-sa1|st1", mark({ value: 41 })],
      ["evs-fa1|st1", mark({ value: 15 })],
      ["evs-sa1|st1", mark({ value: 57 })],
      ["maths-fa1|st1", mark({ absent: true })],
      ["maths-sa1|st1", mark({ value: 60 })],
    ]),
    attendance: null,
    generatedAt: "2026-10-15T10:00:00Z",
  });

  it("has a column for every exam any subject sat, in the order sat", () => {
    const columns = reportColumns(card.rows);
    expect(columns.map((c) => c.assessmentCode)).toEqual(["FA1", "SA1"]);
    expect(card.rows[0].subjectCode).toBe("ELGA");
  });

  it("puts each mark under its own exam, and nothing under an exam a subject did not sit", () => {
    const [elga, evs, maths] = card.rows;
    expect(markIn(elga, "FA1")).toBeNull();
    expect(markIn(elga, "SA1")?.value).toBe(41);
    expect(markIn(evs, "FA1")?.value).toBe(15);
    expect(markIn(evs, "SA1")?.value).toBe(57);
    // The FA1 absence stays under FA1, not under SA1.
    expect(markIn(maths, "FA1")?.absent).toBe(true);
    expect(markIn(maths, "SA1")?.value).toBe(60);
  });

  it("says a column's maximum only when every subject agrees", () => {
    const [fa1, sa1] = reportColumns(card.rows);
    expect(fa1.maxMarks).toBe(20);
    expect(sa1.maxMarks).toBeNull(); // ELGA is out of 50, the rest out of 80
  });

  it("merges rows that each lack a different exam", () => {
    const rows = [
      { marks: [{ assessmentCode: "SA1", maxMarks: 80 }] },
      { marks: [{ assessmentCode: "FA1", maxMarks: 20 }, { assessmentCode: "SA1", maxMarks: 80 }] },
      { marks: [{ assessmentCode: "FA1", maxMarks: 20 }, { assessmentCode: "FA2", maxMarks: 20 }] },
    ].map((row) => ({ marks: row.marks.map((m) => ({ ...m, assessmentLabelEn: "", assessmentLabelHi: "", value: 1, absent: false, exempt: false, weight: 1 })) }));
    expect(reportColumns(rows).map((c) => c.assessmentCode)).toEqual(["FA1", "FA2", "SA1"]);
  });
});

describe("an empty card is never issuable — B3", () => {
  it("is empty with no rows, or with rows and not one mark", () => {
    expect(isEmptyCard({ rows: [] })).toBe(true);
    const blank = { marks: [{ assessmentCode: "SA1", assessmentLabelEn: "", assessmentLabelHi: "", value: null, absent: false, exempt: false, maxMarks: 80, weight: 1 }] };
    expect(isEmptyCard({ rows: [blank] as never })).toBe(true);
  });

  it("is not empty once there is a mark, an absence or an exemption", () => {
    const one = (over: object) => ({ rows: [{ marks: [{ assessmentCode: "SA1", assessmentLabelEn: "", assessmentLabelHi: "", value: null, absent: false, exempt: false, maxMarks: 80, weight: 1, ...over }] }] as never });
    expect(isEmptyCard(one({ value: 0 }))).toBe(false);
    expect(isEmptyCard(one({ absent: true }))).toBe(false);
    expect(isEmptyCard(one({ exempt: true }))).toBe(false);
  });
});

/* -------------------------------------------------------- small ones */

describe("subject names a person reads — U6", () => {
  it("title-cases a code kept in capitals and leaves acronyms", () => {
    expect(subjectName("MATHS")).toBe("Maths");
    expect(subjectName("HINDI")).toBe("Hindi");
    expect(subjectName("EVS")).toBe("EVS");
    expect(subjectName("GK")).toBe("GK");
    expect(subjectName("Science")).toBe("Science");
    expect(subjectPair("MATHS")).toEqual({ en: "Maths", hi: "गणित" });
  });
});

describe("a paper with nobody assigned is still late — B7", () => {
  it("is late past the due date whatever its teacher", () => {
    expect(isLate({ total: 18, entered: 0, entryStatus: "open" }, 1)).toBe(true);
  });
});
