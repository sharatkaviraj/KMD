/*
 * The marks tracker: where every paper of an exam has got to, who is behind,
 * and how far each class is from a report card. Pure, so the board, the
 * coordinator's home and the results pipeline all count the same way.
 */

export type EnrolmentFacts = {
  studentId: string;
  classId: string;
  status: string;
  enrolledOn: string | null;
  leftOn: string | null;
};

/**
 * Who sat an exam in a class — the same rule as `vppsone.paper_roster`, which
 * is what `save_marks` checks against: on the roll by the exam's last day, and
 * still there when it began.
 */
export function onRoll(e: EnrolmentFacts, exam: { startsOn: string | null; endsOn: string | null }, today: string): boolean {
  const end = exam.endsOn ?? exam.startsOn ?? today;
  const start = exam.startsOn ?? exam.endsOn ?? today;
  if (e.enrolledOn && e.enrolledOn > end) return false;
  if ((e.status === "enrolled" || e.status === "promoted") && !e.leftOn) return true;
  return Boolean(e.leftOn && e.leftOn >= start);
}

export type PaperFacts = {
  paperId: string;
  classId: string;
  classLabel: string;
  classSort: number;
  subjectCode: string;
  teacherId: string | null;
  teacherName: string | null;
  /** Children on the paper's roll. */
  total: number;
  /** Children with a mark, an absence or an exemption. */
  entered: number;
  entryStatus: "open" | "submitted";
  entryRevision: number;
  maxMarks: number;
  passMarks: number | null;
};

export type PaperStatus = "done" | "in_progress" | "not_started" | "empty";

export function paperStatus(p: Pick<PaperFacts, "total" | "entered" | "entryStatus">): PaperStatus {
  if (p.entryStatus === "submitted") return "done";
  if (p.total === 0) return "empty";
  if (p.entered === 0) return "not_started";
  return "in_progress";
}

/**
 * How much of the work should be done by today, if marks went in at an even
 * pace from the day after the exam to the due date. 0 before, 1 on the day.
 */
export function expectedShare(examEnd: string | null, dueOn: string | null, today: string): number {
  if (!dueOn) return 0;
  if (today >= dueOn) return 1;
  if (!examEnd || today <= examEnd) return 0;
  const span = dayNumber(dueOn) - dayNumber(examEnd);
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (dayNumber(today) - dayNumber(examEnd)) / span));
}

function dayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/**
 * A paper is late when it is not done and is behind the even pace — or not
 * started at all once half the time has gone. After the due date anything not
 * submitted is late.
 */
export function isLate(p: Pick<PaperFacts, "total" | "entered" | "entryStatus">, expected: number): boolean {
  const status = paperStatus(p);
  if (status === "done" || status === "empty") return false;
  if (expected >= 1) return true;
  const share = p.total === 0 ? 1 : p.entered / p.total;
  if (status === "not_started") return expected >= 0.5;
  return share + 0.25 < expected;
}

export type TeacherLoad = {
  teacherId: string;
  teacherName: string;
  papers: PaperFacts[];
  entered: number;
  total: number;
  done: number;
  late: boolean;
  notStarted: boolean;
};

/** Everyone with an unfinished paper, the late first and the furthest behind first. */
export function teacherLoads(papers: PaperFacts[], expected: number): TeacherLoad[] {
  const by = new Map<string, TeacherLoad>();
  for (const paper of papers) {
    if (!paper.teacherId) continue;
    const load = by.get(paper.teacherId) ?? {
      teacherId: paper.teacherId,
      teacherName: paper.teacherName ?? "—",
      papers: [],
      entered: 0,
      total: 0,
      done: 0,
      late: false,
      notStarted: true,
    };
    load.papers.push(paper);
    load.entered += paper.entered;
    load.total += paper.total;
    if (paperStatus(paper) === "done") load.done += 1;
    if (isLate(paper, expected)) load.late = true;
    if (paper.entered > 0 || paper.entryStatus === "submitted") load.notStarted = false;
    by.set(paper.teacherId, load);
  }
  return [...by.values()]
    .filter((load) => load.done < load.papers.length)
    .sort(
      (a, b) =>
        Number(b.late) - Number(a.late) ||
        a.entered / Math.max(1, a.total) - b.entered / Math.max(1, b.total) ||
        a.teacherName.localeCompare(b.teacherName),
    );
}

export function overall(papers: Pick<PaperFacts, "total" | "entered" | "entryStatus">[]): {
  entered: number;
  total: number;
  percent: number;
  done: number;
  papers: number;
} {
  let entered = 0;
  let total = 0;
  let done = 0;
  for (const p of papers) {
    entered += Math.min(p.entered, p.total);
    total += p.total;
    if (p.entryStatus === "submitted") done += 1;
  }
  return { entered, total, percent: total === 0 ? 0 : Math.round((entered / total) * 100), done, papers: papers.length };
}

export type ClassRow = {
  classId: string;
  classLabel: string;
  classSort: number;
  papers: PaperFacts[];
  entered: number;
  total: number;
  percent: number;
  late: number;
  allSubmitted: boolean;
};

/** The pipeline's rows: one per class, in the school's class order. */
export function classRows(papers: PaperFacts[], expected: number): ClassRow[] {
  const by = new Map<string, ClassRow>();
  for (const paper of papers) {
    const row = by.get(paper.classId) ?? {
      classId: paper.classId,
      classLabel: paper.classLabel,
      classSort: paper.classSort,
      papers: [],
      entered: 0,
      total: 0,
      percent: 0,
      late: 0,
      allSubmitted: true,
    };
    row.papers.push(paper);
    row.entered += Math.min(paper.entered, paper.total);
    row.total += paper.total;
    if (isLate(paper, expected)) row.late += 1;
    if (paper.entryStatus !== "submitted") row.allSubmitted = false;
    by.set(paper.classId, row);
  }
  return [...by.values()]
    .map((row) => ({ ...row, percent: row.total === 0 ? 0 : Math.round((row.entered / row.total) * 100) }))
    .sort((a, b) => a.classSort - b.classSort || a.classLabel.localeCompare(b.classLabel));
}

/** The grid's columns: every subject any class sits, in a stable order. */
export function subjectColumns(papers: Pick<PaperFacts, "subjectCode">[], order: Map<string, number> = new Map()): string[] {
  return [...new Set(papers.map((p) => p.subjectCode))].sort(
    (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b),
  );
}
