/**
 * The admin Today's drawing rules, as the design computes them (App.dc.html
 * "today", Desktop.dc.html "today"). Pure — no React, no database — so each
 * is unit-tested in `tests/vx-admin-today.test.ts`.
 *
 * Money rules hold here as everywhere (RULES B): fees and late fees are not
 * mixed, and "pending today" never takes in an installment not yet due.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const at = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The design's short money (`kfmt`): ₹950, ₹4.2k, ₹19k, ₹1.2L; nought is "—". */
export function kfmt(value: number): string {
  const n = Math.round(Number(value) || 0);
  if (n <= 0) return "—";
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  if (n >= 1_000) return `₹${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return `₹${n}`;
}

export type ChartBar = {
  date: string;
  amount: number;
  /** Bar height as a share of the chart, 0–100. */
  height: number;
  isToday: boolean;
  /** "9 Sep" on the first bar and the 1st of a month, "13" otherwise; the screen says "Today" on today's. */
  label: string;
  showLabel: boolean;
  /** "Thu 8 Oct", for the hover tip. */
  day: string;
  sunday: boolean;
};

export type MoneyChart = {
  bars: ChartBar[];
  /** Mean of every day in the range, empty days included (the design's "Avg ₹26,830 a day"). */
  average: number;
  best: number;
  emptyDays: number;
  /** Where the average line sits, 0–100. */
  averageAt: number;
  /** Three dashed grid lines at a quarter, half and three quarters. */
  grid: { at: number; label: string }[];
};

/**
 * The "Money taken" bars for a run of day totals ending today (oldest first,
 * as `dailySeries` gives them). The top of the chart is the best day plus 8%,
 * as drawn; labels every other day for 14 days and every fourth for 30.
 */
export function moneyChart(series: readonly { date: string; amount: number }[], today: string): MoneyChart {
  const amounts = series.map((p) => Math.max(0, Number(p.amount) || 0));
  const best = amounts.length ? Math.max(...amounts) : 0;
  const top = best * 1.08;
  const average = amounts.length ? Math.round(amounts.reduce((s, v) => s + v, 0) / amounts.length) : 0;
  const every = series.length <= 14 ? 2 : 4;
  const bars = series.map((p, i): ChartBar => {
    const d = at(p.date);
    const isToday = p.date.slice(0, 10) === today;
    const date = d.getUTCDate();
    const month = MONTHS[d.getUTCMonth()];
    return {
      date: p.date.slice(0, 10),
      amount: amounts[i],
      height: top > 0 ? (amounts[i] / top) * 100 : 0,
      isToday,
      label: `${date}${date === 1 || i === 0 ? ` ${month}` : ""}`,
      showLabel: isToday || i % every === 0,
      day: `${WEEKDAYS[d.getUTCDay()]} ${date} ${month}`,
      sunday: d.getUTCDay() === 0,
    };
  });
  return {
    bars,
    average,
    best,
    emptyDays: amounts.filter((v) => v <= 0).length,
    averageAt: top > 0 ? (average / top) * 100 : 0,
    grid: top > 0 ? [0.25, 0.5, 0.75].map((f) => ({ at: f * 100, label: kfmt(Math.round((top * f) / 1000) * 1000) })) : [],
  };
}

/** Monday to Saturday of the week `today` falls in (a Sunday belongs to the week before it). */
export function schoolWeek(today: string): string[] {
  const d = at(today);
  const back = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - back * 86_400_000);
  return Array.from({ length: 6 }, (_, i) => iso(new Date(monday.getTime() + i * 86_400_000)));
}

/** `weekday` is 0 (Sunday) to 6; the screen names it in the reader's language. */
export type WeekBar = { day: string; weekday: number; percent: number | null; isToday: boolean };

/**
 * "Attendance this week": a bar per school day, today's from the live board.
 * A day with nothing marked — closed, future, or simply not taken — is a
 * dash, never a nought, because "not marked" is never counted (RULES C).
 */
export function weekBars(today: string, past: readonly { day: string; percent: number | null }[], todayPercent: number | null): WeekBar[] {
  const byDay = new Map(past.map((row) => [row.day, row.percent]));
  return schoolWeek(today).map((day) => ({
    day,
    weekday: at(day).getUTCDay(),
    percent: day === today ? todayPercent : day < today ? (byDay.get(day) ?? null) : null,
    isToday: day === today,
  }));
}

/** Present share of one day's marks, half days at the school's credit; null when nothing counted. */
export function dayPercent(t: { present: number; absent: number; halfDay: number }, halfDayCredit = 0.5): number | null {
  const counted = t.present + t.absent + t.halfDay;
  if (counted === 0) return null;
  return Math.round(((t.present + t.halfDay * halfDayCredit) / counted) * 100);
}

/**
 * What a day would close today's gap by the end of this month: the design's
 * "Clearing ₹3,300 a day for the remaining 23 days of October". Rounded up to
 * ₹100. Null when nothing is behind or the month has no days left.
 */
export function catchUp(behind: number, today: string): { perDay: number; daysLeft: number; month: number } | null {
  if (!(behind > 0)) return null;
  const d = at(today);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = last - d.getUTCDate();
  if (daysLeft <= 0) return null;
  // `month` is 0–11; the screen names it in the reader's language.
  return { perDay: Math.ceil(behind / daysLeft / 100) * 100, daysLeft, month: d.getUTCMonth() };
}

/** `label` is the due month ("Sep"); an old balance has `carry` and the screen names it. */
export type DueColumn = { key: string; label: string; title: string; carry: boolean };

/**
 * The heat table's columns: the old balance and every installment already past
 * its due date. An installment falling due today or later is "not due yet" and
 * is left out, so a row total is pending-today money only (RULES B, UI-74).
 */
export function dueColumns(
  installments: readonly string[],
  dueDates: Readonly<Record<string, string | null>> | undefined,
  carryForward: readonly string[] | undefined,
  today: string,
): DueColumn[] | null {
  if (!dueDates) return null;
  const carry = new Set(carryForward ?? []);
  return installments
    .filter((key) => carry.has(key) || (dueDates[key] ?? "9999") < today)
    .map((key) => {
      if (carry.has(key)) return { key, label: key, title: key, carry: true };
      const due = dueDates[key];
      const month = due ? MONTHS[at(due).getUTCMonth()] : key;
      return { key, label: month, title: `${key}${due ? ` (${month})` : ""}`, carry: false };
    });
}
