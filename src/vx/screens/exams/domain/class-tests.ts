import { p, type Pair } from "@/vx/text";

/*
 * Class tests (D-609): any test a teacher takes, any day, out of any marks.
 * Kept apart from the school's exams. A class test may say it counts in one
 * school exam ("Count in Test I"); then that exam's sheet offers to fill its
 * boxes from the counted tests, and the teacher checks each number before she
 * sends. Nothing here ever writes an exam mark.
 */

/** The marks a new test is most often out of, as tap-once chips. */
export const OUT_OF_CHOICES = [10, 20, 25, 50, 100] as const;

export type ClassTestStatus = "open" | "finished";

export type ClassTest = {
  id: string;
  sessionLabel: string;
  classId: string;
  classLabel: string;
  subjectId: string;
  subjectCode: string;
  title: string;
  heldOn: string;
  maxMarks: number;
  markStep: number;
  countsIn: string | null;
  status: ClassTestStatus;
  revision: number;
  createdBy: string;
};

export type NewTestInput = {
  classId: string;
  subjectId: string;
  maxMarks: number;
  title?: string | null;
  heldOn?: string | null;
  countsIn?: string | null;
};

export type NewTestProblem = "pick_class" | "bad_marks" | "bad_title" | "bad_day";

/** What is wrong with a new test, or null; the screen says it in words. */
export function newTestProblem(input: NewTestInput, today: string): NewTestProblem | null {
  if (!isId(input.classId) || !isId(input.subjectId)) return "pick_class";
  if (!Number.isFinite(input.maxMarks) || input.maxMarks <= 0 || input.maxMarks > 500 || !Number.isInteger(input.maxMarks * 2)) return "bad_marks";
  const title = (input.title ?? "").trim();
  if (title.length > 80) return "bad_title";
  const day = input.heldOn ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > today) return "bad_day";
  return null;
}

export const NEW_TEST_PROBLEM: Record<NewTestProblem, Pair> = {
  pick_class: p("Pick the class and subject first.", "पहले कक्षा और विषय चुनें।"),
  bad_marks: p("The test can be out of 1 to 500 marks.", "टेस्ट 1 से 500 अंक तक का हो सकता है।"),
  bad_title: p("Keep the name under 80 letters.", "नाम 80 अक्षर से छोटा रखें।"),
  bad_day: p("The test day cannot be after today.", "टेस्ट का दिन आज के बाद का नहीं हो सकता।"),
};

const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_HI = ["जन", "फ़र", "मार्च", "अप्रै", "मई", "जून", "जुला", "अग", "सितं", "अक्टू", "नवं", "दिसं"];

/** "14 Nov" / "14 नवं" from "2026-11-14". */
export function dayWords(day: string): Pair {
  const m = Number(day.slice(5, 7)) - 1;
  const d = Number(day.slice(8, 10));
  return p(`${d} ${MONTHS_EN[m] ?? ""}`.trim(), `${d} ${MONTHS_HI[m] ?? ""}`.trim());
}

/** A test with no name typed is "Test · 14 Nov": nobody has to think of a name to start. */
export function defaultTitle(heldOn: string): string {
  return `Test · ${dayWords(heldOn).en}`;
}

/** The test's name in both languages: an untouched default reads "टेस्ट · 14 नवं" in Hindi. */
export function testTitle(test: Pick<ClassTest, "title" | "heldOn">): { en: string; hi: string } {
  if (test.title === defaultTitle(test.heldOn)) return { en: test.title, hi: `टेस्ट · ${dayWords(test.heldOn).hi}` };
  return { en: test.title, hi: test.title };
}

/* ------------------------------------------------------------ the fill */

export type TestMark = { value: number | null; absent: boolean };

export type CountedTest = {
  id: string;
  maxMarks: number;
  /** Each child's mark in it; a child with no row was not marked. */
  marks: ReadonlyMap<string, TestMark>;
};

export type Fill = {
  /** The suggested mark, or null when the child sat none of the tests. */
  value: number | null;
  /** How many of the counted tests the child sat. */
  sat: number;
  scored: number;
  outOf: number;
};

/** Half up to the paper's step: 12.5 on a whole-mark paper is 13, 12.25 on a half-mark paper is 12.5. */
export function roundToStep(value: number, step: number): number {
  const s = step > 0 ? step : 1;
  // A tiny nudge so 12.5 computed as 12.4999999 still rounds up.
  return Math.round((value + 1e-9) / s) * s;
}

/**
 * The mark a school exam paper would get from the class tests that count in
 * it: everything the child scored ÷ everything those tests were out of × the
 * paper's maximum, half up to the paper's step. A test the child was absent
 * from, or has no mark in, is left out of both totals, so missing one test
 * neither drags the mark down nor counts as zero. A child who sat none of them
 * gets no suggestion: the teacher decides.
 */
