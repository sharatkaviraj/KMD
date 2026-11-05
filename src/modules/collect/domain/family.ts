/**
 * The amount card's arithmetic (plan §3.3 card 3): what a child owes, the up
 * to four suggestions (O · N · Y · L), and — for a family — how one amount is
 * divided between the children (D8: oldest dues first by default, or child by
 * child, or by hand).
 *
 * Fees and late fees stay apart. A late fee is taken only when the cashier
 * collects it (the waiver is the default for anyone allowed to waive), and
 * then right after the fees it belongs to — the order the ledger settles in.
 * Each child is posted as its own payment; the ledger then splits that
 * child's amount across their own installments, so all this decides is each
 * child's share.
 */

import { deskChips, isOverdueOn, orderForSettlement, type DeskLedgerRow } from "@/modules/payments/vx/domain/desk";

export type ChildMoney = {
  id: string;
  rows: readonly DeskLedgerRow[];
  /** The late fee is being collected (not waived) for this child. */
  takeLate: boolean;
};

export type SplitRule = "oldest" | "child" | "manual";

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0);

export function childTotals(child: ChildMoney, onDate: string) {
  let fees = 0;
  let late = 0;
  let overdueFees = 0;
  for (const row of child.rows) {
    fees += whole(row.feesPending);
    late += whole(row.lateFeePending);
    if (isOverdueOn(row, onDate)) overdueFees += whole(row.feesPending);
  }
  return { fees, late, overdueFees, max: fees + (child.takeLate ? late : 0) };
}

/** The most this payment may be: every child's fees, plus late fees being collected. */
export function familyMax(children: readonly ChildMoney[], onDate: string): number {
  return children.reduce((sum, child) => sum + childTotals(child, onDate).max, 0);
}

/**
 * Each child's share of `total`, in the children's order.
 *  - oldest: the oldest unpaid installment across all the children first; on
 *    the same due date the child listed first goes first.
 *  - child: clear the first child fully, then the next.
 *  - manual: what was typed for each child (missing = 0).
 * Money beyond what everyone owes is left unassigned (the card blocks it).
 */
export function splitFamily(
  children: readonly ChildMoney[],
  total: number,
  rule: SplitRule,
  manual: Readonly<Record<string, number>> = {},
): number[] {
  if (rule === "manual") return children.map((child) => whole(manual[child.id] ?? 0));
  let left = whole(total);
  if (rule === "child") {
    return children.map((child) => {
      const take = Math.min(left, childTotals(child, "9999-12-31").max);
      left -= take;
      return take;
    });
  }
  const queue = children.flatMap((child, childIndex) =>
    orderForSettlement(child.rows).map((row) => ({ child, childIndex, row })),
  );
  queue.sort((a, b) => {
    if (a.row.dueDate !== b.row.dueDate) return a.row.dueDate < b.row.dueDate ? -1 : 1;
    if (a.childIndex !== b.childIndex) return a.childIndex - b.childIndex;
    return a.row.installmentNo - b.row.installmentNo;
  });
  const shares = children.map(() => 0);
  for (const { child, childIndex, row } of queue) {
    if (left <= 0) break;
    const fees = whole(row.feesPending);
    const fee = Math.min(left, fees);
    left -= fee;
    let late = 0;
    if (child.takeLate && fee === fees) {
      late = Math.min(left, whole(row.lateFeePending));
      left -= late;
    }
    shares[childIndex] += fee + late;
  }
  return shares;
}

export type ShareCheck = { id: string; amount: number; max: number; over: boolean };

export function checkShares(children: readonly ChildMoney[], shares: readonly number[], onDate: string): ShareCheck[] {
  return children.map((child, i) => {
    const max = childTotals(child, onDate).max;
    const amount = whole(shares[i] ?? 0);
    return { id: child.id, amount, max, over: amount > max };
  });
}

