import { describe, expect, it } from "vitest";

import type { Assessment, AssessmentSubject, Mark } from "@/modules/assessments/domain/assessments";
import { buildReportCard, type CardScheme } from "@/modules/assessments/domain/report-card";
import { daysBetween } from "@/modules/assessments/domain/report-period";
import {
  bandsToText,
  DEFAULT_GRADE_BANDS,
  gradeWith,
  parseBands,
  parseSignatories,
  roundHalfUp,
  schemePercent,
} from "@/modules/assessments/domain/report-scheme";

/**
 * P8: a card is worked out from a pinned scheme, rounded once at an agreed
 * boundary, graded on the rounded number, and shows absent, exempt and
 * missing as what they are. Every pupil here is synthetic.
 */

describe("roundHalfUp()", () => {
  it("rounds half up on the decimal value a calculator shows, not the binary one", () => {
    // Math.round(32.95 * 10) / 10 is 32.9, because 32.95 is stored as 32.9499….
    expect(roundHalfUp(32.95, 1)).toBe(33);
    expect(roundHalfUp(32.94, 1)).toBe(32.9);
    expect(roundHalfUp(64.445, 2)).toBe(64.45);
    expect(roundHalfUp(90.5, 0)).toBe(91);
    expect(roundHalfUp(90.49, 0)).toBe(90);
  });
});

describe("the boundary is rounded, then graded", () => {
  const bands = DEFAULT_GRADE_BANDS;

  it("puts a child at 32.95% in the band that starts at 33 when the scheme rounds to one place", () => {
    // 659 of 2000 is 32.95%: rounded to one place it is 33.0, which is D.
    const percent = schemePercent(659 / 2000, 1);
    expect(percent).toBe(33);
    expect(gradeWith(percent, bands)?.label).toBe("D");
  });

  it("keeps the same child below it when the scheme rounds to two places", () => {
    const percent = schemePercent(659 / 2000, 2);
    expect(percent).toBe(32.95);
    expect(gradeWith(percent, bands)?.label).toBe("E");
  });

  it("grades exactly at a floor as that band, and just below it as the next", () => {
    expect(gradeWith(91, bands)?.label).toBe("A1");
    expect(gradeWith(90.9, bands)?.label).toBe("A2");
    expect(gradeWith(0, bands)?.label).toBe("E");
    expect(gradeWith(null, bands)).toBeNull();
  });
});

describe("bands as text", () => {
  it("reads what it writes", () => {
    const parsed = parseBands(bandsToText(DEFAULT_GRADE_BANDS));
    expect(parsed.ok && parsed.bands).toEqual([...DEFAULT_GRADE_BANDS].sort((a, b) => b.from - a.from));
  });

  it("takes a school's own bands, and refuses a set with no floor at zero", () => {
    expect(parseBands("75 A Distinction | विशेष योग्यता\n60 B First | प्रथम\n0 C Pass | उत्तीर्ण").ok).toBe(true);
    expect(parseBands("75 A Distinction | विशेष योग्यता\n60 B First | प्रथम").ok).toBe(false);
  });

  it("refuses two bands that start at the same percentage, and a line it cannot read", () => {
    expect(parseBands("50 A x | y\n50 B x | y\n0 C x | y").ok).toBe(false);
    const bad = parseBands("A1 ninety | नब्बे\n0 E x | y");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.line).toBe(1);
  });

  it("reads signature lines, English and Hindi", () => {
    expect(parseSignatories("Class teacher | कक्षा अध्यापक\nPrincipal")).toEqual([
      { en: "Class teacher", hi: "कक्षा अध्यापक" },
      { en: "Principal", hi: "Principal" },
    ]);
  });
});

/* -------------------------------------------- a worked synthetic example */

const assessment = (id: string, code: string, weight = 1): Assessment => ({
  id,
  sessionLabel: "2026-27",
  term: "SA1",
  code,
  labelHi: code,
  labelEn: code,
  kind: "summative",
  startsOn: null,
  endsOn: null,
  weight,
  status: "open",
  lockedAt: null,
} as unknown as Assessment);

