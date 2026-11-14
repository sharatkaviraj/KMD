import type { ReportCard, ReportRow } from "@/modules/assessments/domain/report-card";

/**
 * What a report card shows beyond the marks (D-612): each subject beside the
 * class, and the child's effort and growth across the term's exams.
 *
 * **Effort is measured against the class, not against the raw marks.** Test I
 * is out of 20 and the Half Yearly out of 60, and one paper is harder than
 * another, so "72% then 65%" says little on its own. What it does say is how
 * far the child stood above or below the class average in each exam. The
 * change in that gap from the first exam of the term to the last is the
 * child's growth: a child who was 10 points under the class in Test I and 2
 * over it in the Half Yearly grew by 12, whatever the papers were like.
 *
 *  - up: the gap grew by 5 points or more (rising, बढ़त);
 *  - down: it fell by 5 points or more (slipping, गिरावट);
 *  - steady: within 5 points either way (बराबर).
 *
 * A subject needs two exams with a mark to be measured at all; one missed
 * paper is left out, never counted as nought.
 *
 * Built where the class's cards are built (`reports-repo.ts`) and stored on
 * the card like every other figure, so an issued card keeps the class
 * averages it was issued with. Pure.
 */

export type ExamPoint = {
  code: string;
  en: string;
  hi: string;
  /** The child's share of this paper, 0–100, one decimal; null when not sat. */
  percent: number | null;
  /** The class's average share of this paper (children who sat it). */
  classAvg: number | null;
};

export type Trend = "up" | "steady" | "down";

export type SubjectInsight = {
  subjectCode: string;
  /** The child's share over the papers sat in this subject; null when none were. */
  percent: number | null;
  /** The class's average share in this subject. */
  classAvg: number | null;
  /** The best share in the class in this subject. */
  classTop: number | null;
  /** Each exam of the term, in the order sat. */
  exams: ExamPoint[];
  /** Points gained or lost against the class average, first exam to last; null when not measurable. */
  growth: number | null;
  trend: Trend | null;
};

export type CardInsight = {
  version: 1;
  subjects: SubjectInsight[];
  /** The term's exams overall: the child's share of every paper sat in each, beside the class. */
  journey: ExamPoint[];
  /** Overall growth against the class, first exam to last. */
  growth: number | null;
  trend: Trend | null;
  /** Subjects measured, and how many went each way. */
  effort: { measured: number; up: number; steady: number; down: number };
  /** Up to two subjects the child does best in (codes). */
  strengths: string[];
  /** Up to two subjects that most need practice (codes). */
  focus: string[];
  /** Children whose marks made the class averages. */
  classSize: number;
};

/** Points of growth against the class that count as a real move, not noise. */
export const TREND_POINTS = 5;

const round1 = (value: number) => Math.round(value * 10) / 10;

type Cell = { value: number; max: number };

/** The child's mark on one exam of one row, when they sat it with a number. */
function cellOf(row: ReportRow, code: string): Cell | null {
  const m = row.marks.find((x) => x.assessmentCode === code);
  if (!m || m.exempt || m.absent || m.value === null || m.maxMarks <= 0) return null;
  return { value: m.value, max: m.maxMarks };
}

