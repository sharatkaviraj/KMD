/**
 * The balance a cashier reads straight after posting, from the live ledger.
 *
 * Pure: no database, no React.
 *
 * The desk's ledger rows come from `v_workbook_installment_balances`, a
 * materialized view. Posting only queues its refresh; the refresh takes
 * `for update skip locked` and runs concurrently, so a read straight after a
 * payment can see the snapshot from before it (the receipt said ₹7,100 owed
 * where ₹7,099 was right, B07). `preview_workbook_payment_allocation` reads
 * `private.workbook_installment_snapshot` — the same arithmetic, computed
 * now, not the view — and returns only the rows still owing something
 * (`total_pending > 0`).
 *
 * So the view supplies the shape (labels, charges, every installment of the
 * session) and the live rows supply what is still owed: a row the live
 * ledger returns takes its figures; a row it does not return is settled.
 */

import type { DeskLedgerRow } from "./desk";

/** Where the figures on a desk ledger came from. */
export type BalanceSource = "live" | "snapshot";

/** One row of `preview_workbook_payment_allocation`, as the desk needs it. */
export type LiveBalanceRow = {
  installmentId: string;
  installmentNo: number;
  label: string;
  isCarryForward: boolean;
  dueDate: string;
  /** The row's charge as the RPC reports it (only used for a row the view lacks). */
  amountDue: number;
  feesPending: number;
  lateFeePending: number;
  rawLateFee: number;
  waiverApplied: number;
  planPriority: number;
};

const whole = (n: number) => Math.max(0, Math.trunc(Number.isFinite(n) ? n : 0));

function lateFeeStatusOf(pending: number, raw: number, waived: number): DeskLedgerRow["lateFeeStatus"] {
  if (pending > 0) return "pending";
  if (raw > 0 && waived >= raw) return "waived";
  if (raw > 0) return "paid";
  return "none";
}

/** A ledger row built from a live row alone (the view did not have it). */
export function rowFromLive(b: LiveBalanceRow): DeskLedgerRow {
  return {
    id: b.installmentId,
    installmentNo: b.installmentNo,
    label: b.label,
    isCarryForward: b.isCarryForward,
    dueDate: b.dueDate,
    charge: b.amountDue,
    feesPaid: Math.max(0, b.amountDue - b.feesPending),
    feesPending: b.feesPending,
    lateFeePending: b.lateFeePending,
    lateFeeRaw: b.rawLateFee,
    lateFeeWaived: b.waiverApplied,
    lateFeeStatus: b.lateFeePending > 0 ? "pending" : "none",
    planPriority: b.planPriority ?? 1,
  };
}

/**
 * The view's rows with the live ledger's figures laid over them.
 *
 *  - a row in `live`: fees pending, late fee pending, raw late fee and waiver
 *    from the live row; fees paid = charge − fees pending;
 *  - a row absent from `live`: settled — nothing pending;
 *  - a live row the view lacks is appended, so the desk never shows less
 *    than the ledger will take.
 */
export function overlayLiveBalances(rows: readonly DeskLedgerRow[], live: readonly LiveBalanceRow[]): DeskLedgerRow[] {
  const byId = new Map(live.map((b) => [b.installmentId, b]));
  const seen = new Set<string>();
  const out: DeskLedgerRow[] = rows.map((row) => {
    seen.add(row.id);
    const b = byId.get(row.id);
    if (!b) {
      return {
        ...row,
        feesPaid: whole(row.charge),
        feesPending: 0,
        lateFeePending: 0,
        lateFeeStatus: lateFeeStatusOf(0, row.lateFeeRaw, row.lateFeeWaived),
      };
    }
    const feesPending = whole(b.feesPending);
    const lateFeePending = whole(b.lateFeePending);
    const lateFeeRaw = whole(b.rawLateFee);
    const lateFeeWaived = whole(b.waiverApplied);
    return {
      ...row,
      feesPending,
      feesPaid: Math.max(0, whole(row.charge) - feesPending),
      lateFeePending,
      lateFeeRaw,
      lateFeeWaived,
      lateFeeStatus: lateFeeStatusOf(lateFeePending, lateFeeRaw, lateFeeWaived),
    };
  });
  for (const b of live) if (!seen.has(b.installmentId)) out.push(rowFromLive(b));
  return out;
}
