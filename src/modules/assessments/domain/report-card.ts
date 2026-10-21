import {
  gradeFor,
  totalsFor,
  type Assessment,
  type AssessmentSubject,
  type Mark,
  type Totals,
} from "@/modules/assessments/domain/assessments";
import { t, type Localized } from "@/platform/i18n/language";
import { spreadsheetText } from "@/platform/helpers/spreadsheet-text";
import {
  gradeWith,
  schemePercent,
  type GradeBandRule,
} from "@/modules/assessments/domain/report-scheme";

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
    /** Excused from the paper: shown as such, out of both halves (P7). */
    exempt: boolean;
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
  attendance: CardAttendance | null;
  /** The rules the card was worked out by, copied in so it prints the same forever (P8). */
  scheme: CardScheme | null;
  /**
   * The result, by `cardResult()`: every paper with a pass mark passed (after
   * any grace given), none missed unless excused, and the overall percentage
   * at the scheme's pass mark. Null while a mark is still to come and nothing
   * has failed, or when neither the scheme nor any paper states a pass mark.
   */
  passed: boolean | null;
  /** Subjects with a paper below its pass mark after grace (codes, as the rows). */
  shortIn?: string[];
  /** Subjects with a paper the child missed and was not excused from. */
  absentIn?: string[];
  generatedAt: string;
};

/**
 * Attendance over the scheme's reporting period (P8). Days the register was
 * not recorded are counted separately and never as present: a percentage
 * over recorded days only, with how many were missing beside it.
 */
export type CardAttendance = {
  present: number;
  counted: number;
  percent: number | null;
  from?: string | null;
  to?: string | null;
  /** School days in the period on which the class's register was not recorded. */
  notRecorded?: number;
};

export type CardScheme = {
  id: string;
  revision: number;
  percentDecimals: number;
  passPercent: number | null;
  bands: GradeBandRule[];
  headerEn: string | null;
  headerHi: string | null;
  signatories: { en: string; hi: string }[];
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
  attendance: CardAttendance | null;
  /** The approved scheme, when there is one; the defaults otherwise (a preview). */
  scheme?: CardScheme | null;
  /** Grace given to this child, by paper id (`exam_grace`); it lifts a paper to its pass mark. */
  grace?: Map<string, number>;
  generatedAt: string;
};

/* -------------------------------------------------------------- result */

export type ResultPaper = {
  subjectCode: string;
  value: number | null;
  absent: boolean;
  exempt: boolean;
  passMarks: number | null;
  /** Grace given on this paper; added to the mark only to judge pass, never printed into it. */
  grace?: number;
};

export type CardResult = { passed: boolean | null; shortIn: string[]; absentIn: string[] };

/**
 * Pass or not, per paper — the rule the Grace screen uses (`graceVerdict` in
 * vx/screens/exams/domain/results.ts), so a child the Grace screen lists as
 * "short 26" can never read "Pass" on the card (smoke 20 Oct):
 *
 *  - every paper with a pass mark must reach it, counting any grace given;
 *  - a paper the child missed is not passed, unless the child was excused;
 *  - a blank paper is still to come: no verdict while one is blank, unless a
 *    paper has already failed;
 *  - and the overall percentage must reach the scheme's pass mark, when it
 *    has one.
 *
 * Null when neither the scheme nor any paper states a pass mark. The school
 * has not written this rule down anywhere; it is the Grace screen's, and
 * awaits Janmejay's confirmation.
 */
export function cardResult(input: { percent: number | null; passPercent: number | null | undefined; papers: ResultPaper[] }): CardResult {
  const shortIn = new Set<string>();
  const absentIn = new Set<string>();
  let pending = false;
  let judged = input.passPercent !== null && input.passPercent !== undefined;
  for (const paper of input.papers) {
    if (paper.passMarks === null || paper.exempt) continue;
    judged = true;
    if (paper.absent) {
      absentIn.add(paper.subjectCode);
      continue;
    }
    if (paper.value === null) {
      pending = true;
      continue;
    }
    // Rounded to a tenth, as grace is, so 25.5 + 0.5 reaches 26 exactly.
    if (Math.round((paper.value + (paper.grace ?? 0)) * 10) / 10 < paper.passMarks) shortIn.add(paper.subjectCode);
  }
  const out = { shortIn: [...shortIn], absentIn: [...absentIn] };
  if (!judged) return { passed: null, ...out };
  if (shortIn.size || absentIn.size) return { passed: false, ...out };
  if (pending) return { passed: null, ...out };
  if (input.passPercent !== null && input.passPercent !== undefined) {
    if (input.percent === null) return { passed: null, ...out };
    if (input.percent < input.passPercent) return { passed: false, ...out };
  }
  return { passed: true, ...out };
}

