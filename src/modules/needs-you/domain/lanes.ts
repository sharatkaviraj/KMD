import { schoolToday } from "@/platform/dates";
import { p } from "@/vx/text";

import { NEED_LANES, type DoneItem, type NeedItem, type NeedLane, type NeedPlan, type NeedReason, type NeedReminder } from "./types";

/**
 * The four lanes and the order inside them (D-630, D-633). One's own rules
 * decide which lane a job is in; the AI may only change the order inside
 * "Do now" and "Today", and never ahead of a period that starts within a
 * quarter of an hour.
 */

export type NeedBoard = Record<NeedLane, NeedItem[]> & {
  /** The first job of all: the "Do this next" card. */
  next: NeedItem | null;
  /** Jobs in "Do now" and "Today". */
  left: number;
  plan: NeedPlan;
};

/** A period about to begin stays first whatever any order says. */
const IMMINENT_MINUTES = 15;

/** A job put off with "Remind me later" moves to Later until its time, then comes back to Do now. */
export function withReminders(items: readonly NeedItem[], reminders: readonly NeedReminder[], now: Date): NeedItem[] {
  const snoozes = new Map<string, NeedReminder>();
  for (const r of reminders) {
    if (r.kind !== "snooze" || !r.itemKey || r.doneAt || !r.remindAt) continue;
    const old = snoozes.get(r.itemKey);
    if (!old || old.createdAt < r.createdAt) snoozes.set(r.itemKey, r);
  }
  const out: NeedItem[] = items.map((item) => {
    const s = snoozes.get(item.key);
    if (!s?.remindAt || item.lane === "waiting" || !item.canSnooze) return item;
    const due = Date.parse(s.remindAt) <= now.getTime();
    return { ...item, lane: due ? "now" : "later", remindAt: s.remindAt, reminded: due, baseLane: item.lane };
  });
  for (const r of reminders) if (r.kind === "own" && !r.doneAt && r.title) out.push(ownItem(r, now));
  return out;
}

/** A person's own to-do as a job: no time is today's; a time that has come is Do now. */
export function ownItem(r: NeedReminder, now: Date): NeedItem {
  const at = r.remindAt ? Date.parse(r.remindAt) : null;
  const lane: NeedLane =
    at === null || Number.isNaN(at)
      ? "today"
      : at <= now.getTime()
        ? "now"
        : schoolToday(new Date(at)) === schoolToday(now)
          ? "today"
          : "later";
  return {
    key: `own:${r.id}`,
    kind: "own",
    // The person's own words, as they wrote them, in whichever language.
    title: p(r.title ?? ""),
    why: null,
    lane,
    dueAt: r.remindAt,
    lateMinutes: 0,
    startsInMinutes: null,
    peopleWaiting: 0,
    count: 1,
    effort: "quick",
    href: "/needs",
    act: p("Done", "हो गया"),
    quick: "own-done",
    ownId: r.id,
    remindAt: r.remindAt,
    reminded: lane === "now",
    canSnooze: true,
  };
}

const EFFORT_RANK = { quick: 0, medium: 1, long: 2 } as const;
const instant = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};
const byNumber = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);

function nowRank(i: NeedItem): number {
  if (i.startsInMinutes !== null && i.startsInMinutes <= IMMINENT_MINUTES) return 0;
  if (i.lateMinutes > 0) return 1;
  if (i.peopleWaiting > 0) return 2;
  if (i.reminded) return 3;
  if (i.startsInMinutes !== null && i.startsInMinutes <= 60) return 4;
  return 5;
}

/** One's own order inside a lane: what cannot wait first, then by time. */
export function ruleCompare(a: NeedItem, b: NeedItem): number {
  if (a.lane === "now") {
    return (
      byNumber(nowRank(a), nowRank(b)) ||
      byNumber(a.startsInMinutes ?? 1e9, b.startsInMinutes ?? 1e9) ||
      byNumber(b.lateMinutes, a.lateMinutes) ||
      byNumber(b.peopleWaiting, a.peopleWaiting) ||
      byNumber(instant(a.dueAt), instant(b.dueAt)) ||
      a.key.localeCompare(b.key)
    );
  }
  if (a.lane === "today") {
    return (
      byNumber(instant(a.dueAt), instant(b.dueAt)) ||
      byNumber(EFFORT_RANK[a.effort], EFFORT_RANK[b.effort]) ||
      a.key.localeCompare(b.key)
    );
  }
  return byNumber(instant(a.remindAt ?? a.dueAt), instant(b.remindAt ?? b.dueAt)) || a.key.localeCompare(b.key);
}

/** The reason One's own rules give for a job's place. */
export function ruleReason(i: NeedItem): NeedReason {
  if (i.reminded) return "reminded";
  if (i.startsInMinutes !== null && i.startsInMinutes <= 60) return "starts_soon";
  if (i.lateMinutes > 0) return "late";
  if (i.peopleWaiting > 0) return "someone_waiting";
  if (i.effort === "quick") return "quick_first";
  if (i.effort === "long") return "big_job_early";
  return "due_today";
}

