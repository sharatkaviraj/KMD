import { describe, expect, it } from "vitest";

import { deskTotals, type DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import { overlayLiveBalances, type LiveBalanceRow } from "@/modules/payments/vx/domain/live-balance";

// B07: the balance views trail a payment just posted; the live ledger does not.
const row = (over: Partial<DeskLedgerRow>): DeskLedgerRow => ({
  id: "r",
  installmentNo: 1,
  label: "Installment 1",
  isCarryForward: false,
  dueDate: "2026-07-20",
  charge: 0,
  feesPaid: 0,
  feesPending: 0,
  lateFeePending: 0,
  lateFeeRaw: 0,
  lateFeeWaived: 0,
  lateFeeStatus: "none",
  planPriority: 1,
  ...over,
});
const live = (over: Partial<LiveBalanceRow>): LiveBalanceRow => ({
  installmentId: "r",
  installmentNo: 1,
  label: "Installment 1",
  isCarryForward: false,
  dueDate: "2026-07-20",
  amountDue: 0,
  feesPending: 0,
  lateFeePending: 0,
  rawLateFee: 0,
  waiverApplied: 0,
  planPriority: 1,
  ...over,
});
const TODAY = "2026-10-19";

// The stale view: ₹7,100 still owed (₹6,100 fees on Installment 2, ₹1,000 late fee).
const STALE: DeskLedgerRow[] = [
  row({ id: "i1", charge: 7750, feesPaid: 7750, dueDate: "2026-04-20" }),
  row({ id: "i2", installmentNo: 2, label: "Installment 2", charge: 7250, feesPaid: 1150, feesPending: 6100, lateFeePending: 1000, lateFeeRaw: 1000, lateFeeStatus: "pending" }),
];

describe("live balance overlay (B07)", () => {
  it("takes the live ledger's figure over the stale view: ₹7,100 in the view, ₹7,099 live → ₹7,099", () => {
    expect(deskTotals(STALE, TODAY).wholeYear).toBe(7100);
    const fresh = overlayLiveBalances(STALE, [
      live({ installmentId: "i2", installmentNo: 2, amountDue: 7250, feesPending: 6099, lateFeePending: 1000, rawLateFee: 1000 }),
    ]);
    expect(deskTotals(fresh, TODAY).wholeYear).toBe(7099);
    const i2 = fresh.find((r) => r.id === "i2")!;
    expect(i2).toMatchObject({ feesPending: 6099, feesPaid: 7250 - 6099, lateFeePending: 1000, lateFeeStatus: "pending", charge: 7250, label: "Installment 2" });
  });

  it("reads a child the payment cleared entirely as ₹0 owed, not as missing dues", () => {
    // The live ledger returns only rows still owing (total_pending > 0): none.
    const fresh = overlayLiveBalances(STALE, []);
    const totals = deskTotals(fresh, TODAY);
    expect(totals.wholeYear).toBe(0);
    expect(totals.lateFee).toBe(0);
    expect(fresh).toHaveLength(2);
    expect(fresh.find((r) => r.id === "i2")).toMatchObject({ feesPending: 0, feesPaid: 7250, lateFeePending: 0, lateFeeStatus: "paid" });
  });

  it("keeps a waived late fee as waived and appends a live row the view lacks", () => {
    const fresh = overlayLiveBalances(STALE, [
      live({ installmentId: "i2", installmentNo: 2, amountDue: 7250, feesPending: 100, lateFeePending: 0, rawLateFee: 1000, waiverApplied: 1000 }),
      live({ installmentId: "cf", installmentNo: 0, label: "Old balance", isCarryForward: true, dueDate: "2026-04-01", amountDue: 500, feesPending: 500 }),
    ]);
    expect(fresh.find((r) => r.id === "i2")).toMatchObject({ feesPending: 100, lateFeePending: 0, lateFeeWaived: 1000, lateFeeStatus: "waived" });
    expect(fresh.find((r) => r.id === "cf")).toMatchObject({ isCarryForward: true, feesPending: 500, feesPaid: 0 });
    expect(deskTotals(fresh, TODAY).wholeYear).toBe(600);
  });
});
