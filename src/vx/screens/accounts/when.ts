import { shortDay } from "@/vx/format";

/*
 * The accountant's screens write times the way the design does: "10:38 am",
 * "Thu 8 Oct", "Asked 9:40 am" today and "Asked yesterday" after. Pure, so the
 * screens and their tests read the same words.
 */

const TZ = "Asia/Kolkata";
const TIME = new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
const YMD = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** "10:38 am". */
export function time12(value: string | Date): string {
  return TIME.format(new Date(value)).replace(/\s+/g, " ").toLowerCase();
}

/** "Thu 8 Oct" — the design's day, without the comma some ICU builds add. */
export function day(value: string | Date): string {
  return shortDay(value).replace(",", "");
}

/** "Wed 7 – Thu 8 Oct", "Wed 30 Sep – Thu 1 Oct", "Thu 8 Oct"; empty without days. */
export function dayRange(from: string | undefined, to: string | undefined): string {
  if (!from || !to) return "";
  if (from === to) return day(from);
  const a = day(from);
  const b = day(to);
  const month = (s: string) => s.split(" ").at(-1);
  return `${month(a) === month(b) ? a.split(" ").slice(0, -1).join(" ") : a} – ${b}`;
}

/** The school day (YYYY-MM-DD) an instant falls on. */
export function schoolDay(value: string | Date): string {
  return YMD.format(new Date(value));
}

/** When something happened, relative to the school day `today`: "9:40 am", "yesterday", "Tue 6 Oct". */
export function whenOn(value: string, today: string): string {
  const d = schoolDay(value);
  if (d === today) return time12(value);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (d === yesterday) return "yesterday";
  return day(value);
}

/** Whole minutes from `value` to `now`, never negative. */
export function minutesSince(value: string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60_000));
}

/** "6 h 48 m" until `untilMinute` past midnight on the school clock, or null once it has passed. */
export function timeLeft(untilMinute: number, now: Date = new Date()): string | null {
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60_000);
  const left = untilMinute - (ist.getUTCHours() * 60 + ist.getUTCMinutes());
  if (left <= 0) return null;
  return left >= 60 ? `${Math.floor(left / 60)} h ${left % 60} m` : `${left} m`;
}

/** First name for a greeting, past an honorific: "Ms. Neelam Sharma" → "Neelam". */
export function firstName(name: string): string {
  const words = name.trim().split(/\s+/);
  const skip = /^(mr|mrs|ms|miss|dr|shri|smt|sh)\.?$/i;
  return words.find((w) => !skip.test(w)) ?? words[0] ?? name;
}
