import { describe, expect, it } from "vitest";

import { feesOwedAfter, receiptMoneyInSession } from "@/modules/receipts/domain/outstanding";

/*
 * Smoke school day, 20 Oct (accountant P1): a Nursery child charged ₹17,100
 * had a ₹10,000 receipt that was removed, a ₹6,700 receipt, and then a ₹1
 * receipt. The ₹1 receipt printed "fees still owed ₹399": the removed
 * receipt counted as paid. The ledger said ₹10,399.
 */
const S = "2026-27";
const installments = [
  { installmentNo: 1, dueDate: "2026-04-20", baseCharge: 5_100, totalCharge: 5_100 },
  { installmentNo: 2, dueDate: "2026-07-20", baseCharge: 4_000, totalCharge: 4_000 },
  { installmentNo: 3, dueDate: "2026-10-20", baseCharge: 4_000, totalCharge: 4_000 },
  { installmentNo: 4, dueDate: "2027-01-20", baseCharge: 4_000, totalCharge: 4_000 },
];

describe("receiptMoneyInSession", () => {
  const payments = [
    { id: "p-old", receiptId: "r-last-year", sessionLabel: "2025-26", amount: 9_000 },
    { id: "p1", receiptId: "r-removed", sessionLabel: S, amount: 10_000 },
    { id: "p2", receiptId: "r-6700", sessionLabel: S, amount: 6_700 },
    { id: "p3", receiptId: "r-1", sessionLabel: S, amount: 1 },
  ];
  const adjustments = [{ paymentId: "p1", amountDelta: -10_000 }];
  const order = ["r-last-year", "r-removed", "r-6700", "r-1"];

  it("does not count a removed receipt or last session's money as paid", () => {
    const m = receiptMoneyInSession({ currentReceiptId: "r-1", receiptOrder: order, payments, adjustments, sessionLabel: S });
    expect(m.paidToDate).toBe(6_701);
    expect(m.paidBefore).toBe(6_700);
    expect(m.netByReceipt.get("r-removed")).toBe(0);
  });

  it("applies a correction to the receipt it corrects", () => {
    const m = receiptMoneyInSession({
      currentReceiptId: "r-6700",
      receiptOrder: order,
      payments,
      adjustments: [...adjustments, { paymentId: "p2", amountDelta: -700 }],
      sessionLabel: S,
    });
    expect(m.paidToDate).toBe(6_000);
  });

  it("counts nothing for a receipt it cannot place", () => {
    const m = receiptMoneyInSession({ currentReceiptId: "missing", receiptOrder: order, payments, adjustments, sessionLabel: S });
    expect(m.paidToDate).toBe(0);
  });
});

describe("feesOwedAfter", () => {
  it("prints what the ledger says: ₹10,399, not ₹399", () => {
    expect(feesOwedAfter({ money: 6_701, installments, chargedFees: 17_100 })).toBe(10_399);
  });

  it("keeps money that paid a late fee out of the fees figure", () => {
    const withLate = installments.map((r) => (r.installmentNo === 1 ? { ...r, totalCharge: 6_100 } : r));
    // ₹6,100 clears Installment 1 and its ₹1,000 late fee: fees owed are the other three.
    expect(feesOwedAfter({ money: 6_100, installments: withLate, chargedFees: 17_100 })).toBe(12_000);
  });

  it("falls back to charged minus paid without installment rows", () => {
    expect(feesOwedAfter({ money: 6_701, installments: [], chargedFees: 17_100 })).toBe(10_399);
    expect(feesOwedAfter({ money: 20_000, installments: [], chargedFees: 17_100 })).toBe(0);
  });
});
