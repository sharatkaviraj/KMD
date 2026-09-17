import {
  gradeFor,
  totalsFor,
  type Assessment,
  type AssessmentSubject,
  type Mark,
  type Totals,
} from "@/modules/assessments/domain/assessments";
import { t, type Localized } from "@/platform/i18n/language";

/**
 * The report card, as a value.
 *
 * Built here and stored as it was built. **A card is a snapshot, not a view.**
 * Marks change afterwards — a correction, a re-mark, a paper found under a
 * desk — and recomputing the card from today's marks would silently rewrite
 * what a parent is holding. So the card keeps its own copy of every number and
 * every grade it printed, and a regenerate is a new card somebody asked for
 * rather than yesterday's card quietly moving.
 *
 * Pure, so the arithmetic on a document a family keeps is testable without a
 * database.
 */

export type ReportRow = {
  subjectCode: string;
  classLabel: string;
  /** One column per exam in the term, in the order they were sat. */
  marks: {
    assessmentCode: string;
    assessmentLabelHi: string;
    assessmentLabelEn: string;
    value: number | null;
    absent: boolean;
    maxMarks: number;
    weight: number;
  }[];
  scored: number;
  outOf: number;
  percent: number | null;
  grade: string | null;
};

export type ReportCard = {
  sessionLabel: string;
  term: string;
  studentId: string;
  studentName: string;
  admissionNo: string | null;
  rollNo: string | null;
  classLabel: string;
  fatherName: string | null;
  rows: ReportRow[];
  totals: Totals;
  grade: string | null;
  gradeDescription: Localized | null;
  attendance: {
    present: number;
    counted: number;
    percent: number | null;
  } | null;
  generatedAt: string;
};

export type ReportInput = {
  sessionLabel: string;
  term: string;
  student: {
    id: string;
    fullName: string;
    admissionNo: string | null;
    rollNo: string | null;
    classLabel: string;
    fatherName: string | null;
  };
  assessments: Assessment[];
  papers: AssessmentSubject[];
  /** `${assessmentSubjectId}|${studentId}` → the mark. */
  marks: Map<string, Mark>;
  attendance: { present: number; counted: number; percent: number | null } | null;
  generatedAt: string;
};

/**
 * Build one card.
 *
 * Weighting is applied to the *percentage*, not to any printed mark: a paper
 * is out of what it is out of, and a family reading "34 out of 40" should see
 * the number the teacher wrote. The weight decides how much that paper counts
 * towards the term, which is where a school actually means it to apply — see
 * `totalsFor()`, which is the one place it happens. `totals.weighted` says
 * whether it changed anything, so a card can tell a parent why the percentage
 * is not simply the two numbers beside it divided.
 */
export function buildReportCard(input: ReportInput): ReportCard {
  const byAssessment = new Map(input.assessments.map((entry) => [entry.id, entry]));

  // One row per subject, whichever exams it was examined in.
  const bySubject = new Map<string, AssessmentSubject[]>();
  for (const paper of input.papers) {
    const list = bySubject.get(paper.subjectCode) ?? [];
    list.push(paper);
    bySubject.set(paper.subjectCode, list);
  }

  const rows: ReportRow[] = [];
  const everyResult: { paper: AssessmentSubject; mark: Mark | undefined }[] = [];

  for (const [subjectCode, papers] of [...bySubject.entries()].sort((a, b) =>
    a[0].localeCompare(b[0], "en"),
  )) {
    const ordered = [...papers].sort((a, b) => {
      const left = byAssessment.get(a.assessmentId);
      const right = byAssessment.get(b.assessmentId);
      return (left?.code ?? "").localeCompare(right?.code ?? "", "en");
    });

    const results = ordered.map((paper) => ({
      paper,
      mark: input.marks.get(`${paper.id}|${input.student.id}`),
      weight: byAssessment.get(paper.assessmentId)?.weight ?? 1,
    }));

    everyResult.push(...results);

    const totals = totalsFor(results);

    rows.push({
      subjectCode,
      classLabel: ordered[0]?.classLabel ?? "",
      marks: ordered.map((paper) => {
        const assessment = byAssessment.get(paper.assessmentId);
        const mark = input.marks.get(`${paper.id}|${input.student.id}`);
        return {
          assessmentCode: assessment?.code ?? "",
          assessmentLabelHi: assessment?.labelHi ?? "",
          assessmentLabelEn: assessment?.labelEn ?? "",
          value: mark?.value ?? null,
          absent: mark?.absent ?? false,
          maxMarks: paper.maxMarks,
          weight: assessment?.weight ?? 1,
        };
      }),
      scored: totals.scored,
      outOf: totals.outOf,
      percent: totals.percent,
      grade: gradeFor(totals.percent)?.label ?? null,
    });
  }

  const totals = totalsFor(everyResult);
  const band = gradeFor(totals.percent);

  return {
    sessionLabel: input.sessionLabel,
    term: input.term,
    studentId: input.student.id,
    studentName: input.student.fullName,
    admissionNo: input.student.admissionNo,
    rollNo: input.student.rollNo,
    classLabel: input.student.classLabel,
    fatherName: input.student.fatherName,
    rows,
    totals,
    grade: band?.label ?? null,
    gradeDescription: band?.description ?? null,
    attendance: input.attendance,
    generatedAt: input.generatedAt,
  };
}