export function fillFor(studentId: string, tests: readonly CountedTest[], paperMax: number, paperStep: number): Fill {
  let scored = 0;
  let outOf = 0;
  let sat = 0;
  for (const test of tests) {
    const mark = test.marks.get(studentId);
    if (!mark || mark.absent || mark.value === null || test.maxMarks <= 0) continue;
    scored += mark.value;
    outOf += test.maxMarks;
    sat += 1;
  }
  if (outOf === 0 || paperMax <= 0) return { value: null, sat: 0, scored: 0, outOf: 0 };
  const raw = (scored / outOf) * paperMax;
  const value = Math.min(paperMax, Math.max(0, roundToStep(raw, paperStep)));
  return { value, sat, scored, outOf };
}

/** Every child's suggestion; children with none are left out. */
export function fillAll(studentIds: readonly string[], tests: readonly CountedTest[], paperMax: number, paperStep: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of studentIds) {
    const fill = fillFor(id, tests, paperMax, paperStep);
    if (fill.value !== null) out[id] = fill.value;
  }
  return out;
}

/* ------------------------------------------------------ count targets */

export type CountTarget = { id: string; code: string; en: string; hi: string; startsOn: string | null };

/**
 * The school exams a class test may count in: the formative ones of its
 * session (Test I, Test II), open for marks and with a paper for this class
 * and subject. A summative exam (Half Yearly) is a paper of its own and is
 * never filled from class tests.
 */
export function countTargets<E extends { id: string; code: string; labelEn: string; labelHi: string; kind: string; status: string; startsOn: string | null }>(
  exams: readonly E[],
  hasPaper: (examId: string) => boolean,
): CountTarget[] {
  return exams
    .filter((e) => e.kind === "formative" && e.status === "open" && hasPaper(e.id))
    .map((e) => ({ id: e.id, code: e.code, en: e.labelEn, hi: e.labelHi, startsOn: e.startsOn }));
}

export type PaperFact = { assessment_id: string; class_id: string; subject_id: string; entry_status: string };

/**
 * The count targets for one class-subject, read from the exams' papers. Only a
 * paper still open for marks can take a class test: once its marks are sent
 * there is nothing left to fill. The exam a test already counts in (`keep`)
 * stays listed while it has a paper here, so the test's card still says so.
 */
export function classSubjectTargets<E extends { id: string; code: string; labelEn: string; labelHi: string; kind: string; status: string; startsOn: string | null }>(
  exams: readonly E[],
  papers: readonly PaperFact[],
  classId: string,
  subjectId: string,
  keep: string | null = null,
): CountTarget[] {
  const here = papers.filter((r) => r.class_id === classId && r.subject_id === subjectId);
  const open = new Set(here.filter((r) => r.entry_status === "open").map((r) => r.assessment_id));
  const kept = keep && here.some((r) => r.assessment_id === keep) ? keep : null;
  const ids = new Set(countTargets(exams, (id) => open.has(id)).map((t) => t.id));
  if (kept) ids.add(kept);
  return exams.filter((e) => ids.has(e.id)).map((e) => ({ id: e.id, code: e.code, en: e.labelEn, hi: e.labelHi, startsOn: e.startsOn }));
}

/** "Counts in Test I" / "Progress only", said on a test's card. */
export function countLine(target: Pick<CountTarget, "en" | "hi"> | null): Pair {
  return target ? p(`Counts in ${target.en}`, `${target.hi || target.en} में जुड़ेगा`) : p("Progress only", "केवल प्रगति के लिए");
}

/** The button on a school exam's sheet that fills it from class tests. */
export function fillButton(count: number): Pair {
  return p(
    `Fill from ${count} class ${count === 1 ? "test" : "tests"}`,
    `${count} कक्षा ${count === 1 ? "टेस्ट" : "टेस्टों"} से भरें`,
  );
}

/** What the sheet says after filling: only blank boxes are filled, and she checks each. */
export function filledLine(filled: number, skipped: number): Pair {
  const en = `${filled} blank ${filled === 1 ? "box was" : "boxes were"} filled from class tests.${skipped ? ` ${skipped} already had a mark and were left as they were.` : ""} Check each mark before you send.`;
  const hi = `${filled} खाली खाने कक्षा टेस्टों से भरे गए।${skipped ? ` ${skipped} में पहले से अंक थे, उन्हें नहीं छुआ।` : ""} भेजने से पहले हर अंक जाँच लें।`;
  return p(en, hi);
}

function isId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}
