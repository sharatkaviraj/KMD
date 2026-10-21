/**
 * The admin core's rules (P5): Today, Needs you, Students, Student 360 and the
 * attendance board. Pure — no database, no React — so every rule the screens
 * apply is unit-tested in `tests/vx-admin-logic.test.ts`.
 *
 * Two money rules from RULES.md B hold everywhere below: fees and late fees
 * are separate numbers, and "pending today" and "not due yet" are never added.
 */

import { p, type Pair } from "@/vx/text";
import { spreadsheetText } from "@/platform/helpers/spreadsheet-text";

/* ------------------------------------------------------------ attendance */

export type MarkStatus = "present" | "absent" | "half_day" | "late" | "leave";

export type ClassBoardRow = {
  classId: string;
  label: string;
  /** Position in the school's order (Nursery first). */
  rank: number;
  /** The class teacher today, or null when nobody holds the class. */
  teacherId: string | null;
  teacherName: string | null;
  /** Children on the roll. */
  roll: number;
  /** Saved at least once today (revision ≥ 1). Until then the office sees "Not marked". */
  recorded: boolean;
  savedAt: string | null;
  present: number;
  absent: number;
  halfDay: number;
  /** Late and leave, kept apart from the three the school counts. */
  other: number;
  /** The class teacher is marked away today. */
  teacherAway: boolean;
  /** When a reminder went to the class teacher today, if one did. */
  remindedAt: string | null;
};

export type BoardSummary = {
  total: number;
  marked: number;
  notMarked: number;
  present: number;
  absent: number;
  halfDay: number;
  /** Present share of the marked classes only; null when nothing is marked. */
  percent: number | null;
};

/**
 * The whole-school line. **Counts only marked classes** — a class that is not
 * marked is never treated as all present (RULES C), so it adds nothing to the
 * present count and nothing to the denominator.
 */
export function boardSummary(rows: readonly ClassBoardRow[], halfDayCredit = 0.5): BoardSummary {
  const marked = rows.filter((row) => row.recorded);
  const present = marked.reduce((sum, row) => sum + row.present, 0);
  const absent = marked.reduce((sum, row) => sum + row.absent, 0);
  const halfDay = marked.reduce((sum, row) => sum + row.halfDay, 0);
  const counted = present + absent + halfDay;
  return {
    total: rows.length,
    marked: marked.length,
    notMarked: rows.length - marked.length,
    present,
    absent,
    halfDay,
    percent: counted === 0 ? null : Math.round(((present + halfDay * halfDayCredit) / counted) * 100),
  };
}

export type ClassState = "marked" | "teacher_away" | "reminded" | "not_marked";

export function classState(row: ClassBoardRow): ClassState {
  if (row.recorded) return "marked";
  if (row.teacherAway) return "teacher_away";
  if (row.remindedAt) return "reminded";
  return "not_marked";
}

/** Classes whose teacher can usefully be reminded: not marked, a teacher in school, not reminded yet. */
export function remindable(rows: readonly ClassBoardRow[]): ClassBoardRow[] {
  return rows.filter((row) => !row.recorded && !row.teacherAway && row.teacherId !== null && !row.remindedAt);
}

/** Present share of one marked class, half days at the school's credit. */
export function classPercent(row: Pick<ClassBoardRow, "present" | "absent" | "halfDay">, halfDayCredit = 0.5): number {
  const counted = row.present + row.absent + row.halfDay;
  if (counted === 0) return 0;
  return Math.round(((row.present + row.halfDay * halfDayCredit) / counted) * 100);
}

export function sortBoard(rows: readonly ClassBoardRow[]): ClassBoardRow[] {
  return [...rows].sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label, "en"));
}

export type BoardFilter = "all" | "pending" | "marked";

export function filterBoard(rows: readonly ClassBoardRow[], filter: BoardFilter): ClassBoardRow[] {
  if (filter === "pending") return rows.filter((row) => !row.recorded);
  if (filter === "marked") return rows.filter((row) => row.recorded);
  return [...rows];
}

/**
 * The class the board's desk panel opens on when nobody has picked one: the
 * first class still not marked whose teacher is away, since only the office
 * can mark it (design D04 opens on Class 9, "teacher on leave"). None when
 * every such class is marked; the panel then asks for a class.
 */