/** Ready to move on: something to collect, nobody over what they owe, not more than everyone owes. */
export function familyAmountOk(children: readonly ChildMoney[], total: number, rule: SplitRule, shares: readonly number[], onDate: string): boolean {
  const sum = shares.reduce((a, b) => a + whole(b), 0);
  if (sum <= 0) return false;
  if (rule !== "manual" && whole(total) > familyMax(children, onDate)) return false;
  if (rule !== "manual" && sum !== whole(total)) return false;
  return checkShares(children, shares, onDate).every((share) => !share.over);
}

export type Suggestion = { key: "O" | "N" | "Y" | "L"; kind: "overdue" | "next" | "year" | "last"; amount: number; installmentNo?: number };

/**
 * Up to four amounts to tap, deduplicated, never more than is owed: O clears
 * what is overdue, N clears up to the next installment, Y the whole year, L is
 * what the family paid last time. Built on the desk's own chips so the two
 * desks offer the same figures.
 */
export function amountSuggestions(child: ChildMoney, onDate: string, lastAmount: number | null): Suggestion[] {
  const chips = deskChips(child.rows, onDate, { waiveLate: !child.takeLate });
  const out: Suggestion[] = [];
  const overdue = chips.find((c) => c.kind === "overdue");
  if (overdue) out.push({ key: "O", kind: "overdue", amount: overdue.amount });
  const next = upToNext(child, onDate);
  if (next) out.push({ key: "N", kind: "next", amount: next.amount, installmentNo: next.installmentNo });
  const year = chips.find((c) => c.kind === "year");
  if (year) out.push({ key: "Y", kind: "year", amount: year.amount });
  const max = childTotals(child, onDate).max;
  if (lastAmount && lastAmount > 0 && lastAmount <= max) out.push({ key: "L", kind: "last", amount: whole(lastAmount) });
  return dedupe(out);
}

/**
 * Everything up to and including the first installment not yet overdue — what
 * keeps the child clear until its next due date. With the overdue late fees
 * when they are being collected; the not-yet-due one has none.
 */
function upToNext(child: ChildMoney, onDate: string): { amount: number; installmentNo: number } | null {
  let cum = 0;
  for (const row of orderForSettlement(child.rows)) {
    cum += whole(row.feesPending) + (child.takeLate ? whole(row.lateFeePending) : 0);
    if (!row.isCarryForward && whole(row.feesPending) > 0 && !isOverdueOn(row, onDate)) return { amount: cum, installmentNo: row.installmentNo };
  }
  return null;
}

/** The family's: everything overdue, everyone up to their next installment, the whole year for all. */
export function familySuggestions(children: readonly ChildMoney[], onDate: string): Suggestion[] {
  let overdue = 0;
  let next = 0;
  let year = 0;
  for (const child of children) {
    const o = deskChips(child.rows, onDate, { waiveLate: !child.takeLate }).find((c) => c.kind === "overdue")?.amount ?? 0;
    overdue += o;
    next += upToNext(child, onDate)?.amount ?? childTotals(child, onDate).max;
    year += childTotals(child, onDate).max;
  }
  return dedupe([
    { key: "O", kind: "overdue", amount: overdue },
    { key: "N", kind: "next", amount: next },
    { key: "Y", kind: "year", amount: year },
  ]);
}

/** No figure twice. "Up to next" that is the whole year (or only the overdue) is dropped for Y (or O). */
function dedupe(list: Suggestion[]): Suggestion[] {
  const fixed = list.filter((s) => s.kind !== "next" || !list.some((o) => o !== s && (o.kind === "year" || o.kind === "overdue") && o.amount === s.amount));
  const seen = new Set<number>();
  return fixed.filter((s) => s.amount > 0 && !seen.has(s.amount) && Boolean(seen.add(s.amount))).slice(0, 4);
}

/** The amount typed on the keypad: digits, "00" and backspace; at most 7 digits; no leading zero. */
export function typeDigit(current: string, key: string): string {
  const s = String(current ?? "");
  if (key === "⌫" || key === "Backspace") return s.slice(0, -1);
  if (!/^\d{1,2}$/.test(key)) return s;
  if (s === "" && /^0+$/.test(key)) return s;
  const next = `${s}${key}`;
  return next.length > 7 ? s : next;
}
