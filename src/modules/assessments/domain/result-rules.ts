import type { GradeBandRule } from "@/modules/assessments/domain/report-scheme";

/**
 * The school's result rules, one set per class group (D-611).
 *
 * Read off the school's own Half Yearly 2026-27 Result Register (Nursery to
 * Class 8) and the owner's answers of 14 Nov 2026, and checked against every
 * row of that register: these floors give the grade it printed for all 375
 * children with a result, and ranking by percentage with ties sharing a place
 * gives every rank it printed.
 *
 *  - **Nursery, JKG, SKG**: word grades (Outstanding 96%+, Excellent 90–95,
 *    Very Good 80–89, Good 70–79, Growing below 70), one decimal, no pass or
 *    fail and no rank.
 *  - **Classes 1–4, 6, 7**: A1 to E, two decimals, 33% in every subject
 *    ("33% is enough as per Rajasthan Board guidelines"), rank in class.
 *  - **Classes 5 and 8, the board classes**: graded and ranked the same way,
 *    but the board declares the result, so a school card never says Pass or
 *    Not passed for them. A subject under 33% is still shown as needing
 *    support, because the school watches these records to help the child.
 *  - **Classes 9–12**: the Rajasthan Board's pattern: 33% in every subject and
 *    a division (First 60%+, Second 45%+, Third 33%+). Not yet confirmed
 *    against a register of the school's own.
 *
 * Everywhere:
 *  - **Robotics is shown apart**: printed on the card but kept out of the
 *    total, the percentage, the result and the rank, as the register prints it.
 *  - **A missing paper makes the result pending.** The register's note: "one or
 *    more papers missing; the % and rank are left blank until the marks are
 *    complete". An "A" on the register is such a paper, so an absence is no
 *    longer a nought on these cards (D-319 still holds for a class with no
 *    rule). A child absent from every paper reads "Absent".
 *
 * Pure, and kept in code rather than on the term's scheme: these are the
 * school's standing rules, and every card copies the rule it was worked out by
 * (`CardRule`), so a later change never moves a card already handed out.
 */

export type ResultRuleKey = "pre_primary" | "primary" | "board" | "senior";

export type ResultRule = {
  key: ResultRuleKey;
  name: { en: string; hi: string };
  /** The rule's own grade bands; null means the term's scheme (or the default A1–E). */
  bands: GradeBandRule[] | null;
  /** Decimals the percentage is printed and graded at. */
  percentDecimals: number;
  /** Every subject must reach this share of its own total; null: no pass or fail. */
  subjectPassPercent: number | null;
  /** Whether the card says Pass / Not passed. False for the board classes. */
  verdict: boolean;
  /** Whether a child is ranked in the class. */
  rank: boolean;
  /** Subjects printed apart and kept out of every figure (lower case). */
  apart: string[];
  /** Whether the card names a division (Rajasthan Board, 9–12). */
  division: boolean;
};

/** The copy a card keeps of the rule it was worked out by. */
export type CardRule = Pick<ResultRule, "key" | "name" | "percentDecimals" | "subjectPassPercent" | "verdict" | "rank" | "apart" | "division">;

/** Nursery to SKG, from the register's legend. */
export const WORD_BANDS: GradeBandRule[] = [
  { from: 96, label: "Outstanding", en: "Outstanding", hi: "उत्कृष्ट" },
  { from: 90, label: "Excellent", en: "Excellent", hi: "श्रेष्ठ" },
  { from: 80, label: "Very Good", en: "Very good", hi: "बहुत अच्छा" },
  { from: 70, label: "Good", en: "Good", hi: "अच्छा" },
  { from: 0, label: "Growing", en: "Growing", hi: "बढ़ रहा है" },
];

/** Classes 1–8, from the register's legend: A1 91–100 … D 33–40, E below 33. */
export const LETTER_BANDS: GradeBandRule[] = [
  { from: 91, label: "A1", en: "Outstanding", hi: "उत्कृष्ट" },
  { from: 81, label: "A2", en: "Excellent", hi: "बहुत अच्छा" },
  { from: 71, label: "B1", en: "Very good", hi: "अच्छा" },
  { from: 61, label: "B2", en: "Good", hi: "संतोषजनक" },
  { from: 51, label: "C1", en: "Fair", hi: "ठीक" },
  { from: 41, label: "C2", en: "Needs improvement", hi: "सुधार आवश्यक" },
  { from: 33, label: "D", en: "Just passing", hi: "न्यूनतम" },
  { from: 0, label: "E", en: "Needs much more work", hi: "पुनः प्रयास" },
];

