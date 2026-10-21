/*
 * The results pipeline's arithmetic: averages that moved too much, who can
 * pass with a little grace, and the six steps from marks to parents.
 */

export type MarkLike = { value: number | null; absent: boolean; exempt: boolean };

/** A paper's class average as a percentage of its maximum; absent and exempt are left out. */
export function averagePct(marks: MarkLike[], maxMarks: number): number | null {
  const values = marks.filter((m) => !m.absent && !m.exempt && m.value !== null).map((m) => m.value as number);
  if (values.length === 0 || maxMarks <= 0) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return Math.round((sum / values.length / maxMarks) * 1000) / 10;
}

export type PaperAverage = {
  paperId: string;
  classId: string;
  classLabel: string;
  subjectCode: string;
  avgPct: number | null;
  /** The same class's average in the same subject in the exam before, when there was one. */
  prevPct: number | null;
};

export type Unusual = PaperAverage & {
  baseline: number;
  delta: number;
  basis: "previous" | "school";
};

/**
 * Averages a coordinator should look at before locking: ones that moved by
 * `threshold` points or more since the last exam, or — where there was no last
 * exam — that sit that far from the same subject's average across the school.
 */
export function unusualAverages(papers: PaperAverage[], threshold = 15): Unusual[] {
  const bySubject = new Map<string, PaperAverage[]>();
  for (const paper of papers) bySubject.set(paper.subjectCode, [...(bySubject.get(paper.subjectCode) ?? []), paper]);

  const found: Unusual[] = [];
  for (const paper of papers) {
    if (paper.avgPct === null) continue;
    let baseline: number | null = null;
    let basis: Unusual["basis"] = "previous";
    if (paper.prevPct !== null) {
      baseline = paper.prevPct;
    } else {
      const others = (bySubject.get(paper.subjectCode) ?? []).filter((o) => o.paperId !== paper.paperId && o.avgPct !== null);
      if (others.length >= 2) {
        baseline = Math.round((others.reduce((a, o) => a + (o.avgPct as number), 0) / others.length) * 10) / 10;
        basis = "school";
      }
    }
    if (baseline === null) continue;
    const delta = Math.round((paper.avgPct - baseline) * 10) / 10;
    if (Math.abs(delta) >= threshold) found.push({ ...paper, baseline, delta, basis });
  }
  return found.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

export type StudentPaper = {
  paperId: string;
  subjectCode: string;
  value: number | null;
  absent: boolean;
  exempt: boolean;
  passMarks: number | null;
  maxMarks: number;
};

export type GraceRule = { maxPerPaper: number; maxSubjects: number };

export type GraceNeed = { paperId: string; subjectCode: string; value: number; passMarks: number; grace: number };

export type GraceVerdict = {
  studentId: string;
  needs: GraceNeed[];
  total: number;
  /** True when grace within the rule passes every failed paper. */
  canPass: boolean;
};

/**
 * Who failed a paper, and whether the school's grace rule carries them
 * through. Grace is for a mark that is short; a child who was absent is not
 * short of anything and is never offered grace.
 */
export function graceVerdict(studentId: string, papers: StudentPaper[], rule: GraceRule): GraceVerdict | null {
  const needs: GraceNeed[] = [];
  let unreachable = false;
  for (const paper of papers) {
    if (paper.passMarks === null || paper.exempt) continue;
    if (paper.absent || paper.value === null) {
      if (paper.absent) unreachable = true;
      continue;
    }
    if (paper.value >= paper.passMarks) continue;
    const grace = Math.round((paper.passMarks - paper.value) * 10) / 10;
    needs.push({ paperId: paper.paperId, subjectCode: paper.subjectCode, value: paper.value, passMarks: paper.passMarks, grace });
  }
  if (needs.length === 0) return null;
  const total = needs.reduce((a, n) => a + n.grace, 0);
  const canPass =
    !unreachable &&
    needs.length <= rule.maxSubjects &&
    needs.every((n) => n.grace <= rule.maxPerPaper);
  return { studentId, needs, total: Math.round(total * 10) / 10, canPass };
}

/**
 * A way to tell two children apart when they share a name in one group (a
 * class): "SR 1042", else the father's name. Only for the repeated names —
 * everybody else's line stays as it was (smoke 20 Oct: two "Arjun Jaanch,
 * Class 5" on the Grace list, one short 6 and one short 47).
 */
export function sameNameHints(children: { id: string; group: string; name: string; sr: string | null; father: string | null }[]): Map<string, string> {
  const count = new Map<string, number>();
  const key = (c: { group: string; name: string }) => `${c.group}|${c.name.trim().toLowerCase()}`;
  for (const c of children) count.set(key(c), (count.get(key(c)) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const c of children) {
    if ((count.get(key(c)) ?? 0) < 2) continue;
    const hint = c.sr ? `SR ${c.sr}` : c.father ? c.father : null;
    if (hint) out.set(c.id, hint);
  }
  return out;
}

export type ResultsDay ="none" | "upcoming" | "today" | "passed" | "published";

/**
 * Where results day stands: past it with results not sent is "passed", and
 * every screen must say so rather than keep showing the date as if it were
 * still to come (smoke 20 Oct: a green "Results day Sat 17 Oct" on the 20th).
 */
export function resultsDay(daysToResults: number | null, publishedAt: string | null): ResultsDay {
  if (publishedAt) return "published";
  if (daysToResults === null) return "none";
  if (daysToResults < 0) return "passed";
  return daysToResults === 0 ? "today" : "upcoming";
}

export type PipelineStep ="entered" | "checked" | "grace" | "locked" | "cards" | "published";

export type StepState = "done" | "active" | "can_start" | "waiting";

/**
 * Where each of the six steps stands. A step can start once the one before
 * has begun; it is done when its own count is complete.
 */
export function pipelineStates(input: {
  enteredPct: number;
  unusualOpen: number;
  /** Saved marks their paper cannot hold; "Checked" is not done while any remain (B04). */
  invalid?: number;
  graceOpen: number;
  lockedClasses: number;
  totalClasses: number;
  cardsIssued: number;
  cardsDue: number;
  published: boolean;
}): Record<PipelineStep, StepState> {
  const entered: StepState = input.enteredPct >= 100 ? "done" : "active";
  const checked: StepState = input.unusualOpen === 0 && (input.invalid ?? 0) === 0 && input.enteredPct >= 100 ? "done" : input.enteredPct > 0 ? "can_start" : "waiting";
  const grace: StepState = input.graceOpen === 0 && input.enteredPct >= 100 ? "done" : input.enteredPct > 0 ? "can_start" : "waiting";
  const locked: StepState =
    input.totalClasses > 0 && input.lockedClasses >= input.totalClasses ? "done" : input.lockedClasses > 0 || input.enteredPct > 0 ? "can_start" : "waiting";
  const cards: StepState =
    input.cardsDue > 0 && input.cardsIssued >= input.cardsDue ? "done" : input.lockedClasses > 0 ? "can_start" : "waiting";
  const published: StepState = input.published ? "done" : cards === "done" ? "can_start" : "waiting";
  const states: Record<PipelineStep, StepState> = { entered, checked, grace, locked, cards, published };
  // The first unfinished step is the one in progress.
  const order: PipelineStep[] = ["entered", "checked", "grace", "locked", "cards", "published"];
  const first = order.find((k) => states[k] !== "done");
  if (first && states[first] !== "waiting") states[first] = "active";
  return states;
}
