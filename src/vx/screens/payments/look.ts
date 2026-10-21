import { shownSr } from "@/vx/domain/tell-apart";
import { amountInWords, dayMonth } from "@/vx/format";

/*
 * How the Payment Desk's design writes times, dates and sums
 * (docs/design-handoff PayDesk.dc.html `tm()`, `fd()`, `words()`), kept to
 * this screen so the shared formatters other screens use do not move.
 */

const TZ = "Asia/Kolkata";

function asDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00+05:30`) : new Date(value);
}

/** "10:44 am", in the school's timezone. */
export function ampm(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(asDate(value)).toLowerCase();
}

/** "Thu 8 Oct" (no comma). */
export function shortDate(value: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(asDate(value)).replace(",", "");
}

/** "20 Oct", or "20 Jan 2027" when the date falls in another year than `today`. */
export function dueDay(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? dayMonth(date) : `${dayMonth(date)} ${date.slice(0, 4)}`;
}

/** "frozen at 10:44 am, 8 Oct". */
export function timeAndDay(value: string | Date): string {
  return `${ampm(value)}, ${dayMonth(value)}`;
}

/** "Rupees seven thousand only" — the design writes the words in lower case. */
export function wordsOf(amount: number): string {
  const words = amountInWords(amount);
  return words.replace(/^(Rupees )(.*)$/, (_, head: string, rest: string) => head + rest.toLowerCase());
}

/** "2026-27" → "2026–27" for display; anything else as it is. */
export function sessionDash(label: string): string {
  return label.replace(/(\d{4})-(\d{2})$/, "$1–$2");
}

/** The session before "2026-27" is "2025-26"; null when the label has no years. */
export function previousSession(label: string): string | null {
  const m = /(\d{4})-(\d{2})$/.exec(label);
  if (!m) return null;
  const start = Number(m[1]) - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** "Old balance 2025-26": last session's carry-forward, named by its session. */
export function oldBalanceLabel(word: string, sessionLabel: string): string {
  const prev = previousSession(sessionLabel);
  return prev ? `${word} ${prev}` : word;
}

/**
 * "SR 1234" for the desk and its receipts, or null when there is no SR worth
 * printing: blank, or the office's placeholder for a child whose SR is not
 * given yet ("PENDING-SR-6752", "PENDING-7949-2989"). The desk printed those
 * as SR numbers (smoke 21 Oct); `shownSr` is the one rule for what counts.
 */
export function srTag(sr: string | null | undefined): string | null {
  const shown = shownSr(sr);
  return shown ? `SR ${shown}` : null;
}

/** The parts that are there, joined with " · ". */
export function dotJoin(...parts: readonly (string | null | undefined | false)[]): string {
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join(" · ");
}