export function defaultBoardFocus(rows: readonly ClassBoardRow[]): string | null {
  return sortBoard(rows).find((row) => !row.recorded && row.teacherAway)?.classId ?? null;
}

/**
 * The marks a sheet opens with. A saved register opens as it was saved; a new
 * one opens with **everyone present** and the person taps the exceptions
 * (RULES C).
 */
export function initialMarks(
  roll: readonly { studentId: string }[],
  saved: Readonly<Record<string, MarkStatus>>,
): Record<string, MarkStatus | null> {
  const hasSaved = Object.keys(saved).length > 0;
  return Object.fromEntries(roll.map((s) => [s.studentId, hasSaved ? (saved[s.studentId] ?? null) : "present"]));
}

export function markCounts(marks: Readonly<Record<string, MarkStatus | null>>): {
  marked: number;
  unmarked: number;
  present: number;
  absent: number;
  halfDay: number;
} {
  const values = Object.values(marks);
  const count = (status: MarkStatus) => values.filter((v) => v === status).length;
  const marked = values.filter((v) => v !== null).length;
  return { marked, unmarked: values.length - marked, present: count("present"), absent: count("absent"), halfDay: count("half_day") };
}

/** "Period 2 running", from the school's bells; null before the first and after the last. */
export function runningPeriod(
  periods: readonly { index: number; starts: string; ends: string }[],
  nowMinutes: number,
): { index: number; number: number; state: "running" | "break" } | null {
  const toMin = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };
  const sorted = [...periods].sort((a, b) => toMin(a.starts) - toMin(b.starts));
  for (let i = 0; i < sorted.length; i += 1) {
    const p = sorted[i];
    if (nowMinutes >= toMin(p.starts) && nowMinutes < toMin(p.ends)) return { index: p.index, number: p.index + 1, state: "running" };
    const next = sorted[i + 1];
    if (next && nowMinutes >= toMin(p.ends) && nowMinutes < toMin(next.starts)) return { index: p.index, number: p.index + 1, state: "break" };
  }
  return null;
}

/** Minutes since midnight in the school's timezone. */
export function schoolMinutes(now: Date = new Date()): number {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(now)
    .split(":")
    .map(Number);
  return (h % 24) * 60 + m;
}

/* ----------------------------------------------------- student support */

/**
 * The Today card's two support figures, by the notes board's own rules
 * (`needsAction` / `isDue` in `vx/screens/notes/domain/notes.ts`): a note
 * needs action when its follow-up is due, or when it is an open health or
 * family note nobody has picked up. `due` is the follow-ups alone.
 */
// TODO: use noteAttention() from notes/domain/notes
export function supportAttention(
  notes: readonly { status: string; needsFollowUp: boolean; followUpOn: string | null; tags: readonly string[] }[],
  today: string,
): { needsAction: number; due: number } {
  let needsAction = 0;
  let due = 0;
  for (const note of notes) {
    if (note.status === "done") continue;
    const isDue = note.needsFollowUp && note.followUpOn !== null && note.followUpOn <= today;
    if (isDue) due += 1;
    if (isDue || (note.status === "open" && !note.needsFollowUp && note.tags.some((t) => t === "health" || t === "family"))) needsAction += 1;
  }
  return { needsAction, due };
}

/* ----------------------------------------------------------------- money */

export type InstallmentLike = {
  installmentNo: number;
  installmentLabel: string;
  dueDate: string;
  isCarryForward?: boolean;
  baseCharge: number;
  feeSettledAmount: number;
  pendingAmount: number;
  lateFeePending: number;
  balanceStatus: "paid" | "partial" | "overdue" | "pending" | "waived";
};

export type StudentMoney = {
  /** Fees overdue today. Never contains a late fee. */
  pendingToday: number;
  /** Fees whose installment is not due yet. Never added to `pendingToday`. */
  notDueYet: number;
  /** Late fee, its own number. */
  lateFee: number;
  paid: number;
  total: number;
  /** Share of the year's fees paid, 0–100. */
  percent: number;
};

/**
 * One child's money, from the fee app's own installment rows. Nothing here
 * recomputes a fee: it only sorts what the fee app already settled into the
 * three numbers RULES B names, and keeps them apart.
 */
