import { z } from "zod";

import { encodeMessage, t, type Localized } from "@/platform/i18n/language";

/**
 * Exams, papers and the rules around entering a mark.
 *
 * Pure: no database, no React. The interesting parts of this module are all
 * the same kind of thing — **what a missing mark means**, and what a school is
 * allowed to do to a mark somebody has already seen.
 */

export const assessmentKinds = [
  "formative",
  "summative",
  "practical",
  "other",
] as const;

export type AssessmentKind = (typeof assessmentKinds)[number];

export const assessmentKindLabels: Record<AssessmentKind, Localized> = {
  formative: t("सतत मूल्यांकन", "Formative"),
  summative: t("सत्रांत परीक्षा", "Summative"),
  practical: t("प्रायोगिक", "Practical"),
  other: t("अन्य", "Other"),
};

export const assessmentStatuses = ["draft", "open", "locked"] as const;
export type AssessmentStatus = (typeof assessmentStatuses)[number];

export const assessmentStatusLabels: Record<AssessmentStatus, Localized> = {
  draft: t("मसौदा", "Draft"),
  open: t("अंक भरे जा रहे हैं", "Open for marks"),
  locked: t("बंद", "Locked"),
};

export type Assessment = {
  id: string;
  sessionLabel: string;
  term: string;
  code: string;
  labelHi: string;
  labelEn: string;
  kind: AssessmentKind;
  startsOn: string | null;
  endsOn: string | null;
  weight: number;
  status: AssessmentStatus;
  lockedAt: string | null;
  lockedByName: string | null;
};

export type AssessmentSubject = {
  id: string;
  assessmentId: string;
  classId: string;
  classLabel: string;
  subjectId: string;
  subjectCode: string;
  maxMarks: number;
  passMarks: number | null;
  sortOrder: number;
};

/**
 * One cell in the grid.
 *
 * **Three states, not two.** `null` with `absent: false` means nobody has
 * entered it yet; `absent: true` means the child did not sit the paper; a
 * number is a number. A zero is a real mark somebody gave, and a grid that
 * could not tell it from a blank would make "who has not entered yet"
 * unanswerable — which is the question the whole board exists for.
 */
export type Mark = {
  studentId: string;
  value: number | null;
  absent: boolean;
  enteredByName: string | null;
  enteredAt: string | null;
};

export function isEntered(mark: Pick<Mark, "value" | "absent"> | undefined): boolean {
  if (!mark) return false;
  return mark.absent || mark.value !== null;
}

/** What a cell holds, with "nobody has entered this" spelled out. */
export type MarkState = { value: number | null; absent: boolean };

/** A cell nobody has touched. A missing row and a blank row are this, equally. */
export const NOT_ENTERED: MarkState = { value: null, absent: false };

/**
 * Whether saving this would actually change anything.
 *
 * **A missing row and a blank row are the same state.** A teacher who opens a
 * column, fills in one child and saves is submitting every other cell exactly
 * as she found it — and for the children she has not reached, "as she found
 * it" is no row at all. Treating that as a change wrote a log entry reading
 * "not entered → not entered" for each of them and left an empty row behind,
 * which is how this shipped before somebody looked at the screen.
 *
 * D-80: an unchanged save writes nothing. This is the one place that decides
 * what "unchanged" means, so the log and the table cannot disagree about it.
 */
export function markChanged(before: MarkState, after: MarkState): boolean {
  return before.value !== after.value || before.absent !== after.absent;
}

/* ------------------------------------------------------------ validation */

export type MarkCheck = { ok: true; value: number | null } | { ok: false; error: Localized };

/**
 * Whether this is a mark that can exist.
 *
 * Blank is allowed and means "not entered" — the same rule as everywhere else
 * in this app, and for the same reason: a teacher who has not got to a child
 * has not given them zero.
 *
 * Thirty out of twenty-five is the mistake this catches. It is a slip of one
 * key, it looks plausible on a report card, and by the time anybody notices it
 * has been added into a term total.
 */
export function checkMark(
  raw: string | number | null | undefined,
  paper: Pick<AssessmentSubject, "maxMarks">,
): MarkCheck {
  const text = String(raw ?? "").trim();
  if (text === "") return { ok: true, value: null };

  const value = Number(text);

  if (!Number.isFinite(value)) {
    return { ok: false, error: t("केवल अंक भरें", "Marks must be a number") };
  }

  if (value < 0) {
    return {
      ok: false,
      error: t("ऋणात्मक अंक नहीं होते", "A mark cannot be negative"),
    };
  }

  if (value > paper.maxMarks) {
    return {
      ok: false,
      error: t(
        `अधिकतम ${paper.maxMarks} अंक`,
        `This paper is out of ${paper.maxMarks}`,
      ),
    };
  }

  // Half marks are ordinary; a mark to four decimal places is a typo.
  if (Math.round(value * 2) !== value * 2) {
    return {
      ok: false,
      error: t("आधे अंक तक ही", "Marks go to the half only"),
    };
  }

  return { ok: true, value };
}

