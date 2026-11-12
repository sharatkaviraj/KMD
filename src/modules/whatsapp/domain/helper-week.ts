import type { HandoffTarget } from "./helper-replies";

/**
 * Veer Patta AI's week (D-590), for the owner and admins: what parents asked
 * about, how much the helper answered itself, where it struggled (questions
 * it could not answer, answers that did not help, times it fell back to the
 * menu), and how fast each member of staff answered what was passed to them.
 * Pure: the reads are `data/helper-week.ts`.
 *
 * Weeks start on Monday at midnight in India. Nothing here holds a parent's
 * words or number: the ledger never had them.
 */

const IST_MS = 330 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export type WeekChoice = "this" | "last";

/** Monday 00:00 in India, as an instant, and the Monday after it. */
export function weekBounds(now: Date, which: WeekChoice): { from: Date; to: Date } {
  const india = new Date(now.getTime() + IST_MS);
  const sinceMonday = (india.getUTCDay() + 6) % 7;
  const mondayIndia = Date.UTC(india.getUTCFullYear(), india.getUTCMonth(), india.getUTCDate() - sinceMonday);
  const from = mondayIndia - IST_MS - (which === "last" ? 7 * DAY_MS : 0);
  return { from: new Date(from), to: new Date(from + 7 * DAY_MS) };
}

/** What parents asked about, in the words the page uses; null for a turn that is not a parent's question. */
export const WEEK_TOPICS = [
  "fees",
  "receipts",
  "attendance",
  "results",
  "teacher",
  "leave",
  "calendar",
  "complaint",
  "request",
  "admission",
  "office",
  "other",
  "hello",
] as const;
export type WeekTopic = (typeof WEEK_TOPICS)[number];

const TOPIC_OF: Record<string, WeekTopic> = {
  fees: "fees",
  receipts: "receipts",
  attendance: "attendance",
  results: "results",
  teacher: "teacher",
  message_teacher: "teacher",
  leave: "leave",
  calendar: "calendar",
  complaint: "complaint",
  request: "request",
  admission: "admission",
  office: "office",
  handoff: "office",
  other: "other",
  fallback: "other",
  greeting: "hello",
  menu: "hello",
  thanks: "hello",
  voice: "hello",
  media: "hello",
};

/**
 * The topic of a parent's turn. A staff member's own turns (answering,
 * linking their WhatsApp), an answer delivered when the parent wrote "ok",
 * and a tap on "Did this answer help?" are not questions.
 */
export function topicOf(intent: string | null): WeekTopic | null {
  if (!intent) return null;
  return TOPIC_OF[intent] ?? null;
}

export type WeekTurn = {
  status: string;
  intent: string | null;
  route: string | null;
  handoff: string | null;
  costUsd: number;
  latencyMs: number | null;
  lessonRole: string | null;
};

export type WeekHandoff = {
  id: string;
  replyId: string;
  target: HandoffTarget;
  createdAt: string;
  /** Who it was given to (`parent_replies.assigned_staff_id`); null is the office, anyone there. */
  assignedTo: string | null;
  answeredAt: string | null;
  closedAt: string | null;
};

/** The first answer to a hand-off, from Messages or a WhatsApp swipe. */
export type WeekAnswer = { replyId: string; answeredBy: string; createdAt: string };

export type WeekReport = {
  /** Parents' questions the helper answered (a card, a rule, Claude, or the menu). */
  questions: number;
  /** Of those, answered by the helper itself, without a person. */
  byItself: number;
  /** Passed to a member of staff. */
  handedOff: number;
  /** Answered from an answer the school wrote (teach it once). */
  fromSchoolAnswers: number;
  /** General questions it could not answer, added to the list. */
  couldNotAnswer: number;
  /** Times it could not think of an answer and showed the menu. */
  fellBack: number;
  /** Replies that did not reach the parent. */
  notSent: number;
  /** How long a parent waited for the helper's reply, in seconds (the middle one). */
  medianSeconds: number | null;
  costUsd: number;
  /** Most asked first. */
  topics: Array<{ topic: WeekTopic; count: number }>;
  /** This week's hand-offs by who they were for. */
  targets: Array<{ target: HandoffTarget; count: number; answered: number; medianMinutes: number | null }>;
  /** Who answered this week's hand-offs, and how fast (first answer, the middle one). */
  people: Array<{ staffId: string; answered: number; medianMinutes: number | null }>;
  ratings: { helped: number; notHelped: number };
  /** Hand-offs from any week still waiting for a person. */
  waiting: { count: number; oldestAt: string | null; byPerson: Array<{ staffId: string | null; count: number; oldestAt: string }> };
};