export function moneyFromInstallments(rows: readonly InstallmentLike[], today?: string): StudentMoney {
  let pendingToday = 0;
  let notDueYet = 0;
  let lateFee = 0;
  let paid = 0;
  let total = 0;
  for (const row of rows) {
    total += row.baseCharge;
    paid += row.feeSettledAmount;
    lateFee += row.lateFeePending;
    if (row.balanceStatus === "waived" || row.pendingAmount <= 0) continue;
    if (isDue(row, today)) pendingToday += row.pendingAmount;
    else notDueYet += row.pendingAmount;
  }
  return { pendingToday, notDueYet, lateFee, paid, total, percent: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0 };
}

/** Overdue by the fee app's own word, or — for a part-paid row — by its due date having passed. */
function isDue(row: Pick<InstallmentLike, "balanceStatus" | "dueDate">, today?: string): boolean {
  if (row.balanceStatus === "overdue") return true;
  return Boolean(today && row.dueDate && row.dueDate.slice(0, 10) < today && row.balanceStatus !== "paid");
}

export type InstallmentState = "paid" | "overdue" | "part" | "upcoming" | "waived";

export function installmentState(
  row: Pick<InstallmentLike, "balanceStatus" | "feeSettledAmount" | "pendingAmount" | "dueDate">,
  today?: string,
): InstallmentState {
  if (row.balanceStatus === "waived") return "waived";
  if (row.balanceStatus === "paid" || row.pendingAmount <= 0) return "paid";
  if (isDue(row, today)) return "overdue";
  return row.feeSettledAmount > 0 ? "part" : "upcoming";
}

/** What a row on the students list says on the right (F05). */
export function feeStanding(money: { pendingToday: number; notDueYet: number }): "pending" | "on_track" | "paid" {
  if (money.pendingToday > 0) return "pending";
  if (money.notDueYet > 0) return "on_track";
  return "paid";
}

/** The list's figures from the fee directory row: overdue fees, then what is left that is not due. */
export function listMoney(row: { overdueAmount: number; outstandingAmount: number; pendingLateFeeAmount: number; totalPaid: number; totalDue: number; lateFeeTotal: number }): {
  pendingToday: number;
  notDueYet: number;
  lateFee: number;
  percent: number;
} {
  const pendingToday = Math.max(0, row.overdueAmount);
  // `outstandingAmount` is fees only — on dev it equals the installments'
  // pending fees for all 593 children — so the late fee is not taken off it
  // again. Doing so showed a new admission ₹2,000 short (verification N6).
  const notDueYet = Math.max(0, row.outstandingAmount - pendingToday);
  const fees = Math.max(0, row.totalDue - row.lateFeeTotal);
  return {
    pendingToday,
    notDueYet,
    lateFee: Math.max(0, row.pendingLateFeeAmount),
    percent: fees > 0 ? Math.min(100, Math.round((Math.min(row.totalPaid, fees) / fees) * 100)) : 100,
  };
}

/** Day totals for the last `days` days ending today, with empty days as 0. */
export function dailySeries(points: readonly { date: string; amount: number }[], today: string, days: number): { date: string; amount: number }[] {
  const byDay = new Map<string, number>();
  for (const p of points) byDay.set(p.date.slice(0, 10), (byDay.get(p.date.slice(0, 10)) ?? 0) + Number(p.amount || 0));
  const out: { date: string; amount: number }[] = [];
  const base = new Date(`${today}T12:00:00Z`).getTime();
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(base - i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date, amount: byDay.get(date) ?? 0 });
  }
  return out;
}

/** Average of the days money came in, excluding today; and today against it, in percent. */
export function vsAverage(series: readonly { date: string; amount: number }[], today: string): { average: number; deltaPct: number | null; best: number; emptyDays: number } {
  const past = series.filter((p) => p.date !== today);
  const taken = past.filter((p) => p.amount > 0);
  const average = taken.length ? Math.round(taken.reduce((s, p) => s + p.amount, 0) / taken.length) : 0;
  const now = series.find((p) => p.date === today)?.amount ?? 0;
  return {
    average,
    deltaPct: average > 0 ? Math.round((now / average - 1) * 100) : null,
    best: Math.max(0, ...series.map((p) => p.amount)),
    emptyDays: series.filter((p) => p.amount <= 0).length,
  };
}

/**
 * Year pace (D-Today): what is collected against what the installments due so
 * far say should be. Late fees are not in either side.
 */
