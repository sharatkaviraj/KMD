import { describe, expect, it } from "vitest";

import {
  assessmentSchema,
  canEnterMarks,
  checkMark,
  GRADE_BANDS,
  gradeFor,
  isEntered,
  markChanged,
  NOT_ENTERED,
  outstandingPapers,
  paperProgress,
  paperSchema,
  passed,
  totalsFor,
  type AssessmentSubject,
  type Mark,
} from "@/modules/assessments/domain/assessments";
import {
  buildReportCard,
  exportFileName,
  marksCsv,
  readiness,
  toCsv,
} from "@/modules/assessments/domain/report-card";

const paper = (over: Partial<AssessmentSubject> = {}): AssessmentSubject => ({
  id: "p1",
  assessmentId: "a1",
  classId: "c1",
  classLabel: "Class 6",
  subjectId: "s1",
  subjectCode: "Maths",
  maxMarks: 100,
  passMarks: null,
  sortOrder: 0,
  ...over,
});

const mark = (over: Partial<Mark> = {}): Mark => ({
  studentId: "st1",
  value: 60,
  absent: false,
  enteredByName: null,
  enteredAt: null,
  ...over,
});

/* ------------------------------------------------------ the three states */

describe("a cell has three states, not two", () => {
  /**
   * A blank is nobody having entered it; an absence is a child who did not sit
   * the paper; a zero is a real mark somebody gave. Collapsing any two of them
   * makes "who has not entered yet" unanswerable, which is the question the
   * board exists for.
   */
  it("counts a zero as entered", () => {
    expect(isEntered(mark({ value: 0 }))).toBe(true);
  });

  it("counts an absence as entered", () => {
    expect(isEntered(mark({ value: null, absent: true }))).toBe(true);
  });

  it("does not count a blank as entered", () => {
    expect(isEntered(mark({ value: null }))).toBe(false);
    expect(isEntered(undefined)).toBe(false);
  });
});

/**
 * D-80: an unchanged save writes nothing.
 *
 * These exist because it did not. A teacher who opened a column, filled in one
 * child and saved wrote a change-log entry for every child she had not reached
 * — each reading "not entered → not entered" — and left an empty `marks` row
 * behind for each. Nothing caught it until somebody signed in and looked.
 */
describe("markChanged()", () => {
  it("says a cell nobody has reached is unchanged when it is saved blank", () => {
    // The case that shipped wrong: no row yet, and the column is submitted
    // with that cell exactly as it was found.
    expect(markChanged(NOT_ENTERED, { value: null, absent: false })).toBe(false);
  });

  it("says nothing changed when the same number is saved again", () => {
    expect(markChanged({ value: 18, absent: false }, { value: 18, absent: false })).toBe(
      false,
    );
  });

  it("says nothing changed when an absence is saved again", () => {
    expect(
      markChanged({ value: null, absent: true }, { value: null, absent: true }),
    ).toBe(false);
  });

  it("sees a first mark, a corrected mark and a withdrawn one", () => {
    expect(markChanged(NOT_ENTERED, { value: 18, absent: false })).toBe(true);
    expect(markChanged({ value: 18, absent: false }, { value: 14, absent: false })).toBe(
      true,
    );
    expect(markChanged({ value: 18, absent: false }, NOT_ENTERED)).toBe(true);
  });

  it("tells a nought from a blank, in both directions", () => {
    // The whole point of three states: somebody giving a child nought is a
    // change, and undoing it is a change.
    expect(markChanged(NOT_ENTERED, { value: 0, absent: false })).toBe(true);
    expect(markChanged({ value: 0, absent: false }, NOT_ENTERED)).toBe(true);
  });

  it("tells an absence from a blank, in both directions", () => {
    expect(markChanged(NOT_ENTERED, { value: null, absent: true })).toBe(true);
    expect(markChanged({ value: null, absent: true }, NOT_ENTERED)).toBe(true);
  });
});

