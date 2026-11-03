import { addDays, type DaySpan, type DeskMode } from "@/modules/receipts/vx/domain/day-close";
import { shortDay } from "@/vx/format";
import type { IconName } from "@/vx/icons";
import type { Pair } from "@/vx/text";

import { W } from "./words";

/*
 * How the design (`Fees.dc.html`) draws receipts: one look per payment mode,
 * the avatar tones it cycles through, and its day and clock labels. Pure, so
 * the list, the receipt and the day close agree.
 */

/** Soft fill, ink and icon per mode — the pill, the phone tile and the close's rows. */
export const MODE_LOOK: Record<DeskMode, { bg: string; fg: string; icon: IconName }> = {
  upi: { bg: "var(--accs)", fg: "var(--accfg)", icon: "zap" },
  cash: { bg: "var(--oks)", fg: "var(--ok)", icon: "rupee" },
  cheque: { bg: "var(--warns)", fg: "var(--warnfg)", icon: "file" },
  bank: { bg: "var(--infos)", fg: "var(--info)", icon: "database" },
  other: { bg: "var(--s3)", fg: "var(--fg)", icon: "receipt" },
};

/** "How it came in": the chart colours, in the design's order. */
export const MIX: { mode: Exclude<DeskMode, "other">; color: string }[] = [
  { mode: "upi", color: "var(--c1)" },
  { mode: "cash", color: "var(--c2)" },
  { mode: "cheque", color: "var(--c3)" },
  { mode: "bank", color: "var(--c4)" },
];

/** The student avatar's five tones, taken in turn down the day's list. */
export const AVATAR_TONES: [string, string][] = [
  ["var(--accs)", "var(--accfg)"],
  ["var(--infos)", "var(--info)"],
  ["var(--oks)", "var(--ok)"],
  ["var(--warns)", "var(--warnfg)"],
  ["var(--s3)", "var(--fg)"],
];

/** "Thu 8 Oct" — the design's day, without the comma Intl puts in. */
export function deskDay(iso: string): string {
  return shortDay(iso).replace(",", "").replace("Sept", "Sep");
}

const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true });

/** "9:58" in the morning, "4:40 pm" after noon, as the design writes a receipt's time. */
export function deskTime(value: string): string {
  const text = TIME.format(new Date(value));
  const pm = /p\.?\s*m\.?$/i.test(text);
  const bare = text.replace(/[\s ]*[ap]\.?\s*m\.?$/i, "");
  // Always say which half of the day: a receipt at "1:14" beside "11:52 pm"
  // could not be read as 1:14 am (accountant UI).
  return `${bare} ${pm ? "pm" : "am"}`;
}

/** "Today · Thu 8 Oct", "Yesterday · Wed 7 Oct", "Tue 6 Oct". */
export function dayGroupLabel(date: string, today: string): Pair {
  const day = deskDay(date);
  if (date === today) return { en: `${W.today.en} · ${day}`, hi: `${W.today.hi} · ${day}` };
  if (date === addDays(today, -1)) return { en: `${W.yesterday.en} · ${day}`, hi: `${W.yesterday.hi} · ${day}` };
  return { en: day, hi: day };
}

/**
 * The day toggle's own reading of the picked day, and what its first two
 * options say. With yesterday picked (`?date=` yesterday, one day) it reads
 * as today's "Yesterday" option, so the toggle does not show both "Tue 20
 * Oct" and "Yesterday" for the same day (smoke 21 Oct). For an older day the
 * second option is the day before it, so it is dated rather than called
 * "Yesterday". `null` for a label means "Today" / "Yesterday".
 */
export function daySeg(anchor: string, today: string, span: DaySpan): { anchor: string; span: DaySpan; first: string | null; second: string | null } {
  const yesterday = addDays(today, -1);
  const seg = anchor === yesterday && span === "today" ? { anchor: today, span: "yesterday" as const } : { anchor, span };
  const onToday = seg.anchor === today;
  return { ...seg, first: onToday ? null : seg.anchor, second: onToday ? null : addDays(seg.anchor, -1) };
}

/** "Initials" for the list's avatar: first letters of the first two words. */
export function nameInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