export function yearPace(input: { expected: number; collected: number; dueSoFar: number }): {
  percent: number;
  shouldPercent: number;
  behind: number;
} {
  const { expected, collected, dueSoFar } = input;
  if (expected <= 0) return { percent: 0, shouldPercent: 0, behind: 0 };
  return {
    percent: Math.round((collected / expected) * 100),
    shouldPercent: Math.round((Math.min(dueSoFar, expected) / expected) * 100),
    behind: Math.max(0, Math.round(dueSoFar - collected)),
  };
}

/* ------------------------------------------------------------- needs you */

export type InboxType = "attendance" | "money" | "timetable" | "students" | "system";

export const INBOX_TYPES: readonly InboxType[] = ["attendance", "money", "timetable", "students", "system"];

/** The order the queue is read in: what blocks the school day first, then newest. */
const TYPE_WEIGHT: Record<InboxType, number> = { attendance: 0, timetable: 1, students: 2, money: 3, system: 4 };

export function sortInbox<T extends { type: InboxType; at: string | null; urgent?: boolean }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (Boolean(a.urgent) !== Boolean(b.urgent)) return a.urgent ? -1 : 1;
    if (a.urgent && b.urgent && TYPE_WEIGHT[a.type] !== TYPE_WEIGHT[b.type]) return TYPE_WEIGHT[a.type] - TYPE_WEIGHT[b.type];
    return (b.at ?? "").localeCompare(a.at ?? "");
  });
}

export function inboxCounts<T extends { type: InboxType }>(items: readonly T[]): Record<"all" | InboxType, number> {
  const out = { all: items.length, attendance: 0, money: 0, timetable: 0, students: 0, system: 0 };
  for (const item of items) out[item.type] += 1;
  return out;
}

/** "Today 9:20", "Yesterday", "3 days ago", "8 Oct". */
export function whenLabel(iso: string | null, now: Date = new Date()): string {
  if (!iso) return "";
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(d);
  const then = new Date(iso);
  const a = new Date(`${day(then)}T12:00:00Z`).getTime();
  const b = new Date(`${day(now)}T12:00:00Z`).getTime();
  const days = Math.round((b - a) / 86_400_000);
  if (days <= 0) {
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: false }).format(then);
    return `Today ${time}`;
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(then);
}

/**
 * When a cover item is for, not when it was recorded: Thursday's periods
 * arranged at 23:14 on Wednesday read "Today" on Thursday, never "Yesterday"
 * (school-day run B16).
 */