/**
 * Whether marks may be entered against this exam at all.
 *
 * A locked exam is one whose report cards have gone out. Changing a mark then
 * is still possible — a re-mark is a real thing — but it goes through
 * somebody with `assessments:manage` unlocking it deliberately, and the change
 * log records both sides either way.
 */
export function canEnterMarks(assessment: Pick<Assessment, "status">): {
  allowed: boolean;
  reason?: Localized;
} {
  if (assessment.status === "open") return { allowed: true };

  if (assessment.status === "draft") {
    return {
      allowed: false,
      reason: t(
        "यह परीक्षा अभी शुरू नहीं हुई।",
        "This exam has not been opened for marks yet.",
      ),
    };
  }

  return {
    allowed: false,
    reason: t(
      "यह परीक्षा बंद है — बदलने के लिए पहले खोलनी होगी।",
      "This exam is locked. To change a mark, somebody has to unlock it first.",
    ),
  };
}

/* --------------------------------------------------------------- totals */

export type PaperResult = {
  paper: AssessmentSubject;
  mark: Mark | undefined;
  /**
   * How much this paper's exam counts towards the term — `assessments.weight`.
   *
   * Optional, and 1 when it is left out, so a caller that has no opinion about
   * weighting gets the plain arithmetic it expects.
   */
  weight?: number;
};

export type Totals = {
  /** Papers with a number on them. Absent and blank are both excluded. */
  counted: number;
  /** Papers the child sat but has no mark for yet. */
  missing: number;
  absent: number;
  /** The plain sum of what the teachers wrote — it adds up by hand. */
  scored: number;
  outOf: number;
  /** Null when there is nothing to divide by — never 0, never 100. */
  percent: number | null;
  /**
   * Whether `percent` came out of unequal weights.
   *
   * False whenever every paper counts the same, which is the normal case and
   * makes `percent` exactly `scored / outOf`. True only when a school has
   * actually said one exam counts for more — and then a screen printing the
   * percentage has to say so, because otherwise it does not match the two
   * numbers printed beside it.
   */
  weighted: boolean;
};

/**
 * A child's total across a set of papers.
 *
 * **A paper nobody has marked is left out of both halves**, rather than
 * counted as zero. A term total that quietly treated an unmarked paper as
 * nought would hand a family a percentage the child did not earn, and the
 * error looks exactly like a bad result.
 *
 * **An absence is counted as a zero it is out of**, because the child sat the
 * term and did not sit the paper — that is a real nought on a real report,
 * which is not the same thing as a teacher being behind.
 *
 * **Weight applies to the percentage, never to a printed mark.** A paper is
 * out of what it is out of, and a family reading "34 out of 40" should see the
 * number the teacher wrote — so `scored` and `outOf` are the plain sums and
 * add up by hand. What a school means by "the half-yearly counts double" is
 * that it counts double *towards the term*, which is the percentage, and that
 * is the only place it is applied. With every weight equal — the default, and
 * the only case until somebody sets one — the two are identical and `weighted`
 * is false.
 */
export function totalsFor(results: PaperResult[]): Totals {
  let counted = 0;
  let missing = 0;
  let absent = 0;
  let scored = 0;
  let outOf = 0;

  // The same two sums with each paper's weight applied, kept separately so the
  // printed totals stay the ones a parent can check with a pen.
  let weightedScored = 0;
  let weightedOutOf = 0;
  const weightsUsed = new Set<number>();

  for (const { paper, mark, weight } of results) {
    const counts = weight ?? 1;

    if (mark?.absent) {
      absent += 1;
      outOf += paper.maxMarks;
      weightedOutOf += paper.maxMarks * counts;
      weightsUsed.add(counts);
      continue;
    }

    if (mark?.value === null || mark?.value === undefined) {
      missing += 1;
      continue;
    }

    counted += 1;
    scored += mark.value;
    outOf += paper.maxMarks;
    weightedScored += mark.value * counts;
    weightedOutOf += paper.maxMarks * counts;
    weightsUsed.add(counts);
  }

  return {
    counted,
    missing,
    absent,
    scored,
    outOf,
    percent:
      weightedOutOf === 0
        ? null
        : Math.round((weightedScored / weightedOutOf) * 1000) / 10,
    weighted: weightsUsed.size > 1,
  };
}

/* --------------------------------------------------------------- grades */

export type GradeBand = {
  /** Inclusive lower bound, as a percentage. */
  from: number;
  label: string;
  description: Localized;
};