/**
 * A plan still fits when it names every job of the school's now in Do now
 * and Today, and at least one of them is still there. One finished since is
 * simply skipped; a to-do of the person's own added since goes after the
 * planned jobs in its lane, so writing one down never undoes the order.
 */
export function planFits(plan: NeedPlan | null, items: readonly NeedItem[]): boolean {
  if (!plan || plan.order.length === 0) return false;
  const known = new Set(plan.order);
  const open = items.filter((i) => i.lane === "now" || i.lane === "today");
  return open.some((i) => known.has(i.key)) && open.every((i) => i.kind === "own" || known.has(i.key));
}

/** The jobs in lanes, in order, with the plan that ordered them. */
export function arrange(items: readonly NeedItem[], plan: NeedPlan | null = null): NeedBoard {
  const lanes: Record<NeedLane, NeedItem[]> = { now: [], today: [], later: [], waiting: [] };
  for (const item of items) lanes[item.lane].push(item);
  for (const lane of NEED_LANES) lanes[lane].sort(ruleCompare);

  const fits = planFits(plan, items);
  const reasons: Record<string, NeedReason> = {};
  if (plan && fits) {
    const place = new Map(plan.order.map((key, i) => [key, i]));
    for (const lane of ["now", "today"] as const) {
      lanes[lane].sort((a, b) => byNumber(place.get(a.key) ?? 1e9, place.get(b.key) ?? 1e9));
    }
    // A period about to begin is never put behind anything.
    const imminent = lanes.now.filter((i) => i.startsInMinutes !== null && i.startsInMinutes <= IMMINENT_MINUTES);
    if (imminent.length) lanes.now = [...imminent, ...lanes.now.filter((i) => !imminent.includes(i))];
    for (const [key, reason] of Object.entries(plan.reasons)) reasons[key] = reason;
  }
  const ordered = [...lanes.now, ...lanes.today];
  for (const item of ordered) reasons[item.key] ??= ruleReason(item);
  return {
    ...lanes,
    next: ordered[0] ?? null,
    left: ordered.length,
    plan: {
      order: ordered.map((i) => i.key),
      reasons: Object.fromEntries(ordered.map((i) => [i.key, reasons[i.key]])),
      source: plan && fits ? plan.source : "rules",
    },
  };
}

/**
 * A short fingerprint of what is in Do now and Today, so an order the AI made
 * for this exact list is used again instead of asking twice.
 */
export function needSignature(items: readonly NeedItem[]): string {
  const keys = items
    .filter((i) => i.lane === "now" || i.lane === "today")
    .map((i) => `${i.lane}:${i.key}`)
    .sort();
  let h = 0x811c9dc5;
  for (const ch of keys.join("|")) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${keys.length}:${h.toString(16).padStart(8, "0")}`;
}

/**
 * Jobs whose reminder time has come while the list is open: back to Do now,
 * marked as reminded. `woke` is what came back, for the "Back on your list"
 * note; nothing that is waiting on somebody else ever moves.
 */
export function wakeDue(items: readonly NeedItem[], now: Date): { items: NeedItem[]; woke: NeedItem[] } {
  const woke: NeedItem[] = [];
  const out = items.map((item) => {
    if (!item.remindAt || item.reminded || item.lane === "now" || item.lane === "waiting") return item;
    const at = Date.parse(item.remindAt);
    if (Number.isNaN(at) || at > now.getTime()) return item;
    const back: NeedItem = { ...item, lane: "now", reminded: true };
    woke.push(back);
    return back;
  });
  return { items: woke.length ? out : [...items], woke };
}

/**
 * A job in Later that the person put there, so "Bring back" is offered: put
 * off with "Remind me later", or an own to-do with a time on another day
 * (D-636). A job that is in Later by its own date has no time of theirs.
 */
export function canBringBack(item: NeedItem): boolean {
  return item.lane === "later" && Boolean(item.remindAt) && item.canSnooze;
}

/**
 * "Bring back" (D-636): a put-off job returns to the lane it was in before,
 * and an own to-do goes on today's list without a time. The server does the
 * same by cancelling the put-off, or clearing the to-do's time, so the next
 * read of the page agrees.
 */
export function broughtBack(item: NeedItem): NeedItem {
  const { baseLane, ...rest } = item;
  if (item.kind === "own") return { ...rest, lane: "today", remindAt: null, dueAt: null, reminded: false };
  return { ...rest, lane: baseLane ?? "today", remindAt: null, reminded: false };
}

/** Today's done jobs, the source's own and the ones that left the list, once each, the latest first. */
export function mergeDone(...lists: readonly (readonly DoneItem[])[]): DoneItem[] {
  const byKey = new Map<string, DoneItem>();
  for (const list of lists) {
    for (const d of list) {
      const old = byKey.get(d.key);
      if (!old || (!old.at && d.at)) byKey.set(d.key, d);
    }
  }
  return [...byKey.values()].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}
