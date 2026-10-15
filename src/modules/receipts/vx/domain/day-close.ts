/**
 * The redesigned Receipts desk and its day close (design `Fees`), as pure
 * functions: no database, no React. Unit-tested in
 * `tests/vx-fee-desk-receipts.test.ts`.
 *
 * Money rules kept here (docs/design-handoff/RULES.md):
 *  - a reversed receipt stays in the list and in history, but it is never
 *    counted in a total;
 *  - the cash counted at the close is compared with the cash the receipts say
 *    came in, and a difference needs a written reason before the day closes.
 */

export type DeskMode = "cash" | "upi" | "cheque" | "bank" | "other";

/** The modes the desk shows, in the design's order. */
export const DESK_MODES: readonly Exclude<DeskMode, "other">[] = ["cash", "upi", "cheque", "bank"];

/** `receipts.payment_mode` → the desk's four buckets. A discount close-out is not money. */
export function deskModeOf(paymentMode: string | null | undefined): DeskMode {
  switch (paymentMode) {
    case "cash":
      return "cash";
    case "upi":
      return "upi";
    case "cheque":
      return "cheque";
    case "bank_transfer":
    case "bank":
      return "bank";
    default:
      return "other";
  }
}

/** Notes and coins in the drawer, largest first. `1` is loose coins counted in rupees. */
export const DENOMINATIONS = [500, 200, 100, 50, 20, 10, 1] as const;

export type Denomination = (typeof DENOMINATIONS)[number];

export type DenominationCounts = Partial<Record<Denomination, number>>;

/** Rupees in the drawer. Negative or fractional counts are treated as 0 / whole. */
export function countedCash(counts: DenominationCounts): number {
  return DENOMINATIONS.reduce((sum, value) => {
    const raw = Number(counts[value] ?? 0);
    const n = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    return sum + value * n;
  }, 0);
}

export type CashDiff = { kind: "match" } | { kind: "short"; amount: number } | { kind: "over"; amount: number };

export function cashDiff(counted: number, expected: number): CashDiff {
  const diff = Math.round(counted) - Math.round(expected);
  if (diff === 0) return { kind: "match" };
  return diff < 0 ? { kind: "short", amount: -diff } : { kind: "over", amount: diff };
}

/** The note has to say something: five characters is the database's own floor. */
export const CLOSE_NOTE_MIN_LENGTH = 5;

/**
 * The day may close when the cash matches (or a reason is written) and UPI has
 * been checked against the bank app. The same rule is a CHECK constraint on
 * `vppsone.fee_day_close_events`, so the button and the table cannot disagree.
 */
export function canCloseDay(input: { counted: number; expected: number; note: string; upiChecked: boolean }): boolean {
  const matches = cashDiff(input.counted, input.expected).kind === "match";
  const explained = input.note.trim().length >= CLOSE_NOTE_MIN_LENGTH;
  return input.upiChecked && (matches || explained);
}

/** Why the close button is not ready yet, for the hint under it. */
export function closeBlocker(input: { counted: number; expected: number; note: string; upiChecked: boolean }): "upi" | "note" | null {
  if (!input.upiChecked) return "upi";
  const matches = cashDiff(input.counted, input.expected).kind === "match";
  if (!matches && input.note.trim().length < CLOSE_NOTE_MIN_LENGTH) return "note";
  return null;
}

export type DeskReceipt = {
  id: string;
  receiptNumber: string;
  paymentDate: string;
  createdAt: string;
  paymentMode: string;
  totalAmount: number;
  isReversed: boolean;
  receivedBy: string | null;
};

export type ModeTotals = Record<DeskMode, { amount: number; count: number }>;

export type DaySummary = {
  /** Money in, reversed receipts left out. */
  net: number;
  /** Receipts that count (not reversed). */
  count: number;
  reversedCount: number;
  byMode: ModeTotals;
};

function emptyModes(): ModeTotals {
  return {
    cash: { amount: 0, count: 0 },
    upi: { amount: 0, count: 0 },
    cheque: { amount: 0, count: 0 },
    bank: { amount: 0, count: 0 },
    other: { amount: 0, count: 0 },
  };
}

export function summarizeReceipts(receipts: readonly DeskReceipt[]): DaySummary {
  const byMode = emptyModes();
  let net = 0;
  let count = 0;
  let reversedCount = 0;
  for (const r of receipts) {
    if (r.isReversed) {
      reversedCount += 1;
      continue;
    }
    const mode = deskModeOf(r.paymentMode);
    // A discount close-out writes a receipt but brings no money in.
    if (mode === "other") continue;
    const amount = Math.round(Number(r.totalAmount) || 0);
    byMode[mode].amount += amount;
    byMode[mode].count += 1;
    net += amount;
    count += 1;
  }
  return { net, count, reversedCount, byMode };
}

