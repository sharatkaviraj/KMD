import { describe, expect, it } from "vitest";
import { deskProblems, parseAmountInput, walkPayment, type DeskLedgerRow } from "@/modules/payments/vx/domain/desk";

const rows: DeskLedgerRow[] = [{ id: "i1", installmentNo: 1, label: "Installment 1", isCarryForward: false, dueDate: "2026-04-20", charge: 2000, feesPaid: 0, feesPending: 2000, lateFeePending: 1000, lateFeeRaw: 1000, lateFeeWaived: 0, lateFeeStatus: "pending", planPriority: 1 }, { id: "i2", installmentNo: 2, label: "Installment 2", isCarryForward: false, dueDate: "2027-01-20", charge: 2000, feesPaid: 0, feesPending: 2000, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none", planPriority: 1 }];

describe("reference payment parity", () => {
  it.each(["123.50", "-10", "2e3", "abc", "12/3"])("rejects invalid whole rupees %s without changing the amount", (input) => {
    expect(Number.isNaN(parseAmountInput(input))).toBe(true);
  });
  it("accepts formatted whole rupees without losing their value", () => {
    expect(parseAmountInput("₹7,000.00")).toBe(7000);
    expect(parseAmountInput("0")).toBe(0);
  });
  it("allows cheque collection with an optional reference and bank", () => {
    const walk = walkPayment(rows, 500, { paymentDate: "2026-10-11", today: "2026-10-11", waiveLate: false });
    expect(deskProblems({ amount: 500, paymentDate: "2026-10-11", mode: "cheque", chequeNo: "", chequeBank: "", waiveLate: false, waiveReason: "" }, walk, { today: "2026-10-11", sessionStart: "2026-04-01", lateFeeOwed: 1000 })).toEqual([]);
  });
  it("shows concession separately and caps cash at the revised net payable", () => {
    const walk = walkPayment(rows, 1800, { paymentDate: "2026-10-11", today: "2026-10-11", waiveLate: true, concession: 200 } as never);
    expect(walk.maxAmount).toBe(3800);
    expect(walk.waiverAmount).toBe(1000);
    expect(walk.lines[0]).toMatchObject({ feesPaid: 1800, feesAfter: 0, lateFeeAfter: 0, discountApplied: 200 });
    expect(walk.after).toEqual({ pendingToday: 0, dueToday: 0, notDueYet: 2000, lateFee: 0 });
  });
  it("applies a concession to oldest dues before allocating payment to upcoming fees", () => {
    const walk = walkPayment(rows, 1000, { paymentDate: "2026-10-11", today: "2026-10-11", waiveLate: false, concession: 3000 } as never);
    expect(walk.maxAmount).toBe(2000);
    expect(walk.lines.map(line => [line.feesPaid, line.lateFeePaid, line.feesAfter, line.lateFeeAfter])).toEqual([[0, 0, 0, 0], [1000, 0, 1000, 0]]);
  });
});
