import type { GroupKey } from "./groups";

/*
 * The date sheet as data: sittings, the days an exam runs, the clashes a
 * coordinator has to fix, and copying last exam's order onto new dates.
 * Days are `YYYY-MM-DD`, times `HH:MM`, both in school time.
 */

export type Slot = {
  id: string;
  groupKey: GroupKey;
  subject: string;
  day: string;
  start: string;
  minutes: number;
};

const DAY = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, (m ?? 1) - 1, d ?? 1);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * DAY);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(day: string): number {
  return new Date(toUtc(day)).getUTCDay();
}

export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function timeOf(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 8:30 – the way a date sheet prints a time, without a leading zero. */
export function clockShort(time: string): string {
  const [h, m] = time.split(":");
  return `${Number(h)}:${m}`;
}

export function endOf(slot: Pick<Slot, "start" | "minutes">): string {
  return timeOf(minutesOf(slot.start) + slot.minutes);
}

export function slotTimeLabel(slot: Pick<Slot, "start" | "minutes">): string {
  return `${clockShort(slot.start)}–${clockShort(endOf(slot))}`;
}

export function lengthLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** The school days from `from` to `to`, Sundays and holidays left out. */
export function examDays(from: string, to: string, holidays: ReadonlySet<string> = new Set()): string[] {
  const days: string[] = [];
  if (!from || !to || to < from) return days;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (weekday(d) !== 0 && !holidays.has(d)) days.push(d);
    if (days.length > 60) break;
  }
  return days;
}

export type Clash =
  | { kind: "same_day"; groupKey: GroupKey; day: string; slotIds: string[]; overlap: boolean }
  | { kind: "sunday" | "holiday"; groupKey: GroupKey; day: string; slotIds: string[] };

/**
 * What a coordinator must fix before publishing.
 *
 * Two papers for one band on one day is a clash even when the times do not
 * overlap: the date sheet promises a child one paper a day. A sitting on a
 * Sunday or a holiday is a clash too.
 */
export function findClashes(slots: Slot[], holidays: ReadonlySet<string> = new Set()): Clash[] {
  const clashes: Clash[] = [];
  const byKey = new Map<string, Slot[]>();
  for (const slot of slots) {
    const key = `${slot.groupKey}|${slot.day}`;
    byKey.set(key, [...(byKey.get(key) ?? []), slot]);
  }
  for (const [key, list] of byKey) {
    const [groupKey, day] = key.split("|") as [GroupKey, string];
    if (list.length > 1) {
      const sorted = [...list].sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
      let overlap = false;
      for (let i = 1; i < sorted.length; i += 1) {
        if (minutesOf(sorted[i].start) < minutesOf(sorted[i - 1].start) + sorted[i - 1].minutes) overlap = true;
      }
      clashes.push({ kind: "same_day", groupKey, day, slotIds: sorted.map((s) => s.id), overlap });
    }
    if (weekday(day) === 0) clashes.push({ kind: "sunday", groupKey, day, slotIds: list.map((s) => s.id) });
    else if (holidays.has(day)) clashes.push({ kind: "holiday", groupKey, day, slotIds: list.map((s) => s.id) });
  }
  return clashes.sort((a, b) => a.day.localeCompare(b.day) || a.groupKey.localeCompare(b.groupKey));
}

export type Fix = { slotId: string; toDay: string; start: string };

/**
 * Ways out of a clash: move the later paper to a day this band has free. The
 * first suggestion is the nearest free day; the start time is kept, unless it
 * was an afternoon sitting squeezed in beside another, in which case it moves
 * to the morning slot the band usually uses.
 */
export function fixesFor(clash: Clash, slots: Slot[], days: string[]): Fix[] {
  const band = slots.filter((s) => s.groupKey === clash.groupKey);
  const busy = new Set(band.map((s) => s.day));
  const free = days.filter((d) => !busy.has(d));
  const moving = clash.kind === "same_day" ? clash.slotIds.slice(1) : clash.slotIds;
  const usual = mostCommon(band.filter((s) => !moving.includes(s.id)).map((s) => s.start)) ?? "08:30";
  const fixes: Fix[] = [];
  for (const slotId of moving) {
    const from = slots.find((s) => s.id === slotId);
    if (!from) continue;
    const ranked = [...free].sort((a, b) => Math.abs(toUtc(a) - toUtc(from.day)) - Math.abs(toUtc(b) - toUtc(from.day)) || a.localeCompare(b));
    for (const day of ranked.slice(0, 3)) fixes.push({ slotId, toDay: day, start: usual });
  }
  return fixes;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n || (c === n && best !== null && v < best)) [best, n] = [v, c];
  return best;
}

/**
 * Copy last exam's order onto this exam's days: the first day's papers go on
 * this exam's first school day, the second's on the second, and so on. The
 * order is the part a school has already agreed; only the dates move.
 *
 * Returns the slots without ids, and how many source days did not fit.
 */
export function copyOnto(
  source: Omit<Slot, "id">[],
  targetDays: string[],
): { slots: Omit<Slot, "id">[]; overflow: number } {
  const sourceDays = [...new Set(source.map((s) => s.day))].sort();
  const map = new Map<string, string>();
  sourceDays.forEach((day, i) => {
    if (i < targetDays.length) map.set(day, targetDays[i]);
  });
  const slots = source
    .filter((s) => map.has(s.day))
    .map((s) => ({ ...s, day: map.get(s.day)! }));
  return { slots, overflow: Math.max(0, sourceDays.length - targetDays.length) };
}