/** The middle value, or the mean of the two middle ones; null for none. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

const TARGET_ORDER: readonly HandoffTarget[] = ["class_teacher", "accounts", "office", "principal"];

function minutesBetween(from: string, to: string): number | null {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 60_000;
}

export function weekReport(input: {
  turns: readonly WeekTurn[];
  handoffs: readonly WeekHandoff[];
  answers: readonly WeekAnswer[];
  ratings: readonly string[];
  open: readonly WeekHandoff[];
}): WeekReport {
  let questions = 0;
  let byItself = 0;
  let handedOff = 0;
  let fromSchoolAnswers = 0;
  let couldNotAnswer = 0;
  let fellBack = 0;
  let notSent = 0;
  let costUsd = 0;
  const seconds: number[] = [];
  const topics = new Map<WeekTopic, number>();

  for (const turn of input.turns) {
    costUsd += Number.isFinite(turn.costUsd) ? turn.costUsd : 0;
    const topic = topicOf(turn.intent);
    if (!topic) continue;
    if (turn.status === "failed") {
      notSent += 1;
      continue;
    }
    if (turn.status !== "answered") continue;
    questions += 1;
    topics.set(topic, (topics.get(topic) ?? 0) + 1);
    if (turn.handoff) handedOff += 1;
    else byItself += 1;
    if (turn.route === "fallback") fellBack += 1;
    if (turn.lessonRole === "used") fromSchoolAnswers += 1;
    if (turn.lessonRole === "asked") couldNotAnswer += 1;
    if (turn.latencyMs !== null && turn.latencyMs >= 0) seconds.push(turn.latencyMs / 1000);
  }

  // The first answer to each hand-off, and who gave it.
  const first = new Map<string, WeekAnswer>();
  for (const answer of input.answers) {
    const known = first.get(answer.replyId);
    if (!known || Date.parse(answer.createdAt) < Date.parse(known.createdAt)) first.set(answer.replyId, answer);
  }

  const byTarget = new Map<HandoffTarget, { count: number; minutes: number[] }>();
  const byPerson = new Map<string, number[]>();
  for (const handoff of input.handoffs) {
    const target = byTarget.get(handoff.target) ?? { count: 0, minutes: [] };
    target.count += 1;
    const answer = first.get(handoff.replyId);
    const minutes = answer ? minutesBetween(handoff.createdAt, answer.createdAt) : null;
    if (answer && minutes !== null) {
      target.minutes.push(minutes);
      byPerson.set(answer.answeredBy, [...(byPerson.get(answer.answeredBy) ?? []), minutes]);
    }
    byTarget.set(handoff.target, target);
  }

  const waitingBy = new Map<string, { staffId: string | null; count: number; oldestAt: string }>();
  let oldestAt: string | null = null;
  for (const handoff of input.open) {
    const key = handoff.assignedTo ?? "";
    const row = waitingBy.get(key) ?? { staffId: handoff.assignedTo, count: 0, oldestAt: handoff.createdAt };
    row.count += 1;
    if (Date.parse(handoff.createdAt) < Date.parse(row.oldestAt)) row.oldestAt = handoff.createdAt;
    waitingBy.set(key, row);
    if (!oldestAt || Date.parse(handoff.createdAt) < Date.parse(oldestAt)) oldestAt = handoff.createdAt;
  }

  const middle = median(seconds);
  return {
    questions,
    byItself,
    handedOff,
    fromSchoolAnswers,
    couldNotAnswer,
    fellBack,
    notSent,
    medianSeconds: middle === null ? null : Math.round(middle),
    costUsd,
    topics: [...topics.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count || WEEK_TOPICS.indexOf(a.topic) - WEEK_TOPICS.indexOf(b.topic)),
    targets: TARGET_ORDER.filter((target) => byTarget.has(target)).map((target) => {
      const row = byTarget.get(target) ?? { count: 0, minutes: [] };
      const minutes = median(row.minutes);
      return { target, count: row.count, answered: row.minutes.length, medianMinutes: minutes === null ? null : Math.round(minutes) };
    }),
    people: [...byPerson.entries()]
      .map(([staffId, minutes]) => {
        const middleMinutes = median(minutes);
        return { staffId, answered: minutes.length, medianMinutes: middleMinutes === null ? null : Math.round(middleMinutes) };
      })
      .sort((a, b) => b.answered - a.answered || (a.medianMinutes ?? 0) - (b.medianMinutes ?? 0) || a.staffId.localeCompare(b.staffId)),
    ratings: {
      helped: input.ratings.filter((rating) => rating === "helped").length,
      notHelped: input.ratings.filter((rating) => rating === "not_helped").length,
    },
    waiting: {
      count: input.open.length,
      oldestAt,
      byPerson: [...waitingBy.values()].sort((a, b) => b.count - a.count || Date.parse(a.oldestAt) - Date.parse(b.oldestAt)),
    },
  };
}

/** "12 min", "3 h 5 min", "2 days": how long, in a few words; the page puts them in the reader's language. */
export function durationParts(minutes: number): { days: number; hours: number; minutes: number } {
  const whole = Math.max(0, Math.round(minutes));
  return { days: Math.floor(whole / 1440), hours: Math.floor((whole % 1440) / 60), minutes: whole % 60 };
}
