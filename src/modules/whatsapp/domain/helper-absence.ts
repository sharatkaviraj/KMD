import { istDay } from "./helper-facts";

/**
 * A parent's word that a child will be away (D-588): "Riya bimar hai, aaj
 * nahi aayegi". Claude reads the message (`helper-ai.ts`); this turns what it
 * read into the days the register should show "Parent informed" on. Pure.
 *
 * The days are school days in India, counted from today or tomorrow with
 * Sundays skipped, as the school's week runs. A holiday inside the span is
 * counted as one of them, so a note never reaches past the days the parent
 * named.
 */

export const ABSENCE_REASONS = ["sick", "other"] as const;
export type AbsenceReason = (typeof ABSENCE_REASONS)[number];

/** The most school days one message may cover; a longer absence is for the class teacher to hear about. */
export const MAX_ABSENCE_DAYS = 7;

/** What Claude read in the parent's message: from when, for how many school days, and why. */
export type AbsenceAsk = { from: "today" | "tomorrow"; days: number; reason: AbsenceReason };

/** A note to keep: the days (YYYY-MM-DD, in India) and the reason, in a word. */
export type AbsenceNote = { days: string[]; reason: AbsenceReason };

const DAY_MS = 86_400_000;

/** `days` school days from today or tomorrow, in India; at least one, at most `MAX_ABSENCE_DAYS`. */
export function absenceDays(ask: Pick<AbsenceAsk, "from" | "days">, now: Date): string[] {
  const wanted = Number.isFinite(ask.days) ? Math.min(MAX_ABSENCE_DAYS, Math.max(1, Math.round(ask.days))) : 1;
  let at = Date.parse(`${istDay(now)}T00:00:00Z`) + (ask.from === "tomorrow" ? DAY_MS : 0);
  const days: string[] = [];
  while (days.length < wanted) {
    const day = new Date(at);
    if (day.getUTCDay() !== 0) days.push(day.toISOString().slice(0, 10));
    at += DAY_MS;
  }
  return days;
}

/** The note Claude's reading makes, or null when it read no absence. */
export function absenceNote(ask: AbsenceAsk | null | undefined, now: Date): AbsenceNote | null {
  if (!ask) return null;
  return { days: absenceDays(ask, now), reason: ask.reason === "sick" ? "sick" : "other" };
}
