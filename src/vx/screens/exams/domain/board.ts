import { byClassLabel } from "@/modules/academics/domain/class-order";
import { groupOf, NOT_A_PAPER, type GroupKey } from "./groups";
import { isLate, type PaperFacts } from "./tracker";

/*
 * The marks tracker's pure parts: what colour a class × subject cell is,
 * how many cells are in each state, which papers a new exam gets from the
 * timetable, and where a report-card preview goes next.
 */

export type CellState = "locked" | "done" | "in_progress" | "not_started" | "empty";

/**
 * A cell's state. A class whose marks are locked shows a padlock on every
 * paper; a sent paper is done; anything typed is in progress; nothing typed
 * is not started. A class with nobody on the roll has nothing to enter.
 */
export function cellState(paper: Pick<PaperFacts, "total" | "entered" | "entryStatus">, classLocked: boolean): CellState {
  if (classLocked) return "locked";
  if (paper.entryStatus === "submitted") return "done";
  if (paper.total === 0) return "empty";
  if (paper.entered > 0) return "in_progress";
  return "not_started";
}

export type CellCounts = Record<CellState, number> & { late: number; all: number };

export function cellCounts(papers: PaperFacts[], lockedClasses: ReadonlySet<string>, expected: number): CellCounts {
  const out: CellCounts = { locked: 0, done: 0, in_progress: 0, not_started: 0, empty: 0, late: 0, all: papers.length };
  for (const paper of papers) {
    const state = cellState(paper, lockedClasses.has(paper.classId));
    out[state] += 1;
    if ((state === "in_progress" || state === "not_started") && isLate(paper, expected)) out.late += 1;
  }
  return out;
}

export type CellFilter = "all" | "not_started" | "in_progress" | "done" | "locked" | "late";

export function cellMatches(filter: CellFilter, state: CellState, late: boolean): boolean {
  if (filter === "all") return true;
  if (filter === "late") return late && (state === "in_progress" || state === "not_started");
  return state === filter;
}

export type PlannedPaper = { classId: string; classLabel: string; subjectId: string; subjectCode: string; maxMarks: number; passMarks: number; sortOrder: number };

/**
 * The papers a new exam starts with: one per class-subject the timetable
 * assigns a teacher to, leaving out what is not a written paper (sports,
 * notebook checking…) and classes that belong to no band. The maximum is
 * the exam's, per band; the pass mark is a third of it, rounded up.
 */
export function papersToCreate(input: {
  assignments: { classId: string; subjectId: string }[];
  classes: { id: string; label: string; sort: number }[];
  subjects: { id: string; code: string; sortOrder: number; isActive: boolean }[];
  maxFor: (group: GroupKey) => number;
}): PlannedPaper[] {
  const classOf = new Map(input.classes.map((c) => [c.id, c]));
  const subjectOf = new Map(input.subjects.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const byClass = new Map<string, { subjectId: string; code: string; sort: number }[]>();
  for (const a of input.assignments) {
    const key = `${a.classId}|${a.subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const klass = classOf.get(a.classId);
    const subject = subjectOf.get(a.subjectId);
    if (!klass || !subject || !subject.isActive || NOT_A_PAPER.has(subject.code)) continue;
    if (!groupOf(klass.label)) continue;
    byClass.set(a.classId, [...(byClass.get(a.classId) ?? []), { subjectId: subject.id, code: subject.code, sort: subject.sortOrder }]);
  }
  const out: PlannedPaper[] = [];
  const classIds = [...byClass.keys()].sort((a, b) => (classOf.get(a)!.sort - classOf.get(b)!.sort) || byClassLabel(classOf.get(a)!.label, classOf.get(b)!.label));
  for (const classId of classIds) {
    const klass = classOf.get(classId)!;
    const max = input.maxFor(groupOf(klass.label)!);
    byClass
      .get(classId)!
      .sort((a, b) => a.sort - b.sort || a.code.localeCompare(b.code))
      .forEach((s, i) => out.push({ classId, classLabel: klass.label, subjectId: s.subjectId, subjectCode: s.code, maxMarks: max, passMarks: Math.ceil(max * 0.33), sortOrder: i }));
  }
  return out;
}

/** The child before and after this one in roll order, for the preview's arrows. */
export function neighbours<T>(list: T[], index: number): { prev: T | null; next: T | null; position: number; of: number } {
  if (index < 0 || index >= list.length) return { prev: null, next: null, position: 0, of: list.length };
  return { prev: index > 0 ? list[index - 1] : null, next: index < list.length - 1 ? list[index + 1] : null, position: index + 1, of: list.length };
}

/** A short exam code from its English name: "Unit Test 3" → "UT3", "Half-yearly" → "HY". */
export function codeFor(name: string): string {
  const words = name.trim().split(/[\s-]+/).filter(Boolean);
  const code = words.map((w) => (/^\d+$/.test(w) ? w : w[0]!.toUpperCase())).join("");
  return code.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "EXAM";
}
