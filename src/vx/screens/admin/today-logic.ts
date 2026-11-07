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

/* ------------------------------------------------ money from the Fees ledger */

/** Fees' own "Today" plus its session figures (`/summary/today`, 7 Nov 2026). */
export type LedgerSummary = {
  total: number;
  count: number;
  byMode: { mode: string; label: string; amount: number; count: number }[];
  asOf: string;
  session?: { expected: number; collected: number; dueSoFar: number; followUps: number; recentDays: { date: string; amount: number }[] } | null;
};

/** How many recent collection days Fees sends; a full list may not reach back a whole month. */
export const LEDGER_TREND_DAYS = 14;

/**
 * The real session's money, drawn with the same cards as the rehearsal
 * session's: Fees' Today and session figures in the shape One's own reader
 * gives. No class table (Fees does not send one), and the day series is only
 * known back to its earliest day when the list was full (`knownFrom`), so no
 * chart claims a nought it was never told. Null without session figures.
 */
export function moneyFromLedger(ledger: LedgerSummary, today: string) {
  const session = ledger.session;
  if (!session) return null;
  const days = session.recentDays.filter((d) => d.date !== today).concat(ledger.total > 0 ? [{ date: today, amount: ledger.total }] : []);
  const known = [...session.recentDays].sort((a, b) => a.date.localeCompare(b.date));
  return {
    today: ledger.total,
    receiptsToday: ledger.count,
    days,
    modes: ledger.byMode.map((m) => ({ mode: m.mode, amount: m.amount, receipts: m.count })),
    matrix: [] as { classLabel: string; cells: Record<string, number>; total: number }[],
    installments: [] as string[],
    expected: session.expected,
    collected: session.collected,
    dueSoFar: session.dueSoFar,
    followUps: session.followUps,
    source: "fees" as const,
    asOf: ledger.asOf,
    knownFrom: known.length >= LEDGER_TREND_DAYS ? known[0].date : null,
  };
}

/**
 * How many days back a day chart may reach (at most `max`): all of them,
 * unless the series is only known from a later day.
 */
export function knownSpan(today: string, knownFrom: string | null | undefined, max = 30): number {
  if (!knownFrom) return max;
  const days = Math.round((at(today).getTime() - at(knownFrom).getTime()) / 86_400_000) + 1;
  return Math.max(1, Math.min(max, days));
}

/* --------------------------------------------------------------- birthdays */

/**
 * The dates of birth that fall on `today` for children aged `from`–`to`, so
 * the read can ask for exactly those (`date_of_birth in (…)`) instead of the
 * whole roll. A 29 February birthday is kept on 28 February in other years.
 */
export function birthdayDates(today: string, from = 2, to = 24): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const out: string[] = [];
  for (let year = y - to; year <= y - from; year += 1) {
    out.push(`${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    if (m === 2 && d === 28 && !leap(y) && leap(year)) out.push(`${year}-02-29`);
  }
  return out;
}

/* ----------------------------------------------------- calendar: coming up */

export type CalendarKind = "instructional" | "holiday" | "exam" | "event" | "vacation";
export type CalendarRow = { day: string; kind: CalendarKind; en: string | null; hi: string | null };
/** A calendar event; `kind` as stored ("exam", "ptm", "event", …), an exam drawn as one. */
export type EventRow = { title: string; titleHi: string | null; startsOn: string; endsOn: string; kind?: string };
export type ComingItem = { from: string; to: string; kind: "holiday" | "vacation" | "exam" | "event"; en: string; hi: string | null; inDays: number };

const addDays = (day: string, n: number) => iso(new Date(at(day).getTime() + n * 86_400_000));
const daysBetween = (a: string, b: string) => Math.round((at(b).getTime() - at(a).getTime()) / 86_400_000);
const isSunday = (day: string) => at(day).getUTCDay() === 0;

/** Open on a day: the calendar when it says, otherwise every day but Sunday (`isSchoolOpen`). */
function openOn(day: string, byDay: Map<string, CalendarRow>): boolean {
  const row = byDay.get(day);
  if (row) return row.kind !== "holiday" && row.kind !== "vacation";
  return !isSunday(day);
}

/**
 * When school is closed today: why (the calendar's name for the day, or
 * Sunday), and the next day it opens, looking a little over a month ahead.
 * Null on an open day.
 */
export function closedSpell(today: string, rows: readonly CalendarRow[], lookAhead = 40): { en: string | null; hi: string | null; sunday: boolean; reopens: string | null } | null {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  if (openOn(today, byDay)) return null;
  const row = byDay.get(today);
  let reopens: string | null = null;
  for (let i = 1; i <= lookAhead; i += 1) {
    const day = addDays(today, i);
    if (openOn(day, byDay)) {
      reopens = day;
      break;
    }
  }
  return { en: row?.en ?? null, hi: row?.hi ?? null, sunday: !row && isSunday(today), reopens };
}

/**
 * What is coming on the school calendar in the next `within` days: named
 * closures and exam days (consecutive days with one name read as one item,
 * "Diwali break · 9–12 Nov") and calendar events. A spell already running
 * today is the closed banner's, not this list's. Soonest first, at most `max`.
 */
export function comingUp(today: string, rows: readonly CalendarRow[], events: readonly EventRow[], within = 21, max = 3): ComingItem[] {
  const last = addDays(today, within);
  const named = [...rows]
    .filter((r) => r.kind !== "instructional" && r.kind !== "event" && r.day >= today && r.day <= last)
    .sort((a, b) => a.day.localeCompare(b.day));
  const spells: ComingItem[] = [];
  for (const r of named) {
    const prev = spells[spells.length - 1];
    const label = r.en?.trim() || (r.kind === "exam" ? "Exam" : r.kind === "vacation" ? "Vacation" : "Holiday");
    // Sundays inside a break carry no row; a gap of up to two days still joins the spell.
    if (prev && prev.kind === r.kind && prev.en === label && daysBetween(prev.to, r.day) <= 2) {
      prev.to = r.day;
      continue;
    }
    spells.push({ from: r.day, to: r.day, kind: r.kind as ComingItem["kind"], en: label, hi: r.hi?.trim() || null, inDays: daysBetween(today, r.day) });
  }
  const ahead = spells.filter((s) => s.from > today);
  const happenings: ComingItem[] = events
    .filter((e) => e.endsOn >= today && e.startsOn <= last && e.startsOn > today)
    .map((e) => ({ from: e.startsOn, to: e.endsOn < e.startsOn ? e.startsOn : e.endsOn, kind: e.kind === "exam" ? ("exam" as const) : ("event" as const), en: e.title, hi: e.titleHi, inDays: daysBetween(today, e.startsOn) }));
  return [...ahead, ...happenings].sort((a, b) => a.from.localeCompare(b.from) || a.en.localeCompare(b.en)).slice(0, max);
}

/* ------------------------------------------------------ Today at a glance */

/** A child whose birthday is today, for the "Birthdays today" widget. */
export type BirthdayChild = { id: string; name: string; classLabel: string | null };

/**
 * The small widgets around the school day (7 Nov 2026): why school is closed
 * and when it opens, what is coming on the calendar, and today's birthdays.
 * Each is null when it was not read for this reader or the read failed, so a
 * widget is left out rather than drawn empty.
 */
export type TodayGlance = {
  closed: ReturnType<typeof closedSpell>;
  coming: ComingItem[] | null;
  birthdays: BirthdayChild[] | null;
};

/** "Asha Sharma" → "Asha": the widget names a child the way staff say it. */
export function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? full;
}
