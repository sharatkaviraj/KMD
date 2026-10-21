/**
 * The one rule for "is this installment's fee pending today?", used by every
 * money screen: the Payment Desk, Dues & calls, Reports, Accounts Today, the
 * Students list and Student 360. Pure.
 *
 * It is the ledger's own rule (`private.workbook_installment_snapshot`:
 * `when p_as_of_date > due_date then 'overdue'`) and the school's: the late
 * fee starts the day AFTER the due date, so the due date itself is free.
 *
 *  - `overdue`   — due before today. This is "pending today".
 *  - `due_today` — due today. Can be taken today, not yet late.
 *  - `not_due`   — due after today. "Not due yet"; never added to pending.
 *
 * Last session's balance carried forward is always overdue.
 *
 * Smoke school day, 20 Oct: Reports counted an installment due today as
 * pending (`<=`) while the Desk and Dues did not (`<`), so "pending today"
 * read ₹52.7 L on one screen and ₹26.6 L on another. And the fee views'
 * `balance_status` is materialized with the date of its last refresh, so just
 * after midnight on the day after a due date the Students list still called
 * the installment "not due" while Student 360 called it overdue.
 */

export type DueBucket = "overdue" | "due_today" | "not_due";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;

/** `YYYY-MM-DD` of a date or timestamp string, or "" when there is none. */
function dayOf(value: string | null | undefined): string {
  const v = String(value ?? "");
  return ISO_DAY.test(v) ? v.slice(0, 10) : "";
}

export function dueBucketOn(
  row: { dueDate: string | null | undefined; isCarryForward?: boolean | null },
  today: string,
): DueBucket {
  if (row.isCarryForward) return "overdue";
  const due = dayOf(row.dueDate);
  const on = dayOf(today);
  if (!due || !on) return "not_due";
  if (due < on) return "overdue";
  return due === on ? "due_today" : "not_due";
}

/** Pending today: due before today (or last session's balance). */
export function isPendingOn(row: { dueDate: string | null | undefined; isCarryForward?: boolean | null }, today: string): boolean {
  return dueBucketOn(row, today) === "overdue";
}

export type BalanceStatus = "paid" | "partial" | "overdue" | "pending" | "waived";

/**
 * A row's `balance_status` as of `today`. The view's status is right about
 * paid and waived, but its overdue/pending/partial was decided on the day the
 * view was last refreshed; this decides it again for `today`, by the ledger's
 * own rule, from the row's own fees settled and pending.
 */
export function balanceStatusOn(
  row: { balanceStatus: BalanceStatus; dueDate: string | null | undefined; isCarryForward?: boolean | null; pendingAmount: number; feeSettledAmount?: number | null },
  today: string,
): BalanceStatus {
  if (row.balanceStatus === "waived" || row.balanceStatus === "paid") return row.balanceStatus;
  if (!(Number(row.pendingAmount) > 0)) return "paid";
  if (isPendingOn(row, today)) return "overdue";
  return Number(row.feeSettledAmount ?? 0) > 0 ? "partial" : "pending";
}

export type FeesByDue = {
  /** Fees due before today. Never contains a late fee. */
  pendingToday: number;
  /** Fees on an installment due today. */
  dueToday: number;
  /** Fees due after today. */
  notDueYet: number;
};

/** Fees still owed, split by the rule above. Waived rows owe nothing. */
export function splitFeesByDue(
  rows: readonly { dueDate: string | null | undefined; isCarryForward?: boolean | null; pendingAmount: number; balanceStatus?: string | null }[],
  today: string,
): FeesByDue {
  const out: FeesByDue = { pendingToday: 0, dueToday: 0, notDueYet: 0 };
  for (const row of rows) {
    if (row.balanceStatus === "waived") continue;
    const pending = Math.max(0, Math.trunc(Number(row.pendingAmount) || 0));
    if (pending === 0) continue;
    const bucket = dueBucketOn(row, today);
    if (bucket === "overdue") out.pendingToday += pending;
    else if (bucket === "due_today") out.dueToday += pending;
    else out.notDueYet += pending;
  }
  return out;
}

/**
 * The date most rows of one installment fall due on. Installment rows carry
 * their own due dates, and a few can differ from the rest; a column heading
 * names the usual one, never the earliest outlier ("Inst 3 · 1 Oct" was shown
 * while nearly every child's Installment 3 fell due on 20 Oct).
 */
export function usualDueDate(dates: readonly string[]): { date: string | null; varies: boolean } {
  const counts = new Map<string, number>();
  for (const d of dates) {
    const day = dayOf(d);
    if (day) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [day, n] of counts) {
    if (n > bestN || (n === bestN && best !== null && day < best)) {
      best = day;
      bestN = n;
    }
  }
  return { date: best, varies: counts.size > 1 };
}