describe("checkMark()", () => {
  it("accepts a blank, which means not entered", () => {
    expect(checkMark("", paper())).toEqual({ ok: true, value: null });
    expect(checkMark(null, paper())).toEqual({ ok: true, value: null });
    expect(checkMark("   ", paper())).toEqual({ ok: true, value: null });
  });

  it("accepts a zero, which is a mark somebody gave", () => {
    expect(checkMark("0", paper())).toEqual({ ok: true, value: 0 });
  });

  it("refuses more than the paper is out of", () => {
    // Thirty out of twenty-five is one key, looks plausible on a report card,
    // and by the time anybody notices it is inside a term total.
    const result = checkMark("30", paper({ maxMarks: 25 }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.en).toContain("25");
    expect(!result.ok && result.error.hi).toBeTruthy();
  });

  it("accepts exactly the maximum", () => {
    expect(checkMark("25", paper({ maxMarks: 25 }))).toEqual({ ok: true, value: 25 });
  });

  it("refuses a negative", () => {
    expect(checkMark("-1", paper()).ok).toBe(false);
  });

  it("refuses text", () => {
    expect(checkMark("good", paper()).ok).toBe(false);
  });

  it("accepts a half mark and refuses a quarter", () => {
    // Half marks are ordinary in this school; 17.25 is a typo.
    expect(checkMark("17.5", paper())).toEqual({ ok: true, value: 17.5 });
    expect(checkMark("17.25", paper()).ok).toBe(false);
  });

  it("speaks both languages on every refusal", () => {
    for (const raw of ["-1", "999", "good", "1.25"]) {
      const result = checkMark(raw, paper({ maxMarks: 50 }));
      expect(result.ok, raw).toBe(false);
      if (result.ok) continue;
      expect(result.error.hi, raw).toBeTruthy();
      expect(result.error.en, raw).toBeTruthy();
      expect(result.error.hi).not.toBe(result.error.en);
    }
  });
});

describe("canEnterMarks()", () => {
  it("allows an open exam", () => {
    expect(canEnterMarks({ status: "open" }).allowed).toBe(true);
  });

  it("refuses a draft and says it has not started", () => {
    const verdict = canEnterMarks({ status: "draft" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toContain("not been opened");
  });

  it("refuses a locked exam and says what to do about it", () => {
    const verdict = canEnterMarks({ status: "locked" });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason?.en).toContain("unlock");
  });
});

/* ---------------------------------------------------------------- totals */

describe("totalsFor()", () => {
  /**
   * The rule a family's percentage depends on: a paper nobody has marked is
   * left out of both halves rather than counted as zero. Treating it as nought
   * hands them a percentage the child did not earn, and the error looks exactly
   * like a bad result.
   */
  it("leaves an unmarked paper out of both halves", () => {
    const totals = totalsFor([
      { paper: paper({ maxMarks: 100 }), mark: mark({ value: 80 }) },
      { paper: paper({ id: "p2", maxMarks: 100 }), mark: undefined },
    ]);

    expect(totals.scored).toBe(80);
    expect(totals.outOf).toBe(100);
    expect(totals.percent).toBe(80);
    expect(totals.missing).toBe(1);
  });

  it("counts an absence as a nought it is out of", () => {
    // The child sat the term and did not sit the paper. That is a real nought
    // on a real report, which is not the same as a teacher being behind.
    const totals = totalsFor([
      { paper: paper({ maxMarks: 100 }), mark: mark({ value: 80 }) },
      {
        paper: paper({ id: "p2", maxMarks: 100 }),
        mark: mark({ value: null, absent: true }),
      },
    ]);

    expect(totals.scored).toBe(80);
    expect(totals.outOf).toBe(200);
    expect(totals.percent).toBe(40);
    expect(totals.absent).toBe(1);
    expect(totals.missing).toBe(0);
  });

  it("counts a zero, which is not the same as a blank", () => {
    const totals = totalsFor([
      { paper: paper({ maxMarks: 50 }), mark: mark({ value: 0 }) },
    ]);

    expect(totals.counted).toBe(1);
    expect(totals.outOf).toBe(50);
    expect(totals.percent).toBe(0);
  });

  it("says nothing rather than zero when there is nothing to divide by", () => {
    expect(totalsFor([]).percent).toBeNull();
    expect(
      totalsFor([{ paper: paper(), mark: undefined }]).percent,
    ).toBeNull();
  });

  it("rounds to one decimal place", () => {
    const totals = totalsFor([
      { paper: paper({ maxMarks: 3 }), mark: mark({ value: 2 }) },
    ]);
    expect(totals.percent).toBe(66.7);
  });

  /* ------------------------------------------------------------ weight */
  //
  // `assessments.weight` is the one number a school sets that changes what a
  // report card says. These fix what it may and may not touch.

  it("leaves the printed totals alone and says it did not weight them", () => {
    // Every exam counting the same is the default and the normal case: the
    // percentage must then be exactly the two numbers beside it divided, or a
    // parent with a pen catches the app out.
    const totals = totalsFor([
      { paper: paper({ maxMarks: 20 }), mark: mark({ value: 10 }), weight: 1 },
      {
        paper: paper({ id: "p2", maxMarks: 80 }),
        mark: mark({ value: 40 }),
        weight: 1,
      },
    ]);

    expect(totals.scored).toBe(50);
    expect(totals.outOf).toBe(100);
    expect(totals.percent).toBe(50);
    expect(totals.weighted).toBe(false);
  });

  it("applies weight to the percentage and never to a printed mark", () => {
    // 18/20 at weight 1 and 40/80 at weight 2: the plain total is still
    // 58 out of 100, because that is what the teachers wrote. The percentage
    // is (18 + 80) / (20 + 160) = 54.4%, not 58%.
    const totals = totalsFor([
      { paper: paper({ maxMarks: 20 }), mark: mark({ value: 18 }), weight: 1 },
      {
        paper: paper({ id: "p2", maxMarks: 80 }),
        mark: mark({ value: 40 }),
        weight: 2,
      },
    ]);

    expect(totals.scored).toBe(58);
    expect(totals.outOf).toBe(100);
    expect(totals.percent).toBe(54.4);
    expect(totals.weighted).toBe(true);
  });

  it("treats a missing weight as counting once", () => {
    const withOut = totalsFor([
      { paper: paper({ maxMarks: 50 }), mark: mark({ value: 25 }) },
    ]);
    const withOne = totalsFor([
      { paper: paper({ maxMarks: 50 }), mark: mark({ value: 25 }), weight: 1 },
    ]);

    expect(withOut).toEqual(withOne);
    expect(withOut.weighted).toBe(false);
  });

  it("weights an absence too, so a heavy paper missed costs more", () => {
    const light = totalsFor([
      { paper: paper({ maxMarks: 50 }), mark: mark({ value: 50 }), weight: 2 },
      {
        paper: paper({ id: "p2", maxMarks: 50 }),
        mark: mark({ value: null, absent: true }),
        weight: 1,
      },
    ]);

    const heavy = totalsFor([
      { paper: paper({ maxMarks: 50 }), mark: mark({ value: 50 }), weight: 1 },
      {
        paper: paper({ id: "p2", maxMarks: 50 }),
        mark: mark({ value: null, absent: true }),
        weight: 2,
      },
    ]);

    // Same marks on paper, different terms: missing the paper that counts
    // double must hurt more than missing the one that does not.
    expect(light.scored).toBe(heavy.scored);
    expect(light.outOf).toBe(heavy.outOf);
    expect(light.percent).toBe(66.7);
    expect(heavy.percent).toBe(33.3);
  });

  it("does not weight a paper nobody has marked into existence", () => {
    // A blank is out of both halves whatever it is worth — a heavy unmarked
    // paper must not start dragging a percentage down before anybody has
    // marked it.
    const totals = totalsFor([
      { paper: paper({ maxMarks: 50 }), mark: mark({ value: 40 }), weight: 1 },
      { paper: paper({ id: "p2", maxMarks: 50 }), mark: undefined, weight: 9 },
    ]);

    expect(totals.outOf).toBe(50);
    expect(totals.percent).toBe(80);
    // Only one weight ever reached the sums, so there is nothing to explain.
    expect(totals.weighted).toBe(false);
  });
});

describe("grades", () => {
  it("falls into the band it belongs in", () => {
    expect(gradeFor(95)?.label).toBe("A1");
    expect(gradeFor(91)?.label).toBe("A1");
    expect(gradeFor(90)?.label).toBe("A2");
    expect(gradeFor(0)?.label).toBe("E");
  });

  it("says nothing for no marks", () => {
    expect(gradeFor(null)).toBeNull();
  });

  it("has no gap and no overlap between bands", () => {
    // A percentage that fell between two bands would render as no grade at all
    // on a document a family keeps.
    for (let percent = 0; percent <= 100; percent += 0.5) {
      expect(gradeFor(percent), String(percent)).not.toBeNull();
    }

    const sorted = [...GRADE_BANDS].sort((a, b) => b.from - a.from);
    expect(sorted.map((band) => band.label)).toEqual(
      GRADE_BANDS.map((band) => band.label),
    );
  });

  it("carries both languages on every band", () => {
    for (const band of GRADE_BANDS) {
      expect(band.description.hi, band.label).toBeTruthy();
      expect(band.description.en, band.label).toBeTruthy();
    }
  });
});

describe("passed()", () => {
  it("says nothing when the school set no pass mark", () => {
    expect(passed(mark({ value: 10 }), paper({ passMarks: null }))).toBeNull();
  });

  it("is false for an absence", () => {
    expect(
      passed(mark({ value: null, absent: true }), paper({ passMarks: 33 })),
    ).toBe(false);
  });

  it("says nothing for an unmarked paper", () => {
    // Not failed. Nobody has looked at it.
    expect(passed(mark({ value: null }), paper({ passMarks: 33 }))).toBeNull();
    expect(passed(undefined, paper({ passMarks: 33 }))).toBe(false);
  });

  it("compares against the pass mark inclusively", () => {
    expect(passed(mark({ value: 33 }), paper({ passMarks: 33 }))).toBe(true);
    expect(passed(mark({ value: 32.5 }), paper({ passMarks: 33 }))).toBe(false);
  });
});

/* -------------------------------------------------------------- progress */

describe("paperProgress()", () => {
  const studentIds = ["a", "b", "c"];

  it("counts a zero and an absence as entered", () => {
    const marks = new Map([
      ["a", mark({ studentId: "a", value: 0 })],
      ["b", mark({ studentId: "b", value: null, absent: true })],
    ]);

    const progress = paperProgress(paper(), 3, marks, studentIds);
    expect(progress.entered).toBe(2);
    expect(progress.percent).toBe(67);
    expect(progress.done).toBe(false);
  });

  it("is done only when every child has something", () => {
    const marks = new Map(
      studentIds.map((id) => [id, mark({ studentId: id, value: 50 })]),
    );
    expect(paperProgress(paper(), 3, marks, studentIds).done).toBe(true);
  });

  it("is not done for an empty class", () => {
    expect(paperProgress(paper(), 0, new Map(), []).done).toBe(false);
  });

  it("keeps finished papers on the list, and only drops them from outstanding", () => {
    // A board that dropped finished work would show a teacher who has entered
    // everything as absent, which reads identically to a teacher nobody asked.
    const done = paperProgress(
      paper({ id: "done" }),
      1,
      new Map([["a", mark({ studentId: "a" })]]),
      ["a"],
    );
    const notDone = paperProgress(paper({ id: "open" }), 1, new Map(), ["a"]);

    expect(outstandingPapers([done, notDone]).map((entry) => entry.paper.id)).toEqual([
      "open",
    ]);
  });
});

/* ----------------------------------------------------------- report card */

const ASSESSMENTS = [
  {
    id: "a1",
    sessionLabel: "2026-27",
    term: "Term 1",
    code: "FA1",
    labelHi: "प्रथम",
    labelEn: "First",
    kind: "formative" as const,
    startsOn: null,
    endsOn: null,
    weight: 1,
    status: "open" as const,
    lockedAt: null,
    lockedByName: null,
  },
  {
    id: "a2",
    sessionLabel: "2026-27",
    term: "Term 1",
    code: "SA1",
    labelHi: "सत्रांत",
    labelEn: "Half yearly",
    kind: "summative" as const,
    startsOn: null,
    endsOn: null,
    weight: 2,
    status: "open" as const,
    lockedAt: null,
    lockedByName: null,
  },
];

const STUDENT = {
  id: "st1",
  fullName: "Test Child",
  admissionNo: "A-1",
  rollNo: "7",
  classLabel: "Class 6",
  fatherName: "Test Parent",
};

describe("buildReportCard()", () => {
  const papers = [
    paper({ id: "m-fa1", assessmentId: "a1", subjectCode: "Maths", maxMarks: 20 }),
    paper({ id: "m-sa1", assessmentId: "a2", subjectCode: "Maths", maxMarks: 80 }),
    paper({ id: "e-sa1", assessmentId: "a2", subjectCode: "English", maxMarks: 80 }),
  ];

  const card = buildReportCard({
    sessionLabel: "2026-27",
    term: "Term 1",
    student: STUDENT,
    assessments: ASSESSMENTS,
    papers,
    marks: new Map([
      ["m-fa1|st1", mark({ value: 18 })],
      ["m-sa1|st1", mark({ value: 64 })],
      ["e-sa1|st1", mark({ value: 40 })],
    ]),
    attendance: { present: 180, counted: 200, percent: 90 },
    generatedAt: "2026-09-17T10:00:00Z",
  });

  it("puts one row per subject, with a column per exam", () => {
    expect(card.rows.map((row) => row.subjectCode)).toEqual(["English", "Maths"]);
    expect(card.rows.find((row) => row.subjectCode === "Maths")!.marks).toHaveLength(2);
  });

  it("totals each subject over its own papers", () => {
    const maths = card.rows.find((row) => row.subjectCode === "Maths")!;
    // The printed pair is the plain sum of what the teachers wrote: 18 + 64
    // out of 20 + 80. The percentage is weighted, because the half-yearly
    // counts double — (18 + 128) / (20 + 160).
    expect(maths.scored).toBe(82);
    expect(maths.outOf).toBe(100);
    expect(maths.percent).toBe(81.1);
    expect(maths.grade).toBe("A2");
  });

  it("totals the card over every paper", () => {
    expect(card.totals.scored).toBe(122);
    expect(card.totals.outOf).toBe(180);
    // (18×1 + 64×2 + 40×2) / (20×1 + 80×2 + 80×2) = 226 / 340.
    expect(card.totals.percent).toBe(66.5);
    expect(card.totals.weighted).toBe(true);
    expect(card.grade).toBe("B2");
  });

  it("does not weight anything when the exams count the same", () => {
    // The default, and the case a school that never touches a weight is in:
    // the percentage is then exactly the printed pair divided, and nothing on
    // the card has to explain itself.
    const plain = buildReportCard({
      sessionLabel: "2026-27",
      term: "Term 1",
      student: STUDENT,
      assessments: ASSESSMENTS.map((entry) => ({ ...entry, weight: 1 })),
      papers,
      marks: new Map([
        ["m-fa1|st1", mark({ value: 18 })],
        ["m-sa1|st1", mark({ value: 64 })],
        ["e-sa1|st1", mark({ value: 40 })],
      ]),
      attendance: null,
      generatedAt: "2026-09-17T10:00:00Z",
    });

    expect(plain.totals.weighted).toBe(false);
    expect(plain.totals.percent).toBe(67.8);
    expect(plain.totals.percent).toBe(
      Math.round((plain.totals.scored / plain.totals.outOf) * 1000) / 10,
    );
  });

  it("carries the attendance it was given", () => {
    expect(card.attendance).toEqual({ present: 180, counted: 200, percent: 90 });
  });

  it("keeps the mark a teacher wrote, not a weighted one", () => {
    // A family reading "18 out of 20" should see the number on the paper. The
    // weight decides how much that paper counts, not what it says.
    const maths = card.rows.find((row) => row.subjectCode === "Maths")!;
    expect(maths.marks[0].value).toBe(18);
    expect(maths.marks[0].maxMarks).toBe(20);
    expect(maths.marks[0].weight).toBe(1);
    expect(maths.marks[1].weight).toBe(2);
  });

  it("copes with a child who has no marks at all", () => {
    const empty = buildReportCard({
      sessionLabel: "2026-27",
      term: "Term 1",
      student: STUDENT,
      assessments: ASSESSMENTS,
      papers,
      marks: new Map(),
      attendance: null,
      generatedAt: "2026-09-17T10:00:00Z",
    });

    expect(empty.totals.percent).toBeNull();
    expect(empty.grade).toBeNull();
    expect(empty.totals.missing).toBe(3);
  });
});

describe("readiness()", () => {
  const papers = [
    paper({ id: "p1", assessmentId: "a1", subjectCode: "Maths", maxMarks: 20 }),
    paper({ id: "p2", assessmentId: "a1", subjectCode: "English", maxMarks: 20 }),
  ];

  const cardWith = (marks: Map<string, Mark>) =>
    buildReportCard({
      sessionLabel: "2026-27",
      term: "Term 1",
      student: STUDENT,
      assessments: ASSESSMENTS,
      papers,
      marks,
      attendance: null,
      generatedAt: "2026-09-17T10:00:00Z",
    });

  it("is ready when every paper has a mark", () => {
    const ready = readiness(
      cardWith(
        new Map([
          ["p1|st1", mark({ value: 10 })],
          ["p2|st1", mark({ value: 12 })],
        ]),
      ),
    );

    expect(ready.ready).toBe(true);
    expect(ready.missing).toBe(0);
  });

  it("names the subjects still unmarked", () => {
    // A card handed to a family with three blank subjects is a phone call the
    // school does not need.
    const ready = readiness(cardWith(new Map([["p1|st1", mark({ value: 10 })]])));

    expect(ready.ready).toBe(false);
    expect(ready.missing).toBe(1);
    expect(ready.subjects).toEqual(["English"]);
    expect(ready.note.hi).toBeTruthy();
  });

  it("counts an absence as marked", () => {
    const ready = readiness(
      cardWith(
        new Map([
          ["p1|st1", mark({ value: 10 })],
          ["p2|st1", mark({ value: null, absent: true })],
        ]),
      ),
    );

    expect(ready.ready).toBe(true);
  });
});

/* ---------------------------------------------------------------- export */

describe("toCsv()", () => {
  it("quotes a value containing a comma", () => {
    // A child's name can contain one, and an unquoted export opens with the
    // columns shifted — worse than one that fails, because somebody acts on it.
    expect(toCsv([["a,b", "c"]])).toContain('"a,b",c');
  });

  it("doubles a quote inside a value", () => {
    expect(toCsv([['he said "no"']])).toContain('"he said ""no"""');
  });

  it("quotes a value containing a newline", () => {
    expect(toCsv([["line1\nline2"]])).toContain('"line1\nline2"');
  });

  it("starts with a BOM, so Excel reads Devanagari", () => {
    expect(toCsv([["नाम"]]).startsWith("﻿")).toBe(true);
  });

  it("uses CRLF between rows", () => {
    expect(toCsv([["a"], ["b"]])).toBe("﻿a\r\nb");
  });

  it("writes a null as an empty cell", () => {
    expect(toCsv([[null, 1]])).toBe("﻿,1");
  });
});

describe("marksCsv()", () => {
  it("tells an absence apart from a blank", () => {
    // One is a fact about the child and the other is a fact about the school.
    const csv = marksCsv([
      {
        rollNo: "1",
        studentName: "A",
        classLabel: "Class 6",
        subjectCode: "Maths",
        assessmentCode: "SA1",
        value: null,
        absent: true,
        maxMarks: 80,
      },
      {
        rollNo: "2",
        studentName: "B",
        classLabel: "Class 6",
        subjectCode: "Maths",
        assessmentCode: "SA1",
        value: null,
        absent: false,
        maxMarks: 80,
      },
    ]);

    expect(csv).toContain("Absent");
    expect(csv).toContain("Not entered");
  });

  it("marks an entered zero as entered", () => {
    const csv = marksCsv([
      {
        rollNo: "1",
        studentName: "A",
        classLabel: "Class 6",
        subjectCode: "Maths",
        assessmentCode: "SA1",
        value: 0,
        absent: false,
        maxMarks: 80,
      },
    ]);

    expect(csv).toContain("Entered");
  });
});

describe("exportFileName()", () => {
  it("is something findable in a downloads folder six months on", () => {
    expect(exportFileName("marks", "Term 1 SA1", "2026-09-17")).toBe(
      "vppsone-marks-Term-1-SA1-2026-09-17.csv",
    );
  });

  it("copes with a scope that has nothing usable in it", () => {
    expect(exportFileName("marks", "///", "2026-09-17")).toBe(
      "vppsone-marks-all-2026-09-17.csv",
    );
  });
});

/* ------------------------------------------------------------ validation */

describe("assessmentSchema", () => {
  const valid = {
    term: "Term 1",
    code: "SA1",
    labelHi: "सत्रांत परीक्षा",
    labelEn: "Half yearly",
    kind: "summative",
    startsOn: "2026-09-01",
    endsOn: "2026-09-10",
    weight: "2",
  };

  it("accepts a whole exam", () => {
    expect(assessmentSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a code with punctuation a URL would have to escape", () => {
    expect(assessmentSchema.safeParse({ ...valid, code: "SA/1" }).success).toBe(false);
  });

  it("refuses a weight outside the band", () => {
    expect(assessmentSchema.safeParse({ ...valid, weight: "99" }).success).toBe(false);
  });

  it("accepts no dates at all", () => {
    const parsed = assessmentSchema.safeParse({
      ...valid,
      startsOn: "",
      endsOn: "",
    });
    expect(parsed.success && parsed.data.startsOn).toBeNull();
  });
});

describe("paperSchema", () => {
  const valid = {
    assessmentId: "0192e5b2-0000-7000-8000-000000000001",
    classId: "0192e5b2-0000-7000-8000-000000000002",
    subjectId: "0192e5b2-0000-7000-8000-000000000003",
    maxMarks: "80",
    passMarks: "27",
    sortOrder: "0",
  };

  it("accepts a paper", () => {
    expect(paperSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses a paper out of nothing", () => {
    expect(paperSchema.safeParse({ ...valid, maxMarks: "0" }).success).toBe(false);
  });

  it("accepts no pass mark", () => {
    expect(paperSchema.safeParse({ ...valid, passMarks: null }).success).toBe(true);
  });
});
