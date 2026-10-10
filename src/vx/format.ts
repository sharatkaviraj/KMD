/**
 * Formatting shared by every vx screen. Pure — no React, no database — so it
 * is unit-tested in `tests/vx-format.test.ts`.
 *
 * Money is Indian rupees in the Indian grouping (₹1,23,400), always with
 * tabular figures at the call site, and a negative is "−₹" with a real minus.
 */

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** ₹1,23,400. Paise are shown only when there are any. */
export function rupees(value: number | null | undefined): string {
  const v = Number(value ?? 0);
  if (!Number.isFinite(v)) return "₹0";
  const abs = Math.abs(v);
  const body = Number.isInteger(abs) ? inr.format(abs) : inr2.format(abs);
  return `${v < 0 ? "−" : ""}₹${body}`;
}

/** Short money for tiles and chart axes: ₹950, ₹2.4k, ₹38.4k, ₹18.6 L, ₹1.2 Cr. */
export function rupeesShort(value: number | null | undefined): string {
  const v = Number(value ?? 0);
  const abs = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const trim = (n: number) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, "");
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)} L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven",
  "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(" ");
}

/** "Rupees Thirty-Eight Thousand Four Hundred only" — the Indian system (lakh, crore). */
export function amountInWords(value: number): string {
  let n = Math.floor(Math.abs(value));
  if (n === 0) return "Rupees Zero only";
  const parts: string[] = [];
  const crore = Math.floor(n / 1_00_00_000);
  n %= 1_00_00_000;
  const lakh = Math.floor(n / 1_00_000);
  n %= 1_00_000;
  const thousand = Math.floor(n / 1_000);
  n %= 1_000;
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (n) parts.push(threeDigits(n));
  return `Rupees ${parts.join(" ")} only`;
}

/** Initials for an avatar: "Janmejay Singh" → "JS". */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? "")
    .replace(/^(mr|mrs|ms|dr|shri|smt)\.?\s+/i, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

const TZ = "Asia/Kolkata";

/** Today's date in the school's timezone, as YYYY-MM-DD. */
export function schoolToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(now);
}

function asDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  // A bare date is a calendar day, not an instant; pin it to midday so no
  // timezone can move it to the neighbouring day.
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
}

/** "Thursday, 8 October". */
export function longDay(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" }).format(asDate(value));
}

/** "Thu 8 Oct". */
export function shortDay(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(asDate(value));
}

/** "8 Oct 2026". */
export function dateLabel(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short", year: "numeric" }).format(asDate(value));
}

/** "8 Oct". */
export function dayMonth(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, day: "numeric", month: "short" }).format(asDate(value));
}

/** "09:20". */
export function clock(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(asDate(value));
}

/** "Good morning" / "Good afternoon" / "Good evening" in the school's day. */
export function greeting(now: Date = new Date()): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Whole days from `from` to `to` (calendar days, school timezone). */
export function daysBetween(from: string, to: string): number {
  const a = asDate(from).getTime();
  const b = asDate(to).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "3 min ago", "2 h ago", "yesterday", "8 Oct" — in English. Say `agoP` to readers. */
export function ago(value: string | Date, now: Date = new Date()): string {
  return agoP(value, now).en;
}

/** `ago` as an English/Hindi pair, for `tx()` or `say()`. */
export function agoP(value: string | Date, now: Date = new Date()): { en: string; hi: string } {
  const d = asDate(value);
  const s = Math.round((now.getTime() - d.getTime()) / 1000);
  if (s < 60) return { en: "just now", hi: "अभी" };
  if (s < 3600) return { en: `${Math.round(s / 60)} min ago`, hi: `${Math.round(s / 60)} मिनट पहले` };
  if (s < 86_400) return { en: `${Math.round(s / 3600)} h ago`, hi: `${Math.round(s / 3600)} घंटे पहले` };
  if (s < 2 * 86_400) return { en: "yesterday", hi: "कल" };
  const day = dayMonth(d);
  return { en: day, hi: day };
}

/** "12 of 27". */
export function countOf(part: number, whole: number): string {
  return `${part} of ${whole}`;
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/** Pluralise an English noun. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