export function coverDayLabel(day: string, now: Date = new Date()): Pair {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
  const days = Math.round((at(day) - at(today)) / 86_400_000);
  if (days === 0) return p("Today", "आज");
  if (days === 1) return p("Tomorrow", "कल");
  const label = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${day}T12:00:00Z`));
  return p(label, label);
}

/* --------------------------------------------------------------- students */

export type StudentSegment = "all" | "pending" | "bus" | "new" | "paid";

export const STUDENT_SEGMENTS: readonly StudentSegment[] = ["all", "pending", "bus", "new", "paid"];

export function parseSegment(value: string | undefined | null): StudentSegment {
  return (STUDENT_SEGMENTS as readonly string[]).includes(value ?? "") ? (value as StudentSegment) : "all";
}

/**
 * Every fee filter on the Students list: the four quick chips, and the rest
 * the phone's Filter sheet offers (UI-94). Each is one of the fee app's saved
 * views, so a count and a list always mean the same children.
 */
export type StudentFilter = Exclude<StudentSegment, "all"> | "late" | "never" | "part" | "emi" | "emiMissed" | "old" | "concession" | "noPhone";

/** The order filters are listed, written into a URL and shown as chips. */
export const STUDENT_FILTERS: readonly StudentFilter[] = ["pending", "late", "never", "part", "paid", "emi", "emiMissed", "old", "bus", "new", "concession", "noPhone"];

/** The four that also sit as quick chips above the list. */
export const QUICK_FILTERS: readonly StudentFilter[] = ["pending", "bus", "new", "paid"];

/**
 * `?seg=pending,bus` → the filters, known ones only, once each, in list
 * order. An old one-chip link (`?seg=pending`) reads the same as before.
 */
export function parseStudentFilters(value: string | undefined | null): StudentFilter[] {
  const asked = new Set((value ?? "").split(",").map((s) => s.trim()));
  return STUDENT_FILTERS.filter((f) => asked.has(f));
}

/** The one quick chip a filter list amounts to, or "all" — the chip row lights it. */
export function quickSegment(filters: readonly StudentFilter[]): StudentSegment {
  return filters.length === 1 && QUICK_FILTERS.includes(filters[0]) ? (filters[0] as StudentSegment) : "all";
}

export type StudentTab = "overview" | "fees" | "attendance" | "marks" | "family" | "documents" | "notes" | "history" | "info";

export const STUDENT_TABS: readonly StudentTab[] = ["overview", "fees", "attendance", "marks", "family", "documents", "notes", "history", "info"];

/** The tabs this reader may open. The fee tab exists only for `fees:view` (teachers never see money). */
export function tabsFor(perms: { fees: boolean; documents: boolean; notes: boolean; history: boolean; marks: boolean }): StudentTab[] {
  return STUDENT_TABS.filter((tab) => {
    // The family is the fee app's linked siblings, so it travels with the fee tab.
    if (tab === "fees" || tab === "family") return perms.fees;
    if (tab === "documents") return perms.documents;
    if (tab === "notes") return perms.notes;
    if (tab === "history") return perms.history;
    if (tab === "marks") return perms.marks;
    return true;
  });
}

export function parseTab(value: string | undefined | null, allowed: readonly StudentTab[]): StudentTab {
  return allowed.includes(value as StudentTab) ? (value as StudentTab) : "overview";
}

/**
 * A term's percentage counts only the papers that have a mark (`totalsFor`
 * leaves a blank paper out of both halves), so while any paper is blank the
 * percentage and its grade are provisional and must say so beside them.
 * `total` is the papers the child sat or still has to be marked on — exempt
 * papers left out. Null once every paper is entered: the term is final.
 */
export function provisionalLabel(missing: number, total: number): Pair | null {
  if (missing <= 0) return null;
  if (total > 0 && missing >= total) return p("Provisional · no papers entered yet", "अस्थायी · अभी किसी पेपर के अंक नहीं");
  return p(`Provisional · ${missing} paper${missing === 1 ? "" : "s"} not entered`, `अस्थायी · ${missing} पेपर के अंक बाकी`);
}

/** Last `weeks` school weeks of a child's attendance as calendar cells, Monday–Saturday. */
export function recentWeeks(
  marks: readonly { day: string; status: MarkStatus }[],
  today: string,
  weeks = 4,
  closed: (day: string) => boolean = () => false,
): { day: string; label: string; state: MarkStatus | "today" | "future" | "closed" | "none" }[] {
  const byDay = new Map(marks.map((m) => [m.day, m.status]));
  const t = new Date(`${today}T12:00:00Z`);
  const dow = (t.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(t.getTime() - dow * 86_400_000);
  const start = new Date(monday.getTime() - (weeks - 1) * 7 * 86_400_000);
  const out: { day: string; label: string; state: MarkStatus | "today" | "future" | "closed" | "none" }[] = [];
  for (let w = 0; w < weeks; w += 1) {
    for (let d = 0; d < 6; d += 1) {
      const date = new Date(start.getTime() + (w * 7 + d) * 86_400_000);
      const day = date.toISOString().slice(0, 10);
      const saved = byDay.get(day);
      let state: (typeof out)[number]["state"];
      if (day > today) state = "future";
      else if (saved) state = saved;
      else if (closed(day)) state = "closed";
      else if (day === today) state = "today";
      else state = "none";
      out.push({ day, label: String(date.getUTCDate()), state });
    }
  }
  return out;
}

export type MonthCell = { day: string | null; label: string; state: MarkStatus | "today" | "future" | "closed" | "none" | "blank" };

/**
 * This month's register for one child, Monday first, as the design's
 * attendance tab draws it (F06 attendance, D02): leading blanks, then every
 * day with what was saved. "Not marked" stays `none` and is never counted as
 * present; the percentage is over the days that were marked, with leave left
 * out and a half day worth `halfDayCredit`, as the register sheet counts.
 */
export function monthGrid(
  marks: readonly { day: string; status: MarkStatus }[],
  today: string,
  closed: (day: string) => boolean = () => false,
  halfDayCredit = 0.5,
): { month: string; cells: MonthCell[]; present: number; marked: number; percent: number | null; lastAbsent: string | null } {
  const month = today.slice(0, 7);
  const byDay = new Map(marks.filter((m) => m.day.startsWith(month)).map((m) => [m.day, m.status]));
  const first = new Date(`${month}-01T12:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const cells: MonthCell[] = Array.from({ length: lead }, () => ({ day: null, label: "", state: "blank" as const }));
  let present = 0;
  let marked = 0;
  let credit = 0;
  let lastAbsent: string | null = null;
  for (let d = 1; d <= days; d += 1) {
    const day = `${month}-${String(d).padStart(2, "0")}`;
    const saved = byDay.get(day);
    let state: MonthCell["state"];
    // A Sunday or holiday is shown as one ahead of time too, as the design does.
    if (saved && day <= today) state = saved;
    else if (closed(day)) state = "closed";
    else if (day > today) state = "future";
    else if (day === today) state = "today";
    else state = "none";
    if (saved && saved !== "leave") {
      marked += 1;
      if (saved === "present" || saved === "late") {
        present += 1;
        credit += 1;
      } else if (saved === "half_day") credit += halfDayCredit;
      else if (saved === "absent") lastAbsent = day;
    }
    cells.push({ day, label: String(d), state });
  }
  return { month, cells, present, marked, percent: marked ? Math.round((credit / marked) * 100) : null, lastAbsent };
}

