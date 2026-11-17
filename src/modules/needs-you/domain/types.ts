import type { Pair } from "@/vx/text";

/**
 * Needs you, for everyone (D-630): one list per person of what is waiting on
 * them, in four lanes, with what they finished today beside it.
 *
 *   now      late, starting within the hour, or somebody is waiting
 *   today    to be done today
 *   later    another day, or put off with "Remind me later"
 *   waiting  they did their part; somebody else has to answer
 *
 * Every item comes from the screen that already owns the job (a register, a
 * marks paper, the counter queue), and its button opens that screen. Nothing
 * here decides anything for anybody: the list only says what is waiting and
 * in which order to do it.
 *
 * Pure: no database, no request, no clock of its own.
 */

export const NEED_LANES = ["now", "today", "later", "waiting"] as const;
export type NeedLane = (typeof NEED_LANES)[number];

/** Every kind of job a list can hold. The AI sees these words and nothing else about a job (D-633). */
export const NEED_KINDS = [
  // a teacher's day
  "attendance",
  "cover",
  "marks",
  "remarks",
  "task",
  "followup",
  "notice",
  "wish",
  "leave",
  // the fee office
  "counter",
  "calls",
  "promise",
  "cheques",
  "upi",
  "close",
  "request",
  // the exam office
  "exam_marks",
  "exam_step",
  "results",
  // the admin's decisions
  "refund",
  "job",
  "parent",
  // toilet charts not uploaded, or checks missed (D-652)
  "toilets",
  // everyone
  "chat",
  "own",
] as const;
export type NeedKind = (typeof NEED_KINDS)[number];

export function isNeedKind(value: unknown): value is NeedKind {
  return typeof value === "string" && (NEED_KINDS as readonly string[]).includes(value);
}

/** How long a job takes, roughly: a tap, a few minutes, or a sitting. */
export type NeedEffort = "quick" | "medium" | "long";

/** Done where it is shown, with no page to open. */
export type NeedQuick = "cover-yes" | "own-done";

export type NeedItem = {
  /** Stable across loads: "att:<class>:<day>", "marks:<paper>", "own:<id>". */
  key: string;
  kind: NeedKind;
  title: Pair;
  /** The second line: why it is here, or how far it has got. */
  why: Pair | null;
  lane: NeedLane;
  /** When it falls due or starts (ISO), if anything says. */
  dueAt: string | null;
  /** Minutes past due. Zero for anything not late. */
  lateMinutes: number;
  /** Minutes until it starts (a period to cover); null when it has no start. */
  startsInMinutes: number | null;
  /** People waiting on it right now: parents in a chat, families at the counter. */
  peopleWaiting: number;
  /** How many things it holds: papers, calls, children. One for a single job. */
  count: number;
  effort: NeedEffort;
  /** Where its button goes. */
  href: string;
  /** The button's words: "Mark attendance". */
  act: Pair;
  quick?: NeedQuick | null;
  /** Lane `waiting`: who has to answer. */
  waitingOn?: Pair | null;
  /** An own to-do's row id. */
  ownId?: string | null;
  /** The time this person asked to be reminded, if they did. */
  remindAt?: string | null;
  /** It came back because the time they asked for has come. */
  reminded?: boolean;
  /** Put off: the lane it sat in before, where "Bring back" returns it (D-636). */
  baseLane?: NeedLane;
  /** "Remind me later" is offered. Never on the waiting lane, which is not theirs to do. */
  canSnooze: boolean;
};

/** Something finished today. */
export type DoneItem = {
  key: string;
  kind: NeedKind;
  title: Pair;
  /** When, if known. */
  at: string | null;
};

/** A row of `vppsone.needs_reminders`: an own to-do, or a job put off until a time. */
export type NeedReminder = {
  id: string;
  kind: "own" | "snooze";
  itemKey: string | null;
  title: string | null;
  /** The words the time was read from ("kal subah 9 baje"), kept to show what was understood. */
  heard: string | null;
  remindAt: string | null;
  doneAt: string | null;
  createdAt: string;
};

/** Why a job is where it is in the order. One words each reason; the AI only picks one (D-633). */
export const NEED_REASONS = ["late", "starts_soon", "someone_waiting", "reminded", "quick_first", "due_today", "big_job_early"] as const;
export type NeedReason = (typeof NEED_REASONS)[number];

export function isNeedReason(value: unknown): value is NeedReason {
  return typeof value === "string" && (NEED_REASONS as readonly string[]).includes(value);
}

/** The order of the now and today lanes, and the reason for each place. */
export type NeedPlan = {
  order: string[];
  reasons: Record<string, NeedReason>;
  /** `ai`: arranged by the AI helper; `rules`: One's own order (late first, then by time). */
  source: "ai" | "rules";
};

/** The menus that have a board of their own; the admin's and coordinators' Needs you is `/inbox`. */
export type NeedsRole = "teacher" | "accountant" | "exam" | "admin";
