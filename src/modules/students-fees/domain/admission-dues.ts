/**
 * A child admitted a moment ago has paid nothing, so their scheduled
 * installments are their dues. Split by due date the way the done screen's
 * usual read (`loadDuesSplit`) splits the balance views' rows: due on or
 * before today is pending today, the rest is not due yet. Pure.
 */
export function newAdmissionSplit(
  rows: readonly { amount_due: number | null; due_date: string | null }[],
  today: string,
): { pendingToday: number; notDueYet: number; lateFeePending: number } {
  let pendingToday = 0;
  let notDueYet = 0;
  for (const r of rows) {
    const amount = Math.max(0, Number(r.amount_due) || 0);
    if (r.due_date && r.due_date <= today) pendingToday += amount;
    else notDueYet += amount;
  }
  return { pendingToday, notDueYet, lateFeePending: 0 };
}