const share = (cells: Cell[]) => {
  const max = cells.reduce((s, c) => s + c.max, 0);
  return max > 0 ? (cells.reduce((s, c) => s + c.value, 0) / max) * 100 : null;
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function trendOf(growth: number | null): Trend | null {
  if (growth === null) return null;
  if (growth >= TREND_POINTS) return "up";
  if (growth <= -TREND_POINTS) return "down";
  return "steady";
}

/** The term's exams in the order the card prints them. */
function examColumns(cards: readonly Pick<ReportCard, "rows">[]): { code: string; en: string; hi: string }[] {
  const seen = new Map<string, { code: string; en: string; hi: string }>();
  for (const card of cards)
    for (const row of card.rows)
      for (const m of row.marks) if (m.assessmentCode && !seen.has(m.assessmentCode)) seen.set(m.assessmentCode, { code: m.assessmentCode, en: m.assessmentLabelEn, hi: m.assessmentLabelHi });
  return [...seen.values()];
}

/** The gap to the class at the last measured exam, less the gap at the first. */
function growthOf(points: ExamPoint[]): number | null {
  const gaps = points.filter((p) => p.percent !== null && p.classAvg !== null).map((p) => (p.percent as number) - (p.classAvg as number));
  if (gaps.length < 2) return null;
  return round1(gaps[gaps.length - 1] - gaps[0]);
}

/**
 * One child's insight, beside the rest of the class. `cards` is the whole
 * class including this child; subjects printed apart (Robotics) are not in
 * `rows`, so they are not in any figure here either.
 */
export function cardInsight(card: Pick<ReportCard, "studentId" | "rows">, cards: readonly Pick<ReportCard, "studentId" | "rows">[]): CardInsight {
  const columns = examColumns(cards.length ? cards : [card]);
  const classSize = cards.filter((c) => c.rows.some((row) => columns.some((col) => cellOf(row, col.code)))).length;

  const subjects: SubjectInsight[] = card.rows.map((row) => {
    const classRows = cards.map((c) => c.rows.find((r) => r.subjectCode === row.subjectCode)).filter((r): r is ReportRow => Boolean(r));
    const exams: ExamPoint[] = columns
      .filter((col) => row.marks.some((m) => m.assessmentCode === col.code))
      .map((col) => {
        const mine = cellOf(row, col.code);
        const others = classRows.map((r) => cellOf(r, col.code)).filter((c): c is Cell => c !== null);
        const avg = mean(others.map((c) => (c.value / c.max) * 100));
        return { ...col, percent: mine ? round1((mine.value / mine.max) * 100) : null, classAvg: avg === null ? null : round1(avg) };
      });
    const mineAll = share(columns.map((col) => cellOf(row, col.code)).filter((c): c is Cell => c !== null));
    const classShares = classRows.map((r) => share(columns.map((col) => cellOf(r, col.code)).filter((c): c is Cell => c !== null))).filter((v): v is number => v !== null);
    const growth = growthOf(exams);
    return {
      subjectCode: row.subjectCode,
      percent: mineAll === null ? null : round1(mineAll),
      classAvg: classShares.length ? round1(mean(classShares) as number) : null,
      classTop: classShares.length ? round1(Math.max(...classShares)) : null,
      exams,
      growth,
      trend: trendOf(growth),
    };
  });

  // The term overall, exam by exam: every counted paper the child sat in it.
  const examShare = (c: Pick<ReportCard, "rows">, code: string) => share(c.rows.map((r) => cellOf(r, code)).filter((x): x is Cell => x !== null));
  const journey: ExamPoint[] = columns.map((col) => {
    const mine = examShare(card, col.code);
    const avg = mean(cards.map((c) => examShare(c, col.code)).filter((v): v is number => v !== null));
    return { ...col, percent: mine === null ? null : round1(mine), classAvg: avg === null ? null : round1(avg) };
  });
  const growth = growthOf(journey);

  const measured = subjects.filter((s) => s.trend !== null);
  const scored = subjects.filter((s) => s.percent !== null) as (SubjectInsight & { percent: number })[];
  // Best by the child's own share; a tie goes to the one further above the class.
  const lead = (s: SubjectInsight) => (s.percent ?? 0) - (s.classAvg ?? s.percent ?? 0);
  const best = [...scored].sort((a, b) => b.percent - a.percent || lead(b) - lead(a));
  const strengths = scored.length >= 3 ? best.filter((s) => s.percent >= 60).slice(0, 2).map((s) => s.subjectCode) : [];
  // Practice: well under the class, or under 40%, lowest first; never one already named a strength.
  const focus = [...scored]
    .filter((s) => !strengths.includes(s.subjectCode) && (s.percent < 40 || (s.classAvg !== null && s.percent <= s.classAvg - TREND_POINTS)))
    .sort((a, b) => a.percent - b.percent)
    .slice(0, 2)
    .map((s) => s.subjectCode);

  return {
    version: 1,
    subjects,
    journey,
    growth,
    trend: trendOf(growth),
    effort: {
      measured: measured.length,
      up: measured.filter((s) => s.trend === "up").length,
      steady: measured.filter((s) => s.trend === "steady").length,
      down: measured.filter((s) => s.trend === "down").length,
    },
    strengths,
    focus,
    classSize,
  };
}

/** Every card of a class with its insight, the class being those cards. */
export function withInsights<C extends Pick<ReportCard, "studentId" | "rows">>(cards: readonly C[]): (C & { insight: CardInsight })[] {
  return cards.map((card) => ({ ...card, insight: cardInsight(card, cards) }));
}
