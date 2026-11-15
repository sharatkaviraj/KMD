import type { Pair } from "@/vx/text";

import { ruleReason, type NeedBoard } from "./lanes";
import { isNeedReason, NEED_KINDS, NEED_REASONS, type NeedEffort, type NeedKind, type NeedPlan, type NeedReason, type NeedsRole } from "./types";
import { REASON_WORDS } from "./words";

/**
 * What the AI helper is shown to arrange a list (D-633), and how its answer
 * comes back. It sees the kind of each job and a few numbers, never a name,
 * a class, a child or a word anybody wrote: "attendance, 40 minutes late,
 * a few minutes' work". So the arrangement may use the free models, and a
 * wrong answer can only change an order, which One checks again anyway.
 */

export type PlanFactItem = {
  id: string;
  kind: NeedKind;
  lane: "now" | "today";
  late_minutes: number;
  starts_in_minutes: number | null;
  people_waiting: number;
  how_many: number;
  effort: NeedEffort;
};

export type PlanFacts = {
  input: { role: NeedsRole; time: string; items: PlanFactItem[] };
  /** "i3" → the job's key. */
  ids: Record<string, string>;
};

export const PLAN_MAX_ITEMS = 25;

const whole = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : lo)));

function clock(now: Date): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
}

/** The facts for an arrangement, or null when there is nothing to arrange (fewer than two jobs). */
export function planFacts(board: NeedBoard, role: NeedsRole, now: Date): PlanFacts | null {
  const list = [...board.now, ...board.today].slice(0, PLAN_MAX_ITEMS);
  if (list.length < 2) return null;
  const ids: Record<string, string> = {};
  const items = list.map((item, i): PlanFactItem => {
    const id = `i${i + 1}`;
    ids[id] = item.key;
    return {
      id,
      kind: item.kind,
      lane: item.lane === "now" ? "now" : "today",
      late_minutes: whole(item.lateMinutes, 0, 14 * 24 * 60),
      starts_in_minutes: item.startsInMinutes === null ? null : whole(item.startsInMinutes, 0, 24 * 60),
      people_waiting: whole(item.peopleWaiting, 0, 999),
      how_many: whole(item.count, 1, 999),
      effort: item.effort,
    };
  });
  return { input: { role, time: clock(now), items }, ids };
}

/** The AI's answer, by the ids it was shown, as an order of keys. Unknown ids are dropped and missing jobs keep One's order. */
export function planFromAnswer(answer: { order: readonly string[]; reasons: readonly { id: string; reason: string }[] }, facts: PlanFacts): NeedPlan {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of answer.order) {
    const key = facts.ids[id];
    if (key && !seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  for (const key of Object.values(facts.ids)) if (!seen.has(key)) order.push(key);
  const reasons: Record<string, NeedReason> = {};
  for (const r of answer.reasons) {
    const key = facts.ids[r.id];
    if (key && isNeedReason(r.reason)) reasons[key] = r.reason;
  }
  return { order, reasons, source: "ai" };
}

/** "First, Mark attendance · Class 5 — it is late. Then Cover period 3." */
export function planLine(board: NeedBoard): Pair | null {
  const [first, second] = [...board.now, ...board.today];
  if (!first) return null;
  const why = REASON_WORDS[board.plan.reasons[first.key] ?? ruleReason(first)];
  const t1 = first.title;
  if (!second) return { en: `First, ${t1.en} — ${why.en}.`, hi: `पहले: ${t1.hi ?? t1.en} — ${why.hi ?? why.en}।` };
  const t2 = second.title;
  return {
    en: `First, ${t1.en} — ${why.en}. Then ${t2.en}.`,
    hi: `पहले: ${t1.hi ?? t1.en} — ${why.hi ?? why.en}। फिर: ${t2.hi ?? t2.en}।`,
  };
}

/** The instructions the arrangement task is given; kept here beside the facts they describe. */
export const PLAN_INSTRUCTIONS = `Task: put a school staff member's list of jobs for today in the best order to do them.
You see only the kind of each job and a few numbers about it, never names or details. Kinds: ${NEED_KINDS.join(", ")}.
- "now" jobs come before "today" jobs, except that a quick "today" job may go first if every "now" job is a long one.
- A job with starts_in_minutes of 15 or less is always first: a class is about to begin.
- Then late jobs (late_minutes, most late first), then jobs where people_waiting is more than 0 (people are waiting in person or on a chat).
- Among the rest, mix quick jobs (a tap or a minute) early, so the person feels progress, but start a long job early in the day when it is due today. The time is given as HH:MM, school runs about 07:30 to 14:30.
- Give every id exactly once in "order". For each id give the one reason that best explains its place, from: ${NEED_REASONS.join(", ")}.
- Use only the ids given. Do not explain.`;
