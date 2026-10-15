import { p, type Pair } from "@/vx/text";

/*
 * How the teacher screens write days and times, as the design does:
 * "Thu 8 Oct", "Thursday 8 October", "8:10" on the timeline and "8:52 am" in
 * a sentence. Pure; the school's timezone is applied by the callers' data.
 */

const TZ = "Asia/Kolkata";

function asDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
}

/** "Thu 8 Oct". */
export function dShort(value: string | Date): string {
  const d = asDate(value);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short" }).format(d);
  const dm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "short" }).format(d);
  return `${wd} ${dm}`;
}

/** "Thursday 8 October". */
export function dLong(value: string | Date): string {
  const d = asDate(value);
  const wd = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "long" }).format(d);
  const dm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "numeric", month: "long" }).format(d);
  return `${wd} ${dm}`;
}

/** A bell time "13:30" as the timeline writes it: "1:30". */
export function hm12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")}`;
}

/** An instant as a sentence writes it: "8:52 am". */
export function ampm(value: string | Date): string {
  const d = asDate(value);
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(d);
  const hour = parts.find((x) => x.type === "hour")?.value ?? "";
  const minute = parts.find((x) => x.type === "minute")?.value ?? "";
  const half = (parts.find((x) => x.type === "dayPeriod")?.value ?? "").toLowerCase().replace(/\./g, "");
  return `${hour}:${minute} ${half}`.trim();
}

/** "today 8:10 am", "Yesterday · 4:30 pm", "Mon 5 Oct" — when a notice was sent. */
export function whenSent(iso: string, today: string): Pair {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(asDate(iso));
  if (day === today) return p(`Today · ${ampm(iso)}`, `आज · ${ampm(iso)}`);
  const y = new Date(`${today}T12:00:00+05:30`);
  y.setUTCDate(y.getUTCDate() - 1);
  if (day === new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(y)) return p(`Yesterday · ${ampm(iso)}`, `कल · ${ampm(iso)}`);
  return p(dShort(iso));
}

/** "Good morning" in the school's day, with its Hindi. */
export function greetingPair(minutes: number): Pair {
  const hour = Math.floor(minutes / 60);
  if (hour < 12) return p("Good morning", "सुप्रभात");
  if (hour < 17) return p("Good afternoon", "नमस्कार");
  return p("Good evening", "शुभ संध्या");
}

/** How Today greets a teacher: "Ms. Bhati" when the name carries a title, else the first name. */
export function greetName(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return displayName;
  if (/^(mr|mrs|ms|miss|dr|shri|smt)\.?$/i.test(words[0]) && words.length > 1) return `${words[0]} ${words[words.length - 1]}`;
  return words[0];
}

/**
 * The name for the greeting: the short name staff call her by ("Ravina"),
 * unless it is a roster code ("QATE", "SP") rather than a name — then the
 * first word of the display name (verification ST-15).
 */
export function callName(shortName: string | null | undefined, displayName: string): string {
  const short = shortName?.trim() ?? "";
  if (short && !/^[A-Z0-9]{1,6}$/.test(short)) return short;
  return greetName(displayName);
}

/** "Class 6" → "6", for "Science for 6, 7 and 8". */
export function shortClass(label: string): string {
  return label.replace(/^class\s+/i, "");
}

/** "6, 7 and 8". */
export function andList(items: readonly string[], and = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}