/**
 * The grade bands a percentage falls into.
 *
 * **A default, not the school's own scheme.** Nobody has told this repo what
 * Shri Veer Patta grades on, and inventing one silently would put a letter on
 * a report card that means something different to the family reading it. These
 * are the common CBSE-style bands; when the school confirms theirs, moving
 * them to a table is a small change, and a report card already keeps its own
 * copy of the grade it printed so nothing already issued would move.
 */
export const GRADE_BANDS: GradeBand[] = [
  { from: 91, label: "A1", description: t("उत्कृष्ट", "Outstanding") },
  { from: 81, label: "A2", description: t("बहुत अच्छा", "Excellent") },
  { from: 71, label: "B1", description: t("अच्छा", "Very good") },
  { from: 61, label: "B2", description: t("संतोषजनक", "Good") },
  { from: 51, label: "C1", description: t("ठीक", "Fair") },
  { from: 41, label: "C2", description: t("सुधार आवश्यक", "Needs improvement") },
  { from: 33, label: "D", description: t("न्यूनतम", "Just passing") },
  { from: 0, label: "E", description: t("पुनः प्रयास", "Needs much more work") },
];

export function gradeFor(percent: number | null): GradeBand | null {
  if (percent === null) return null;
  return GRADE_BANDS.find((band) => percent >= band.from) ?? null;
}

/** Whether this paper was passed, when the school set a pass mark for it. */
export function passed(
  mark: Pick<Mark, "value" | "absent"> | undefined,
  paper: Pick<AssessmentSubject, "passMarks">,
): boolean | null {
  if (paper.passMarks === null) return null;
  if (!mark || mark.absent) return false;
  if (mark.value === null) return null;
  return mark.value >= paper.passMarks;
}

/* ------------------------------------------------------------- progress */

export type PaperProgress = {
  paper: AssessmentSubject;
  expected: number;
  entered: number;
  percent: number;
  done: boolean;
};

/**
 * How far each paper has got.
 *
 * **Finished papers stay on the list.** That is the whole difference from a
 * list built to feed reminders: a board that dropped them would show a teacher
 * who had entered everything as absent, which reads identically to a teacher
 * nobody asked. Ported in spirit from `sampark/src/lib/progress.ts`, whose own
 * header makes the same point.
 */
export function paperProgress(
  paper: AssessmentSubject,
  roll: number,
  marks: Map<string, Mark>,
  studentIds: string[],
): PaperProgress {
  let entered = 0;
  for (const studentId of studentIds) {
    if (isEntered(marks.get(studentId))) entered += 1;
  }

  return {
    paper,
    expected: roll,
    entered,
    percent: roll === 0 ? 0 : Math.round((entered / roll) * 100),
    done: roll > 0 && entered === roll,
  };
}

export function outstandingPapers(progress: PaperProgress[]): PaperProgress[] {
  return progress.filter((entry) => !entry.done);
}

/* ----------------------------------------------------------- validation */

const label = (hi: string, en: string) =>
  z
    .string()
    .trim()
    .min(1, { message: encodeMessage(t(hi, en)) })
    .max(80, { message: encodeMessage(t("बहुत लंबा है", "That is too long")) });

export const assessmentSchema = z.object({
  term: label("सत्र भरें", "Name the term"),
  code: z
    .string()
    .trim()
    .min(1, { message: encodeMessage(t("कोड भरें", "Give it a short code")) })
    .max(20)
    .regex(/^[A-Za-z0-9 _-]+$/, {
      message: encodeMessage(
        t("कोड में अक्षर और अंक ही", "A code is letters, digits, spaces and dashes"),
      ),
    }),
  labelHi: label("हिन्दी नाम भरें", "Give it a Hindi name"),
  labelEn: label("अंग्रेज़ी नाम भरें", "Give it an English name"),
  kind: z.enum(assessmentKinds),
  startsOn: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  endsOn: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable(),
  weight: z.coerce
    .number()
    .min(0)
    .max(10, {
      message: encodeMessage(
        t("भार 0 से 10 के बीच", "A weight is between 0 and 10"),
      ),
    }),
});

export type AssessmentInput = z.infer<typeof assessmentSchema>;

export const paperSchema = z.object({
  assessmentId: z.uuid(),
  classId: z.uuid({ message: encodeMessage(t("कक्षा चुनें", "Choose a class")) }),
  subjectId: z.uuid({ message: encodeMessage(t("विषय चुनें", "Choose a subject")) }),
  maxMarks: z.coerce
    .number()
    .positive({ message: encodeMessage(t("पूर्णांक भरें", "Say what it is out of")) })
    .max(1000),
  passMarks: z.coerce.number().min(0).max(1000).nullable(),
  sortOrder: z.coerce.number().int().min(0).max(999),
});

export type PaperInput = z.infer<typeof paperSchema>;

/** Terms in the order a school runs them, newest last. */
export function orderTerms(terms: string[]): string[] {
  return [...new Set(terms)].sort((a, b) => a.localeCompare(b, "en"));
}
