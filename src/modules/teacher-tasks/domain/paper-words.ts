import { byClassLabel } from "@/modules/academics/domain/class-order";
import { groupOf, subjectWords } from "@/vx/screens/exams/domain/groups";
import { classSubject, examWord } from "@/vx/screens/teach/domain/today";
import type { Pair } from "@/vx/text";

import type { TaskSummary } from "./tasks";

/*
 * A marks paper on a teacher's "My tasks", said the way the marks screens say
 * it (D-527).
 *
 * Every open exam lists the same class and subject again, so a teacher with
 * First formative and Half yearly both open read "अंक · Class 1 · EVS" twice,
 * with nothing to tell the two apart, in no particular order, and with the
 * class and subject in English codes on a Hindi screen. A paper now carries
 * its exam, which the list shows under the title with the exam office's
 * "marks due" day, and its class and subject are named by the rule every
 * other teacher screen uses ("कक्षा 1 · पर्यावरण").
 */

/** The paper behind a marks task: its class, its subject's code and its exam. */
export type TaskPaper = { classLabel: string; subjectCode: string; exam: Pair; examStartsOn: string | null };

/** A task on a teacher's own list. Only marks papers read from the paper itself carry `paper`. */
export type TeacherTaskSummary = TaskSummary & { paper?: TaskPaper };

type ExamSource = { label_en: string; label_hi: string | null; starts_on: string | null };

/**
 * The paper as the marks query returns it, with its exam embedded. PostgREST
 * sends a paper's one exam as an object; the client's typing calls it a list,
 * so either is read.
 */
export type PaperSource = {
  class_label: string;
  subject_code: string;
  assessments: ExamSource | ExamSource[] | null;
};

export function taskPaper(row: PaperSource): TaskPaper {
  const exam = Array.isArray(row.assessments) ? (row.assessments[0] ?? null) : row.assessments;
  return {
    classLabel: row.class_label,
    subjectCode: row.subject_code,
    exam: exam ? examWord(exam.label_en, exam.label_hi) : { en: "" },
    examStartsOn: exam?.starts_on ?? null,
  };
}

/** "Class 1 · EVS" / "कक्षा 1 · पर्यावरण": the class and subject, as on the marks cards. */
export function paperTitle(paper: TaskPaper): Pair {
  return classSubject(paper.classLabel, subjectWords(paper.subjectCode));
}

const NO_DATE = "9999-12-31";
const prePrimaryFirst = (label: string) => (groupOf(label) === "pre" ? 0 : 1);

/**
 * Papers in the order the school works through them: the oldest exam first
 * (an exam with no dates after the dated ones), then the class in school order
 * (Nursery before Class 1, Class 2 before Class 10), then the subject's name.
 */
export function paperOrder(a: TaskPaper, b: TaskPaper): number {
  const ad = a.examStartsOn ?? NO_DATE;
  const bd = b.examStartsOn ?? NO_DATE;
  if (ad !== bd) return ad < bd ? -1 : 1;
  return (
    a.exam.en.localeCompare(b.exam.en) ||
    prePrimaryFirst(a.classLabel) - prePrimaryFirst(b.classLabel) ||
    byClassLabel(a.classLabel, b.classLabel) ||
    byClassLabel(subjectWords(a.subjectCode).en, subjectWords(b.subjectCode).en)
  );
}