/**
 * Whether a card is worth issuing yet.
 *
 * A card with half the papers unmarked is not a report, it is a rehearsal —
 * and one handed to a family with three blank subjects is a phone call the
 * school does not need. This does not refuse; it says what is missing, and the
 * screen shows it beside the button.
 */
export function readiness(card: ReportCard): {
  ready: boolean;
  missing: number;
  subjects: string[];
  note: Localized;
} {
  const subjects = card.rows
    .filter((row) => row.marks.some((mark) => mark.value === null && !mark.absent))
    .map((row) => row.subjectCode);

  const missing = card.totals.missing;

  if (missing === 0) {
    return {
      ready: true,
      missing: 0,
      subjects: [],
      note: t("सब अंक भरे जा चुके हैं।", "Every paper has a mark."),
    };
  }

  return {
    ready: false,
    missing,
    subjects,
    note: t(
      `${missing} पेपर के अंक अभी नहीं भरे गए।`,
      `${missing} paper${missing === 1 ? "" : "s"} still have no mark.`,
    ),
  };
}

/* ---------------------------------------------------------------- export */

/**
 * A CSV, quoted properly.
 *
 * A child's name can contain a comma and a note can contain a newline, and
 * either one turns an unquoted export into a file that opens with the columns
 * shifted — which is worse than an export that fails, because somebody will
 * act on it.
 *
 * The BOM is for Excel: without it, Devanagari opens as mojibake on a Windows
 * machine, which is every machine in this school's office.
 */
export const CSV_BOM = "﻿";

export function toCsv(rows: (string | number | null)[][]): string {
  const cell = (value: string | number | null) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  return CSV_BOM + rows.map((row) => row.map(cell).join(",")).join("\r\n");
}

export type MarksExportRow = {
  rollNo: string | null;
  studentName: string;
  classLabel: string;
  subjectCode: string;
  assessmentCode: string;
  value: number | null;
  absent: boolean;
  maxMarks: number;
};

export function marksCsv(rows: MarksExportRow[]): string {
  const header = [
    "Roll no",
    "Student",
    "Class",
    "Subject",
    "Exam",
    "Marks",
    "Out of",
    "Status",
  ];

  const body = rows.map((row) => [
    row.rollNo,
    row.studentName,
    row.classLabel,
    row.subjectCode,
    row.assessmentCode,
    // An absence and a blank must not both read as an empty cell: one is a
    // fact about the child and the other is a fact about the school.
    row.absent ? null : row.value,
    row.maxMarks,
    row.absent ? "Absent" : row.value === null ? "Not entered" : "Entered",
  ]);

  return toCsv([header, ...body]);
}

/** A filename somebody can find again in a downloads folder six months on. */
export function exportFileName(kind: string, scope: string, day: string): string {
  const safe = scope.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `vppsone-${kind}-${safe || "all"}-${day}.csv`;
}
