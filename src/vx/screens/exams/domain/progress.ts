import { p, type Pair } from "@/vx/text";

import { counts, misfits, parseMark, type Cell } from "./entry";
import { onRoll, type EnrolmentFacts } from "./tracker";

/*
 * What every marks surface counts — the teacher's Today, More and subject
 * cards, the marks sheet, the tracker and the results pipeline. One contract,
 * so a paper never reads "12 of 40" in one place and "15 of 38" in another:
 *
 *  - Eligible pupils are the paper's roster: on the roll by the exam's last
 *    day and still there when it began (`onRoll`, the same rule as
 *    `vppsone.paper_roster`, which is what `save_marks` checks against).
 *  - Saved is a persisted row for an eligible pupil that holds a value, an
 *    absence or an exemption. Zero is a valid score and is saved; a cleared
 *    cell (`value` null, neither absent nor exempt) is blank, not saved.
 *  - Blank, absent and exempt stay distinct.
 *  - A row for a pupil off the roster is never counted, either way.
 *  - An invalid row — a persisted value the paper cannot hold (more than the
 *    paper is out of, or a half on a whole-mark paper) — is still saved; it
 *    is flagged separately so readiness can refuse it, and it is never
 *    rounded or rewritten here.
 */

export type PersistedMark = { studentId: string; value: number | string | null; absent: boolean; exempt: boolean };

/** One persisted row as the sheet holds it. Exempt wins over absent, absent over a value. */
export function cellOf(row: Omit<PersistedMark, "studentId"> | undefined): Cell {
  if (!row) return { state: "blank", value: null };
  if (row.exempt) return { state: "exempt", value: null };
  if (row.absent) return { state: "absent", value: null };
  if (row.value !== null && row.value !== undefined) return { state: "value", value: Number(row.value) };
  return { state: "blank", value: null };
}

/** The pupils a paper is out of: the roster rule, in the order given. */
export function eligibleIds(enrolments: readonly EnrolmentFacts[], exam: { startsOn: string | null; endsOn: string | null }, today: string): string[] {
  return enrolments.filter((e) => onRoll(e, exam, today)).map((e) => e.studentId);
}

export type PaperCount = {
  /** Pupils on the paper's roster. */
  eligible: number;
  /** Eligible pupils with a value (zero included), an absence or an exemption. */
  saved: number;
  values: number;
  absent: number;
  exempt: number;
  blank: number;
  /** Saved values the paper cannot hold. */
  invalid: number;
  invalidIds: string[];
};

/**
 * A paper's numbers from what is persisted. Uses the marks sheet's own
 * `counts` and `misfits`, so the sheet (fed `paper_roster` and the saved
 * cells) and every summary (fed the roster rule and the marks rows) agree by
 * construction.
 */
export function countPaper(eligible: readonly string[], marks: readonly PersistedMark[], paper: { maxMarks: number; markStep: number }): PaperCount {
  const on = new Set(eligible);
  const cells: Record<string, Cell> = {};
  for (const m of marks) if (on.has(m.studentId)) cells[m.studentId] = cellOf(m);
  const order = [...on];
  const c = counts(order, cells);
  const invalidIds = misfits(order, cells, paper.maxMarks, paper.markStep);
  return { eligible: c.total, saved: c.filled, values: c.entered, absent: c.absent, exempt: c.exempt, blank: c.blank, invalid: invalidIds.length, invalidIds };
}

/**
 * Why a saved mark cannot stand on this paper, said beside it — "Needs
 * correction: 7.5 — this paper takes whole marks". The mark itself is never
 * changed here or anywhere else on the screen.
 */
export function needsCorrectionText(value: number, maxMarks: number, markStep: number): Pair {
  const parsed = parseMark(String(value), maxMarks, markStep);
  if (!parsed.ok && parsed.reason === "over") {
    return p(`Needs correction: ${value} — this paper is out of ${maxMarks}`, `सुधार चाहिए: ${value} — यह पेपर ${maxMarks} अंक का है`);
  }
  if (markStep >= 1) return p(`Needs correction: ${value} — this paper takes whole marks`, `सुधार चाहिए: ${value} — इस पेपर में सिर्फ़ पूरे अंक`);
  if (markStep === 0.5) return p(`Needs correction: ${value} — this paper takes whole or half marks`, `सुधार चाहिए: ${value} — इस पेपर में पूरे या आधे अंक`);
  return p(`Needs correction: ${value} — this paper takes marks in steps of ${markStep}`, `सुधार चाहिए: ${value} — इस पेपर में अंक ${markStep} के क्रम में`);
}

/* ------------------------------------------------------------ readiness */

export type ReadinessFacts = { total: number; entered: number; invalid?: number; entryStatus: "open" | "submitted" };

export type PaperReadiness = "needs_correction" | "missing" | "saved" | "submitted";

/**
 * Where one paper stands, from persisted marks and their validity: a mark the
 * paper cannot hold needs correction whatever else is true; then a pupil
 * without a mark; then saved but not sent; then sent.
 */
export function paperReadiness(p: ReadinessFacts): PaperReadiness {
  if ((p.invalid ?? 0) > 0) return "needs_correction";
  if (p.entered < p.total) return "missing";
  if (p.entryStatus !== "submitted") return "saved";
  return "submitted";
}

export type ClassReadiness = "needs_correction" | "missing" | "saved" | "ready_for_review";