const paper = (id: string, assessmentId: string, subjectCode: string, maxMarks: number): AssessmentSubject => ({
  id,
  assessmentId,
  classId: "c",
  classLabel: "Class 6",
  subjectId: subjectCode,
  subjectCode,
  maxMarks,
  passMarks: null,
  sortOrder: 0,
  markStep: 0.5,
  allowExempt: true,
  entryStatus: "submitted",
  entryRevision: 1,
  submittedAt: null,
});

const mark = (over: Partial<Mark>): Mark => ({
  studentId: "kid",
  value: null,
  absent: false,
  exempt: false,
  enteredByName: null,
  enteredAt: null,
  ...over,
});

const scheme: CardScheme = {
  id: "s",
  revision: 1,
  percentDecimals: 1,
  passPercent: 33,
  bands: DEFAULT_GRADE_BANDS,
  headerEn: "Synthetic School",
  headerHi: "सिंथेटिक विद्यालय",
  signatories: [{ en: "Class teacher", hi: "कक्षा अध्यापक" }],
};

describe("buildReportCard() with a scheme — a worked example", () => {
  // Maths 37/40 and 18.5/20; English absent from the 40 paper, 15/20 in the
  // other; Sanskrit exempt. Totals: 70.5 of 120 (Sanskrit out of both
  // halves, the absence a nought out of 40) = 58.75% → 58.8 at one place → C1.
  const card = buildReportCard({
    sessionLabel: "2026-27",
    term: "SA1",
    student: { id: "kid", fullName: "Synthetic Child", admissionNo: null, rollNo: "1", classLabel: "Class 6", fatherName: null },
    assessments: [assessment("a1", "SA1"), assessment("a2", "FA2")],
    papers: [
      paper("m1", "a1", "Maths", 40),
      paper("m2", "a2", "Maths", 20),
      paper("e1", "a1", "English", 40),
      paper("e2", "a2", "English", 20),
      paper("s1", "a1", "Sanskrit", 40),
    ],
    marks: new Map([
      ["m1|kid", mark({ value: 37 })],
      ["m2|kid", mark({ value: 18.5 })],
      ["e1|kid", mark({ absent: true })],
      ["e2|kid", mark({ value: 15 })],
      ["s1|kid", mark({ exempt: true })],
    ]),
    attendance: { present: 17.5, counted: 20, percent: 87.5, from: "2026-07-01", to: "2026-09-30", notRecorded: 3 },
    scheme,
    generatedAt: "2026-10-04T00:00:00Z",
  });

  it("adds up by hand, with the exempt paper out of both halves and the absence a nought", () => {
    expect(card.totals).toMatchObject({ scored: 70.5, outOf: 120, absent: 1, exempt: 1, missing: 0 });
  });

  it("rounds once at the scheme's place and grades the rounded number", () => {
    expect(card.totals.percent).toBe(58.8);
    expect(card.grade).toBe("C1");
    expect(card.passed).toBe(true);
  });

  it("names absent and exempt on the subject rows rather than printing a number", () => {
    const english = card.rows.find((row) => row.subjectCode === "English")!;
    const sanskrit = card.rows.find((row) => row.subjectCode === "Sanskrit")!;
    expect(english.marks.find((entry) => entry.assessmentCode === "SA1")).toMatchObject({ absent: true, value: null });
    expect(sanskrit.marks[0]).toMatchObject({ exempt: true, value: null });
    expect(sanskrit).toMatchObject({ outOf: 0, percent: null, grade: null });
  });

  it("carries the scheme it was worked out by, and the attendance period with its unrecorded days", () => {
    expect(card.scheme?.revision).toBe(1);
    expect(card.attendance).toMatchObject({ percent: 87.5, notRecorded: 3, from: "2026-07-01" });
  });
});

describe("daysBetween()", () => {
  it("includes both ends, and is empty when the period ends first", () => {
    expect(daysBetween("2026-09-29", "2026-10-01")).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(daysBetween("2026-10-02", "2026-10-01")).toEqual([]);
  });
});