export type DayGroup<T extends DeskReceipt> = { date: string; receipts: T[]; net: number };

/** Receipts grouped by day, newest day first; within a day newest first. */
export function groupByDay<T extends DeskReceipt>(receipts: readonly T[]): DayGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const r of receipts) {
    const list = map.get(r.paymentDate) ?? [];
    list.push(r);
    map.set(r.paymentDate, list);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, list]) => {
      const sorted = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return { date, receipts: sorted, net: summarizeReceipts(sorted).net };
    });
}

export type DaySpan = "today" | "yesterday" | "3d";

export const DAY_SPANS: readonly DaySpan[] = ["today", "yesterday", "3d"];

export function isDaySpan(value: unknown): value is DaySpan {
  return typeof value === "string" && (DAY_SPANS as readonly string[]).includes(value);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** `YYYY-MM-DD` plus `days`, in calendar days (no timezone can move it). */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The inclusive `payment_date` range a span covers, anchored on the desk's day. */
export function spanRange(span: DaySpan, anchor: string): { from: string; to: string } {
  if (span === "yesterday") {
    const y = addDays(anchor, -1);
    return { from: y, to: y };
  }
  if (span === "3d") return { from: addDays(anchor, -2), to: anchor };
  return { from: anchor, to: anchor };
}

/** Filters the desk applies on the client: mode, staff, a typed search. */
export type DeskFilters = { mode: DeskMode | "all"; staff: string | "all"; query: string };

export const NO_DESK_FILTERS: DeskFilters = { mode: "all", staff: "all", query: "" };

export function hasDeskFilters(f: DeskFilters): boolean {
  return f.mode !== "all" || f.staff !== "all" || f.query.trim() !== "";
}

export function filterReceipts<T extends DeskReceipt & { studentFullName?: string; classLabel?: string; admissionNo?: string }>(
  receipts: readonly T[],
  f: DeskFilters,
): T[] {
  const q = f.query.trim().toLowerCase();
  return receipts.filter((r) => {
    if (f.mode !== "all" && deskModeOf(r.paymentMode) !== f.mode) return false;
    if (f.staff !== "all" && (r.receivedBy ?? "") !== f.staff) return false;
    if (!q) return true;
    return [r.receiptNumber, r.studentFullName ?? "", r.classLabel ?? "", r.admissionNo ?? ""].some((v) => v.toLowerCase().includes(q));
  });
}

export type CloseEvent = { action: "close" | "reopen"; createdAt: string };

/** The day is closed when its latest event is a close. Reopening is a new row, never a delete. */
export function latestCloseState<T extends CloseEvent>(events: readonly T[]): { closed: boolean; event: T | null } {
  const sorted = [...events].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const latest = sorted[0] ?? null;
  return { closed: latest?.action === "close", event: latest };
}

export type DayBookClosure = { status: string; closedAt: string | null; closedByName: string | null };

/**
 * The close the Day book reports. The day is closed on Receipts now (a row in
 * `vppsone.fee_day_close_events`); the fee app's own finance-controls closure
 * is only read when the desk has no event for the day. Before this the Day
 * book read only the fee app's closure and said "Day not closed" after the
 * accountant had closed it (school-day run, accountant B5).
 */
export function dayBookClosure(
  feeClosure: DayBookClosure | null,
  deskEvents: readonly (CloseEvent & { actorName?: string | null })[],
): DayBookClosure | null {
  const { closed, event } = latestCloseState(deskEvents);
  if (!event) return feeClosure;
  return closed
    ? { status: "closed", closedAt: event.createdAt, closedByName: event.actorName ?? null }
    : { status: "reopened", closedAt: null, closedByName: event.actorName ?? null };
}

/**
 * Receipts posted after the day was closed. Closing does not lock the fee
 * database (that would mean changing the fee RPCs), so the desk flags these
 * instead of pretending they cannot exist.
 */
export function postedAfterClose<T extends DeskReceipt>(receipts: readonly T[], closedAt: string | null): T[] {
  if (!closedAt) return [];
  return receipts.filter((r) => r.createdAt > closedAt);
}

/** The reasons a receipt can be reversed for, as the design lists them. */
export const REVERSAL_REASONS = ["wrong_amount", "wrong_student", "cheque_bounced", "duplicate"] as const;

export type ReversalReason = (typeof REVERSAL_REASONS)[number];

export function isReversalReason(value: unknown): value is ReversalReason {
  return typeof value === "string" && (REVERSAL_REASONS as readonly string[]).includes(value);
}
