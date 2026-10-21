/**
 * "At this receipt · fees still owed" — the figure printed on a receipt.
 *
 * Pure: no database. It has to agree with the fee ledger
 * (`private.workbook_installment_snapshot`), which the receipt cannot read
 * "as of" a past receipt, so it is rebuilt here from the same three facts the
 * ledger uses:
 *
 *  - **Only this session's money.** A payment belongs to the session of the
 *    installment it was written against; a receipt from last year never paid
 *    this year's fees.
 *  - **Net of corrections and reversals.** `payment_adjustments` holds both.
 *    A receipt that was removed (reversed) paid nothing — the ledger reads
 *    `payments.amount + Σ payment_adjustments.amount_delta`, and so does this.
 *    Before this, a removed ₹10,000 receipt still counted as paid and a
 *    receipt told a parent they owed ₹399 when they owed ₹10,399 (smoke
 *    20 Oct, accountant P1).
 *  - **The pool order.** Every rupee of the session settles the installments
 *    oldest due date first, each row's fees and then its late fee. Late fees
 *    are fines, not fees: money that went to a late fee did not lower the
 *    fees owed, so walking the pool keeps that money out of the fee figure.
 *
 * `receipt_adjustments` are deliberately not read: the counter concession
 * stored there never lowered the ledger (D-274), and a late-fee waiver lowers
 * only the late fee, which this walk already takes net of waivers.
 */

export type OutstandingPayment = {
  id: string;
  receiptId: string;
  /** Session of the installment the payment was written against. */
  sessionLabel: string | null;
  amount: number;
};

export type OutstandingAdjustment = {
  paymentId: string;
  amountDelta: number;
};

export type OutstandingInstallment = {
  installmentNo: number;
  dueDate: string;
  /** Fees charged on the row. */
  baseCharge: number;
  /** Fees plus the late fee after any waiver. */
  totalCharge: number;
};

export type ReceiptMoneyInSession = {
  /** Net money of this session in each receipt, by receipt id. */
  netByReceipt: Map<string, number>;
  /** Net money of this session in receipts before this one. */
  paidBefore: number;
  /** Net money of this session up to and including this one. */
  paidToDate: number;
};

const whole = (n: number | null | undefined) => (Number.isFinite(n) ? Math.trunc(n as number) : 0);

/**
 * Net money each receipt put into `sessionLabel`, and the running totals at
 * `currentReceiptId`. `receiptOrder` is every receipt of the student in the
 * order they were taken (payment date, then entry time).
 */
export function receiptMoneyInSession(input: {
  currentReceiptId: string;
  receiptOrder: readonly string[];
  payments: readonly OutstandingPayment[];
  adjustments: readonly OutstandingAdjustment[];
  sessionLabel: string | null;
}): ReceiptMoneyInSession {
  const deltaByPayment = new Map<string, number>();
  for (const a of input.adjustments) {
    deltaByPayment.set(a.paymentId, (deltaByPayment.get(a.paymentId) ?? 0) + whole(a.amountDelta));
  }
  const netByReceipt = new Map<string, number>();
  for (const p of input.payments) {
    if (input.sessionLabel && p.sessionLabel !== input.sessionLabel) continue;
    const net = whole(p.amount) + (deltaByPayment.get(p.id) ?? 0);
    netByReceipt.set(p.receiptId, (netByReceipt.get(p.receiptId) ?? 0) + net);
  }
  const at = input.receiptOrder.indexOf(input.currentReceiptId);
  let paidBefore = 0;
  let paidToDate = 0;
  if (at >= 0) {
    input.receiptOrder.slice(0, at + 1).forEach((id, i) => {
      const net = Math.max(0, netByReceipt.get(id) ?? 0);
      paidToDate += net;
      if (i < at) paidBefore += net;
    });
  }
  return { netByReceipt, paidBefore, paidToDate };
}

/**
 * Fees still owed once `money` has settled the session's installments in the
 * ledger's order. Without installment rows (the view was unreadable) it falls
 * back to `chargedFees − money`, which can only understate by a late fee.
 */
export function feesOwedAfter(input: {
  money: number;
  installments: readonly OutstandingInstallment[];
  chargedFees: number | null;
}): number {
  const money = Math.max(0, whole(input.money));
  if (input.installments.length === 0) {
    return Math.max(0, whole(input.chargedFees ?? 0) - money);
  }
  const ordered = [...input.installments].sort((a, b) =>
    a.dueDate !== b.dueDate ? (a.dueDate < b.dueDate ? -1 : 1) : a.installmentNo - b.installmentNo,
  );
  let rem = money;
  let owed = 0;
  for (const row of ordered) {
    const fees = Math.max(0, whole(row.baseCharge));
    const late = Math.max(0, whole(row.totalCharge) - fees);
    const toFees = Math.min(rem, fees);
    rem -= toFees;
    owed += fees - toFees;
    rem -= Math.min(rem, late);
  }
  return owed;
}
