import "server-only";

import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { schoolToday } from "@/platform/dates";

import {
  classesFor,
  listExams,
  liveLinks,
  marksLinkUrl,
  remindersFor,
  staffList,
  trackerFor,
  type ClassInfo,
  type Exam,
  type MarkRow,
  type PaperRow,
  type RollEntry,
  type StaffLite,
} from "./data";
import { maskPhone } from "./domain/office";
import { expectedShare, isLate, overall, paperStatus, teacherLoads, type PaperFacts, type PaperStatus } from "./domain/tracker";

/*
 * What the exam office's three screens and the marks tracker share: the
 * session, its exams, the classes and staff, and for one exam who is behind.
 */

export type OfficeContext = {
  sessionLabel: string;
  today: string;
  exams: Exam[];
  classes: ClassInfo[];
  staff: StaffLite[];
  coordinatorName: string | null;
};

/**
 * `now` is the reader's school clock (`schoolNow(staff)`, the lab clock for a
 * lab account): it decides what "today" reads as, never what is saved.
 */
export async function officeContext(now?: Date): Promise<OfficeContext | null> {
  const sessionLabel = await resolveSessionLabel();
  if (!sessionLabel) return null;
  const [exams, classes, staff] = await Promise.all([listExams(sessionLabel), classesFor(sessionLabel), staffList()]);
  return {
    sessionLabel,
    today: schoolToday(now),
    exams,
    classes,
    staff,
    coordinatorName: staff.find((s) => s.role === "exam_coordinator")?.name ?? null,
  };
}

/** One teacher with marks still to send, as the late list and the reminder sheet show her. */
export type TeacherRow = {
  id: string;
  name: string;
  phone: string | null;
  phoneMasked: string;
  papers: { paperId: string; classLabel: string; subjectCode: string; entered: number; total: number; status: PaperStatus }[];
  entered: number;
  total: number;
  late: boolean;
  notStarted: boolean;
  link: { url: string; createdAt: string; openedAt: string | null } | null;
  remindedAt: string | null;
};

export type ExamProgress = {
  papers: PaperFacts[];
  rows: PaperRow[];
  marks: MarkRow[];
  roll: Map<string, RollEntry[]>;
  expected: number;
  overall: ReturnType<typeof overall>;
  teachers: TeacherRow[];
  lateCount: number;
};

/** An exam's marks so far and everyone still to finish, the furthest behind first. */
export async function examProgress(ctx: OfficeContext, exam: Exam, onlyPapers?: (paper: PaperRow) => boolean): Promise<ExamProgress> {
  const [tracked, links, reminded] = await Promise.all([
    trackerFor({ exam, classes: ctx.classes, staff: ctx.staff, today: ctx.today, onlyPapers }),
    liveLinks(exam.id),
    remindersFor(exam.id),
  ]);
  const expected = expectedShare(exam.endsOn, exam.plan?.marksDueOn ?? null, ctx.today);
  const staffOf = new Map(ctx.staff.map((s) => [s.id, s]));
  const linkOf = new Map(links.map((l) => [l.staff_profile_id, l]));
  const teachers: TeacherRow[] = teacherLoads(tracked.papers, expected).map((load) => {
    const person = staffOf.get(load.teacherId);
    const link = linkOf.get(load.teacherId);
    return {
      id: load.teacherId,
      name: load.teacherName,
      phone: person?.phone ?? null,
      phoneMasked: maskPhone(person?.phone),
      papers: load.papers
        .sort((a, b) => a.classSort - b.classSort || a.subjectCode.localeCompare(b.subjectCode))
        .map((p) => ({ paperId: p.paperId, classLabel: p.classLabel, subjectCode: p.subjectCode, entered: p.entered, total: p.total, status: paperStatus(p) })),
      entered: load.entered,
      total: load.total,
      late: load.late,
      notStarted: load.notStarted,
      link: link ? { url: marksLinkUrl(link.token), createdAt: link.created_at, openedAt: link.last_opened_at } : null,
      remindedAt: reminded.get(load.teacherId) ?? null,
    };
  });
  return {
    ...tracked,
    expected,
    overall: overall(tracked.papers),
    teachers,
    lateCount: teachers.filter((t) => t.late).length,
  };
}

/** Whether a paper is behind, for colouring a cell. */
export function paperLate(paper: PaperFacts, expected: number): boolean {
  return isLate(paper, expected);
}