/** The exams a card's percentage is weighted by, in the order they were sat, when their weights differ. */
export function cardWeights(card: Pick<ReportCard, "rows">): { code: string; en: string; hi: string; weight: number }[] {
  const seen = new Map<string, { code: string; en: string; hi: string; weight: number }>();
  for (const column of reportColumns(card.rows)) {
    const mark = card.rows.flatMap((row) => row.marks).find((m) => m.assessmentCode === column.assessmentCode);
    if (mark) seen.set(column.assessmentCode, { code: column.assessmentCode, en: column.assessmentLabelEn, hi: column.assessmentLabelHi, weight: mark.weight });
  }
  const list = [...seen.values()];
  return new Set(list.map((x) => x.weight)).size > 1 ? list : [];
}

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
  const scheme = input.scheme ?? null;

  // With a scheme the percentage is the unrounded fraction rounded once, at
  // the school's boundary, and graded on that rounded number — so a child at
  // 32.95 with a band starting at 33 and one decimal is 33.0 and in it.
  // Without one (a preview before the scheme is approved) the defaults stand.
  const percentOf = (totals: Totals) =>
    scheme ? schemePercent(totals.ratio, scheme.percentDecimals) : totals.percent;
  const gradeOf = (percent: number | null) => {
    if (!scheme) {
      const band = gradeFor(percent);
      return band ? { label: band.label, description: band.description } : null;
    }
    const band = gradeWith(percent, scheme.bands);
    return band ? { label: band.label, description: t(band.hi, band.en) } : null;
  };

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
    // In the order they were sat (by date), the code only breaking a tie, so
    // every row lists its exams in the same order (`reportColumns`).
    const ordered = [...papers].sort((a, b) => {
      const left = byAssessment.get(a.assessmentId);
      const right = byAssessment.get(b.assessmentId);
      return (
        (left?.startsOn ?? "9999-12-31").localeCompare(right?.startsOn ?? "9999-12-31") ||
        (left?.code ?? "").localeCompare(right?.code ?? "", "en")
      );
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
          exempt: mark?.exempt ?? false,
          maxMarks: paper.maxMarks,
          weight: assessment?.weight ?? 1,
        };
      }),
      scored: totals.scored,
      outOf: totals.outOf,
      percent: percentOf(totals),
      grade: gradeOf(percentOf(totals))?.label ?? null,
    });
  }

  const raw = totalsFor(everyResult);
  const totals = { ...raw, percent: percentOf(raw) };
  const band = gradeOf(totals.percent);
  const result = cardResult({
    percent: totals.percent,
    passPercent: scheme?.passPercent ?? null,
    papers: everyResult.map(({ paper, mark }) => ({
      subjectCode: paper.subjectCode,
      value: mark?.value ?? null,
      absent: mark?.absent ?? false,
      exempt: mark?.exempt ?? false,
      passMarks: paper.passMarks,
      grace: input.grace?.get(paper.id) ?? 0,
    })),
  });

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
    scheme,
    passed: result.passed,
    shortIn: result.shortIn,
    absentIn: result.absentIn,
    generatedAt: input.generatedAt,
  };
}

/* ------------------------------------------------------------- columns */

export type ReportMark = ReportRow["marks"][number];

export type ReportColumn = {
  assessmentCode: string;
  assessmentLabelEn: string;
  assessmentLabelHi: string;
  /** What every paper in the column is out of; null when subjects differ. */
  maxMarks: number | null;
};

/**
 * The card's exam columns: every exam any subject was examined in, in the
 * order the rows list them.
 *
 * Not the first row's exams. One subject sat only the half-yearly (ELGA has
 * no FA1), so a header built from the first row had five columns while the
 * other rows had six, and every mark sat under the wrong heading — on screen,
 * in print and in the PDF (coordinators B5). Works on an issued card too: it
 * reads only what the card stored.
 */
export function reportColumns(rows: Pick<ReportRow, "marks">[]): ReportColumn[] {
  const order: string[] = [];
  const first = new Map<string, ReportMark>();
  const maxes = new Map<string, Set<number>>();
  for (const row of rows) {
    let after = -1;
    for (const mark of row.marks) {
      const code = mark.assessmentCode;
      const at = order.indexOf(code);
      if (at === -1) {
        // Keep this row's order: a new exam goes just after the last one it follows.
        order.splice(after + 1, 0, code);
        after += 1;
        first.set(code, mark);
      } else {
        after = Math.max(after, at);
      }
      maxes.set(code, (maxes.get(code) ?? new Set()).add(mark.maxMarks));
    }
  }
  return order.map((code) => {
    const mark = first.get(code)!;
    const max = maxes.get(code)!;
    return {
      assessmentCode: code,
      assessmentLabelEn: mark.assessmentLabelEn,
      assessmentLabelHi: mark.assessmentLabelHi,
      maxMarks: max.size === 1 ? [...max][0] : null,
    };
  });
}

/** A row's mark under a column, or null when the subject was not examined in that exam. */
export function markIn(row: Pick<ReportRow, "marks">, assessmentCode: string): ReportMark | null {
  return row.marks.find((mark) => mark.assessmentCode === assessmentCode) ?? null;
}

/**
 * A card with nothing on it: no subject, or not one mark, absence or
 * exemption anywhere. Never issued — a family must not be handed a blank card
 * (coordinators B3).
 */
export function isEmptyCard(card: Pick<ReportCard, "rows">): boolean {
  return !card.rows.some((row) => row.marks.some((mark) => mark.value !== null || mark.absent || mark.exempt));
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
    .filter((row) => row.marks.some((mark) => mark.value === null && !mark.absent && !mark.exempt))
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
    const text = spreadsheetText(value);
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
  exempt: boolean;
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
    row.absent || row.exempt ? null : row.value,
    row.maxMarks,
    row.exempt ? "Exempt" : row.absent ? "Absent" : row.value === null ? "Not entered" : "Entered",
  ]);

  return toCsv([header, ...body]);
}

/** A filename somebody can find again in a downloads folder six months on. */
export function exportFileName(kind: string, scope: string, day: string): string {
  const safe = scope.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `vppsone-${kind}-${safe || "all"}-${day}.csv`;
}