/** Average of a set of percentages, rounded; null for none. */
export function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

/**
 * The Students list as a URL: search, class, view, filters, layout and page —
 * empty values left out. The view is written whenever it is given, so a link
 * opens the view it was made in whatever the reader last chose; the layout
 * likewise. `segs` (any filters) wins over `seg` (one quick chip).
 */
export function studentsHref(query: {
  q?: string;
  classId?: string | null;
  view?: "school" | "fees";
  seg?: StudentSegment;
  segs?: readonly StudentFilter[];
  look?: "cards" | "compact" | "class";
  page?: number;
}): string {
  const params = new URLSearchParams();
  const q = (query.q ?? "").trim();
  if (q) params.set("q", q);
  if (query.classId) params.set("class", query.classId);
  if (query.view) params.set("view", query.view);
  const segs = query.segs ? STUDENT_FILTERS.filter((f) => query.segs!.includes(f)) : query.seg && query.seg !== "all" ? [query.seg] : [];
  if (segs.length) params.set("seg", segs.join(","));
  if (query.look) params.set("look", query.look);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  // A comma reads as itself in a query string; "%2C" only makes links harder to read.
  const search = params.toString().replace(/%2C/g, ",");
  return search ? `/students?${search}` : "/students";
}

/** A ten-digit Indian mobile for tel:/wa.me links, or null. */
export function mobileOf(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  const ten = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return /^[6-9]\d{9}$/.test(ten) ? ten : null;
}

/** CSV for the selected rows (Students → Export). Quotes every cell. */
export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const cell = (v: string | number | null) => `"${spreadsheetText(v).replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

/* ---------------------------------------------------------- fee ribbon */

export type FeeRibbon =
  | { kind: "overdue"; overdue: number; lateFee: number }
  | { kind: "credit"; credit: number }
  | { kind: "clear" }
  | { kind: "next"; label: string; amount: number; dueDate: string }
  | { kind: "outstanding" };

/**
 * The one sentence above a child's fee figures, as the fee app's
 * `StudentMoneyBand` picks it: what the office must act on first wins, and
 * only one ever shows. Overdue fees outrank a credit; the late fee rides along
 * with the overdue sentence and never makes a child overdue by itself.
 */
export function feeRibbon(summary: {
  overdue: number;
  lateFeePending: number;
  creditBalance: number;
  outstanding: number;
  nextDue: { label: string; amount: number; dueDate: string } | null;
}): FeeRibbon {
  if (summary.overdue > 0) return { kind: "overdue", overdue: summary.overdue, lateFee: summary.lateFeePending };
  if (summary.creditBalance > 0) return { kind: "credit", credit: summary.creditBalance };
  if (summary.outstanding <= 0) return { kind: "clear" };
  if (summary.nextDue) return { kind: "next", ...summary.nextDue };
  return { kind: "outstanding" };
}
