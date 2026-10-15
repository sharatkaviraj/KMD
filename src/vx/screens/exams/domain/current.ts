/*
 * Which exam a screen should talk about. Pure, so the exam office, the
 * results pipeline, the marks tracker, the coordinator's home and a teacher's
 * marks tab all pick the same one — and so the rule is pinned by a test.
 *
 * Never by its label (CLAUDE.md rule 3a): "QA results" and
 * "phoneops-20261011-marks" are real rows on dev and would win any sort. And
 * never an exam without dates: an undated exam has not "begun", it has simply
 * not been planned, and it used to hijack the exam office's dashboard because
 * `!startsOn` was read as "started long ago" (coordinators B2).
 *
 * Dates are ISO `YYYY-MM-DD`, so comparing them as strings is comparing days.
 */

export type ExamLike = {
  id: string;
  startsOn: string | null;
  status: string;
  /** How many papers the exam has; unknown (undefined) counts as some. */
  papers?: number;
  plan?: { marksDueOn: string | null } | null;
};

const hasPapers = (e: ExamLike) => e.papers === undefined || e.papers > 0;
const dated = (e: ExamLike): e is ExamLike & { startsOn: string } => typeof e.startsOn === "string" && e.startsOn.length > 0;
const byStart = (a: ExamLike, b: ExamLike) => (a.startsOn ?? "").localeCompare(b.startsOn ?? "");

/**
 * The exam whose marks are being worked on today:
 *
 * 1. the open exam with papers that began most recently (dated, on or before today);
 * 2. else the dated exam with papers that began most recently, whatever its state;
 * 3. else the next dated exam with papers;
 * 4. else an undated exam with papers — only when there is nothing better.
 *
 * A `requested` id that names one of the exams always wins.
 */
export function pickCurrentExam<E extends ExamLike>(exams: E[], today: string, requested?: string | null): E | null {
  if (requested) {
    const asked = exams.find((e) => e.id === requested);
    if (asked) return asked;
  }
  const live = exams.filter((e) => e.status !== "draft" && hasPapers(e));
  const begun = live.filter((e) => dated(e) && e.startsOn <= today).sort(byStart);
  const open = begun.filter((e) => e.status === "open");
  if (open.length) return open[open.length - 1];
  if (begun.length) return begun[begun.length - 1];
  const upcoming = live.filter((e) => dated(e) && e.startsOn > today).sort(byStart);
  if (upcoming.length) return upcoming[0];
  if (live.length) return live[0];
  return exams.filter(dated).sort(byStart).at(-1) ?? exams[0] ?? null;
}

/**
 * Every exam a teacher may still be entering marks for — each open exam with
 * papers, not just "the current" one: overdue ones first (the earliest due
 * first), then the ones that have begun, then those still to come, and undated
 * ones last. Exported for the teacher's marks tab.
 */
export function openExamsForMarks<E extends ExamLike>(exams: E[], today: string): E[] {
  const rank = (e: E) => {
    const due = e.plan?.marksDueOn ?? null;
    if (due && due < today) return 0;
    if (!dated(e)) return 3;
    return e.startsOn <= today ? 1 : 2;
  };
  return exams
    .filter((e) => e.status === "open" && hasPapers(e))
    .map((e, i) => ({ e, i, r: rank(e) }))
    .sort(
      (a, b) =>
        a.r - b.r ||
        (a.e.plan?.marksDueOn ?? "9999-12-31").localeCompare(b.e.plan?.marksDueOn ?? "9999-12-31") ||
        (a.e.startsOn ?? "9999-12-31").localeCompare(b.e.startsOn ?? "9999-12-31") ||
        a.i - b.i,
    )
    .map((x) => x.e);
}
