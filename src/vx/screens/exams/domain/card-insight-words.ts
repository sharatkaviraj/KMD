import type { CardInsight, ExamPoint, Trend } from "@/modules/assessments/domain/card-insight";

import { subjectPair } from "./groups";

/*
 * The lines a report card prints about effort and the subjects (D-612). Both
 * languages print on every copy, so each returns the English and the Hindi
 * half. The Hindi is written so it never needs the child's gender: it names
 * the move ("8 अंक की बढ़त"), not the child ("आगे बढ़ा / बढ़ी").
 */

export type Words = { en: string; hi: string };

/** How a grade is coloured on the card: the top bands green, the bottom red. */
export type GradeTone = "good" | "fine" | "watch" | "low" | "plain";

const TONES: Record<string, GradeTone> = {
  a1: "good",
  a2: "good",
  a: "good",
  outstanding: "good",
  excellent: "good",
  b1: "fine",
  b2: "fine",
  b: "fine",
  "very good": "fine",
  good: "fine",
  c1: "watch",
  c2: "watch",
  c: "watch",
  growing: "watch",
  d: "watch",
  e: "low",
  f: "low",
};

export function gradeTone(grade: string | null | undefined): GradeTone {
  if (!grade) return "plain";
  return TONES[grade.trim().toLowerCase()] ?? "plain";
}

const names = (codes: string[]): Words => {
  const pairs = codes.map(subjectPair);
  return { en: pairs.map((p) => p.en).join(", "), hi: pairs.map((p) => p.hi ?? p.en).join(", ") };
};

/** Points as a parent reads them: whole numbers, never "-6.3". */
const points = (value: number) => Math.round(Math.abs(value));

/** The first exam the term's growth is measured from: the first with both figures. */
function firstMeasured(journey: ExamPoint[]): ExamPoint | null {
  return journey.find((p) => p.percent !== null && p.classAvg !== null) ?? null;
}

/**
 * The headline of the effort panel: how far the child moved against the class
 * since the first exam of the term. Null when it cannot be measured.
 */
export function growthWords(insight: Pick<CardInsight, "growth" | "trend" | "journey">): Words | null {
  if (insight.growth === null || insight.trend === null) return null;
  const from = firstMeasured(insight.journey);
  const since = from ? { en: ` since ${from.en}`, hi: `${from.hi} से` } : { en: " this term", hi: "इस सत्र में" };
  const n = points(insight.growth);
  if (insight.trend === "up") return { en: `Moved up ${n} points against the class${since.en}`, hi: `${since.hi} कक्षा के मुकाबले ${n} अंक की बढ़त` };
  if (insight.trend === "down") return { en: `Fell ${n} points behind the class${since.en}`, hi: `${since.hi} कक्षा के मुकाबले ${n} अंक की गिरावट` };
  return { en: `Kept pace with the class${since.en}`, hi: `${since.hi} कक्षा के साथ बराबरी बनी रही` };
}

const TREND_WORDS: Record<Trend, Words> = {
  up: { en: "Rising in", hi: "बढ़त" },
  steady: { en: "Steady in", hi: "बराबर" },
  down: { en: "Slipping in", hi: "गिरावट" },
};

/** One line per way the subjects went, rising first: "Rising in Maths, English". */
export function effortWords(insight: Pick<CardInsight, "subjects">): (Words & { trend: Trend })[] {
  const order: Trend[] = ["up", "steady", "down"];
  return order.flatMap((trend) => {
    const codes = insight.subjects.filter((s) => s.trend === trend).map((s) => s.subjectCode);
    if (!codes.length) return [];
    const list = names(codes);
    return [{ trend, en: `${TREND_WORDS[trend].en} ${list.en}`, hi: `${TREND_WORDS[trend].hi}: ${list.hi}` }];
  });
}

/** "Strongest: Maths, English", or null when no subject stands out. */
export function strengthWords(insight: Pick<CardInsight, "strengths">): Words | null {
  if (!insight.strengths.length) return null;
  const list = names(insight.strengths);
  return { en: `Strongest: ${list.en}`, hi: `सबसे मज़बूत: ${list.hi}` };
}

/** "More practice: Hindi", or null when nothing is well under the class. */
export function focusWords(insight: Pick<CardInsight, "focus">): Words | null {
  if (!insight.focus.length) return null;
  const list = names(insight.focus);
  return { en: `More practice: ${list.en}`, hi: `और अभ्यास चाहिए: ${list.hi}` };
}

/** The card preview's panel (`CardInsightPanel`): every line worked out here, on the server. */
export function insightView(insight: CardInsight, passLine: number) {
  return {
    subjects: insight.subjects.map((s) => ({ subject: subjectPair(s.subjectCode), percent: s.percent, classAvg: s.classAvg, trend: s.trend })),
    journey: insight.journey.map((p) => ({ name: { en: p.en || p.code, hi: p.hi || undefined }, percent: p.percent, classAvg: p.classAvg })),
    growth: growthWords(insight),
    trend: insight.trend,
    effort: effortWords(insight),
    strengths: strengthWords(insight),
    focus: focusWords(insight),
    passLine,
  };
}