/** Subjects every group prints apart from the total. */
export const APART_SUBJECTS = ["robotics"];

export const RESULT_RULES: Record<ResultRuleKey, ResultRule> = {
  pre_primary: {
    key: "pre_primary",
    name: { en: "Nursery to SKG: word grades, no pass or fail", hi: "नर्सरी से SKG: शब्दों में ग्रेड, पास-फ़ेल नहीं" },
    bands: WORD_BANDS,
    percentDecimals: 1,
    subjectPassPercent: null,
    verdict: false,
    rank: false,
    apart: APART_SUBJECTS,
    division: false,
  },
  primary: {
    key: "primary",
    name: { en: "Classes 1–4, 6, 7: A1 to E, 33% in every subject, rank", hi: "कक्षा 1–4, 6, 7: A1 से E, हर विषय में 33%, स्थान" },
    bands: null,
    percentDecimals: 2,
    subjectPassPercent: 33,
    verdict: true,
    rank: true,
    apart: APART_SUBJECTS,
    division: false,
  },
  board: {
    key: "board",
    name: { en: "Classes 5 and 8: board class, the board declares the result", hi: "कक्षा 5 और 8: बोर्ड कक्षा, परिणाम बोर्ड देगा" },
    bands: null,
    percentDecimals: 2,
    subjectPassPercent: 33,
    verdict: false,
    rank: true,
    apart: APART_SUBJECTS,
    division: false,
  },
  senior: {
    key: "senior",
    name: { en: "Classes 9–12: Rajasthan Board, 33% in every subject, division", hi: "कक्षा 9–12: राजस्थान बोर्ड, हर विषय में 33%, श्रेणी" },
    bands: null,
    percentDecimals: 2,
    subjectPassPercent: 33,
    verdict: true,
    rank: true,
    apart: APART_SUBJECTS,
    division: true,
  },
};

const PRE_PRIMARY = /^(nursery|lkg|ukg|jkg|skg|kg|pre|play)/i;

/**
 * The rule for a class, from its name: "Nursery", "Class 5", "11 Science".
 * A class whose name says neither (a test class) has none, and its card is
 * worked out as before.
 */
export function ruleForClass(classLabel: string): ResultRule | null {
  const name = classLabel.trim();
  if (PRE_PRIMARY.test(name)) return RESULT_RULES.pre_primary;
  const n = Number(name.match(/(\d{1,2})/)?.[1] ?? NaN);
  if (!Number.isFinite(n) || n < 1 || n > 12) return null;
  if (n === 5 || n === 8) return RESULT_RULES.board;
  if (n >= 9) return RESULT_RULES.senior;
  return RESULT_RULES.primary;
}

export function cardRuleOf(rule: ResultRule): CardRule {
  const { key, name, percentDecimals, subjectPassPercent, verdict, rank, apart, division } = rule;
  return { key, name, percentDecimals, subjectPassPercent, verdict, rank, apart: [...apart], division };
}

export function isApart(rule: Pick<ResultRule, "apart"> | null | undefined, subjectCode: string): boolean {
  return Boolean(rule?.apart.includes(subjectCode.trim().toLowerCase()));
}

/* ------------------------------------------------------------- division */

export type Division = { key: "first" | "second" | "third"; en: string; hi: string };

/** The Rajasthan Board's divisions: First 60%+, Second 45%+, Third 33%+. */
export function divisionFor(percent: number | null): Division | null {
  if (percent === null) return null;
  if (percent >= 60) return { key: "first", en: "First division", hi: "प्रथम श्रेणी" };
  if (percent >= 45) return { key: "second", en: "Second division", hi: "द्वितीय श्रेणी" };
  if (percent >= 33) return { key: "third", en: "Third division", hi: "तृतीय श्रेणी" };
  return null;
}

/* ----------------------------------------------------------------- rank */

export type Rankable = { id: string; percent: number | null; ranked: boolean };

/**
 * Places in class by percentage, highest first, ties sharing a place and the
 * next place skipped (1, 1, 3), the way the register ranks. A child whose
 * result is pending, or whose class is not ranked, has no place and is not
 * counted in "of".
 */
export function classRanks(children: readonly Rankable[]): Map<string, { rank: number; of: number }> {
  const ranked = children.filter((c) => c.ranked && c.percent !== null) as (Rankable & { percent: number })[];
  const out = new Map<string, { rank: number; of: number }>();
  for (const child of ranked) {
    const above = ranked.filter((o) => o.percent > child.percent).length;
    out.set(child.id, { rank: above + 1, of: ranked.length });
  }
  return out;
}

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
