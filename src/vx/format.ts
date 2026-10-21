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
  const d = schoolParts(value);
  return `${d.weekday} ${d.day} ${d.month}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS: Record<string, string> = { Mon: "Mon", Tue: "Tue", Wed: "Wed", Thu: "Thu", Fri: "Fri", Sat: "Sat", Sun: "Sun" };

/**
 * The day in the school's time zone, in the design's own words: "Sep", never
 * the "Sept" newer ICU gives en-IN, and no comma after the weekday.
 */
function schoolParts(value: string | Date): { weekday: string; day: number; month: string; year: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(asDate(value));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { weekday: WEEKDAYS[get("weekday")] ?? get("weekday"), day: Number(get("day")), month: MONTHS[Number(get("month")) - 1] ?? "", year: Number(get("year")) };
}

/* ------------------------------------------------------------ in Hindi */

/*
 * Days and times for a Hindi reader (smoke 20 Oct, dev.groups[10]): a
 * Hindi-only teacher saw "Mon 19 Oct" and "10:59 pm बजे". Hindi month and
 * weekday names, and the part of the day in front of the time — "रात 10:59",
 * "सुबह 8:52 बजे" — never "am"/"pm". Each has a pair form (`…P`) for `tx()`,
 * which is what a screen should use: the reader's language picks the line.
 */

const HI_MONTHS = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const HI_WEEKDAYS = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const HI_WEEKDAYS_SHORT = ["रवि", "सोम", "मंगल", "बुध", "गुरु", "शुक्र", "शनि"];
const HI_WEEKDAY_LETTERS = ["र", "सो", "मं", "बु", "गु", "शु", "श"];
const EN_WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_WEEKDAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const EN_MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The day in the school's time zone as indices: weekday 0 = Sunday, month 0 = January. */
function schoolIndex(value: string | Date): { weekday: number; day: number; month: number; year: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(asDate(value));
  const get = (type: string) => parts.find((x) => x.type === type)?.value ?? "";
  return { weekday: Math.max(0, EN_WEEKDAYS_SHORT.indexOf(get("weekday"))), day: Number(get("day")), month: Number(get("month")) - 1, year: Number(get("year")) };
}

/** "सोम 19 अक्टूबर". */
export function shortDayHi(value: string | Date): string {
  const d = schoolIndex(value);
  return `${HI_WEEKDAYS_SHORT[d.weekday]} ${d.day} ${HI_MONTHS[d.month]}`;
}

/** "सोमवार, 19 अक्टूबर". */
export function longDayHi(value: string | Date): string {
  const d = schoolIndex(value);
  return `${HI_WEEKDAYS[d.weekday]}, ${d.day} ${HI_MONTHS[d.month]}`;
}

/** "19 अक्टूबर". */
export function dayMonthHi(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = schoolIndex(value);
  return `${d.day} ${HI_MONTHS[d.month]}`;
}

/** "19 अक्टूबर 2026". */
export function dateLabelHi(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = schoolIndex(value);
  return `${d.day} ${HI_MONTHS[d.month]} ${d.year}`;
}

/** The part of the day a Hindi speaker puts before the time. */
export function dayPeriodHi(hour24: number): string {
  if (hour24 < 4) return "रात";
  if (hour24 < 12) return "सुबह";
  if (hour24 < 16) return "दोपहर";
  if (hour24 < 20) return "शाम";
  return "रात";
}

/** Hours and minutes of a bell time "13:30" or of an instant, on the school's clock. */
function hourMinute(value: string | Date): { h: number; m: number } | null {
  if (typeof value === "string") {
    const bell = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
    if (bell) return { h: Number(bell[1]), m: Number(bell[2]) };
  }
  const d = asDate(value);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const h = Number(parts.find((x) => x.type === "hour")?.value) % 24;
  const m = Number(parts.find((x) => x.type === "minute")?.value);
  return Number.isFinite(h) && Number.isFinite(m) ? { h, m } : null;
}

const h12 = (h: number) => (h % 12 === 0 ? 12 : h % 12);
const mm = (m: number) => String(m).padStart(2, "0");

/** "8:52 am" — a bell time "08:52" or an instant. */
export function timeEn(value: string | Date): string {
  const t = hourMinute(value);
  return t ? `${h12(t.h)}:${mm(t.m)} ${t.h < 12 ? "am" : "pm"}` : String(value);
}

/** "सुबह 8:52", "दोपहर 1:30", "रात 10:59" — a bell time "22:59" or an instant. */
export function timeHi(value: string | Date): string {
  const t = hourMinute(value);
  return t ? `${dayPeriodHi(t.h)} ${h12(t.h)}:${mm(t.m)}` : String(value);
}

/** A time inside a sentence: "at 8:52 am" / "सुबह 8:52 बजे" (बजे after the time, never after "pm"). */
export function atTimeP(value: string | Date): { en: string; hi: string } {
  return { en: `at ${timeEn(value)}`, hi: `${timeHi(value)} बजे` };
}

/** "8:52 am" / "सुबह 8:52". */
export function timeP(value: string | Date): { en: string; hi: string } {
  return { en: timeEn(value), hi: timeHi(value) };
}

/** "Mon 19 Oct" / "सोम 19 अक्टूबर". */
export function shortDayP(value: string | Date): { en: string; hi: string } {
  return { en: shortDay(value), hi: shortDayHi(value) };
}

/** "Monday, 19 October" / "सोमवार, 19 अक्टूबर". */
export function longDayP(value: string | Date): { en: string; hi: string } {
  return { en: longDay(value), hi: longDayHi(value) };
}

/** "19 Oct" / "19 अक्टूबर". */
export function dayMonthP(value: string | Date | null | undefined): { en: string; hi: string } {
  return { en: dayMonth(value), hi: dayMonthHi(value) };
}

/** "19 Oct 2026" / "19 अक्टूबर 2026". */
export function dateLabelP(value: string | Date | null | undefined): { en: string; hi: string } {
  return { en: dateLabel(value), hi: dateLabelHi(value) };
}

/** "October" / "अक्टूबर" (a date, or a "2026-10" month). */
export function monthP(value: string | Date): { en: string; hi: string } {
  const v = typeof value === "string" && /^\d{4}-\d{2}$/.test(value) ? `${value}-15` : value;
  const d = schoolIndex(v);
  return { en: EN_MONTHS_LONG[d.month], hi: HI_MONTHS[d.month] };
}

/** "Mon" / "सोम". */
export function weekdayP(value: string | Date): { en: string; hi: string } {
  const d = schoolIndex(value);
  return { en: EN_WEEKDAYS_SHORT[d.weekday], hi: HI_WEEKDAYS_SHORT[d.weekday] };
}

/** One letter for a calendar column: "M" / "सो". */
export function weekdayLetterP(value: string | Date): { en: string; hi: string } {
  const d = schoolIndex(value);
  return { en: EN_WEEKDAY_LETTERS[d.weekday], hi: HI_WEEKDAY_LETTERS[d.weekday] };
}

/** "8 Oct 2026". */
export function dateLabel(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = schoolParts(value);
  return `${d.day} ${d.month} ${d.year}`;
}

/** "8 Oct". */
export function dayMonth(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = schoolParts(value);
  return `${d.day} ${d.month}`;
}

/** "09:20". */
export function clock(value: string | Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(asDate(value));
}

/**
 * "Good morning" / "Good afternoon" / "Good evening" in the school's day.
 * Pass the school clock's minutes past midnight where a page already has
 * them, so a QA test time (D-269) moves the greeting with the timetable.
 */
export function greeting(now: Date | number = new Date()): string {
  const hour = typeof now === "number" ? Math.floor(now / 60) : Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false }).format(now));
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
  return { en: dayMonth(d), hi: dayMonthHi(d) };
}

/** "12 of 27". In a sentence a reader sees, use `countOfP` (or `outOf` in `@/vx/text`). */
export function countOf(part: number, whole: number): string {
  return `${part} of ${whole}`;
}

/** "12 of 27" / "27 में से 12" — Hindi puts the whole first. */
export function countOfP(part: number, whole: number): { en: string; hi: string } {
  return { en: `${part} of ${whole}`, hi: `${whole} में से ${part}` };
}

export function pct(part: number, whole: number): number {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

/** Pluralise an English noun. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