export type ClassReadinessResult = {
  state: ClassReadiness;
  entered: number;
  total: number;
  invalid: number;
  notSubmitted: number;
  /** Every paper sent, every pupil marked, and no mark the paper cannot hold. */
  readyToLock: boolean;
};

/** A class from its papers. "Ready to lock" is never just "every paper sent". */
export function classReadiness(papers: readonly ReadinessFacts[]): ClassReadinessResult {
  let entered = 0;
  let total = 0;
  let invalid = 0;
  let notSubmitted = 0;
  const states = new Set<PaperReadiness>();
  for (const paper of papers) {
    entered += Math.min(paper.entered, paper.total);
    total += paper.total;
    invalid += paper.invalid ?? 0;
    if (paper.entryStatus !== "submitted") notSubmitted += 1;
    states.add(paperReadiness(paper));
  }
  const state: ClassReadiness = states.has("needs_correction") ? "needs_correction" : states.has("missing") ? "missing" : states.has("saved") ? "saved" : "ready_for_review";
  return { state, entered, total, invalid, notSubmitted, readyToLock: papers.length > 0 && state === "ready_for_review" };
}

/** "12 marks · 2 absent · 0 excused · 0 blank": what a paper's entered count is made of. */
export function paperMix(c: { marks: number; absent: number; exempt: number; blank: number }): Pair {
  return p(
    `${c.marks} marks · ${c.absent} absent · ${c.exempt} excused · ${c.blank} blank`,
    `${c.marks} अंक · ${c.absent} अनुपस्थित · ${c.exempt} को छूट · ${c.blank} खाली`,
  );
}

export type PaperBlocker = { paperId: string; subjectCode: string; reason: "needs_correction" | "missing" | "not_sent"; count: number };

/**
 * The papers that keep a class's report cards from being ready, and why: a
 * mark to correct (how many), children with no mark (how many), or not sent.
 * A card is "Ready" only when this is empty — never over a blank, an invalid
 * mark or an unsent paper (smoke 20 Oct: Class 9 said "14/14 ready" while
 * its Science paper was not sent and had two marks to correct).
 */
export function paperBlockers(papers: readonly (ReadinessFacts & { paperId: string; subjectCode: string })[]): PaperBlocker[] {
  const out: PaperBlocker[] = [];
  for (const paper of papers) {
    const state = paperReadiness(paper);
    if (state === "needs_correction") out.push({ paperId: paper.paperId, subjectCode: paper.subjectCode, reason: "needs_correction", count: paper.invalid ?? 0 });
    else if (state === "missing") out.push({ paperId: paper.paperId, subjectCode: paper.subjectCode, reason: "missing", count: paper.total - paper.entered });
    else if (state === "saved") out.push({ paperId: paper.paperId, subjectCode: paper.subjectCode, reason: "not_sent", count: 0 });
  }
  return out;
}

export const READINESS_LABEL: Record<PaperReadiness | ClassReadiness, Pair> = {
  needs_correction: p("Needs correction", "सुधार चाहिए"),
  missing: p("Missing marks", "अंक बाकी"),
  saved: p("Saved, not submitted", "सहेजे, जमा नहीं"),
  submitted: p("Submitted", "जमा"),
  ready_for_review: p("Ready for review", "जाँच के लिए तैयार"),
};

export type LockPaper = ReadinessFacts & { classLabel: string; subjectCode: string };

export type LockRefusal = { reason: "needs_correction" | "missing" | "not_submitted"; papers: string[] };

/**
 * Why classes may not be locked yet, or null when they may. The server's lock
 * action and the screens' "Ready to lock" use this one check, so a class the
 * board offers is a class the server accepts.
 */
export function lockRefusal(papers: readonly LockPaper[]): LockRefusal | null {
  const name = (x: LockPaper) => `${x.classLabel} ${x.subjectCode}`;
  const invalid = papers.filter((x) => (x.invalid ?? 0) > 0);
  if (invalid.length) return { reason: "needs_correction", papers: invalid.map((x) => `${name(x)} (${x.invalid})`) };
  const missing = papers.filter((x) => x.entered < x.total);
  if (missing.length) return { reason: "missing", papers: missing.map((x) => `${name(x)} (${x.entered}/${x.total})`) };
  const unsent = papers.filter((x) => x.entryStatus !== "submitted");
  if (unsent.length) return { reason: "not_submitted", papers: unsent.map(name) };
  return null;
}

/** The words for a refusal, naming at most `limit` papers. */
export function lockRefusalText(refusal: LockRefusal, limit = 6): Pair {
  const list = [...new Set(refusal.papers)].slice(0, limit).join(", ");
  const more = refusal.papers.length > limit ? ` +${refusal.papers.length - limit}` : "";
  if (refusal.reason === "needs_correction") return p(`Some marks need correction before locking: ${list}${more}`, `बंद करने से पहले कुछ अंक सुधारने हैं: ${list}${more}`);
  if (refusal.reason === "missing") return p(`Some marks are missing: ${list}${more}`, `कुछ अंक बाकी हैं: ${list}${more}`);
  return p(`Some papers are not submitted yet: ${list}${more}`, `कुछ पेपर अभी जमा नहीं: ${list}${more}`);
}

/** The tracker's line when a paper has no other activity to show. */
export function progressLine(entered: number, total: number): Pair {
  if (entered <= 0) return p("No marks yet", "अभी कोई अंक नहीं");
  return p(`Marks being entered (${entered} of ${total} saved)`, `अंक भरे जा रहे हैं (${total} में से ${entered} सहेजे)`);
}
