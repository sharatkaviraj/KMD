import { describe, expect, it } from "vitest";

import { postInputSchema, postedPaymentSchema } from "@/platform/fees-bridge/contracts";

const base = {
  studentId: "00000000-0000-4000-8000-000000000001", sessionLabel: "2026-27", paymentDate: "2026-11-05", amount: 6000,
  quickDiscountAmount: 0, lateFeeWaiverAmount: 0, commandId: "00000000-0000-4000-8000-000000000002", quoteHash: "a".repeat(32),
  referenceNumber: null, remarks: null,
};

describe("bridge payment input: one mode or Cash + UPI tender lines (schoolfees #141)", () => {
  it("takes a single mode as before", () => {
    expect(postInputSchema.safeParse({ ...base, paymentMode: "cash" }).success).toBe(true);
  });

  it("takes tender lines that add up, with distinct modes and no reference", () => {
    const split = { ...base, tenders: [{ mode: "cash", amount: 4000 }, { mode: "upi", amount: 2000 }] };
    const parsed = postInputSchema.parse(split);
    expect(parsed.tenders).toHaveLength(2);
    expect("paymentMode" in parsed && parsed.paymentMode !== undefined).toBe(false);
  });

  it.each([
    ["both", { paymentMode: "cash", tenders: [{ mode: "cash", amount: 4000 }, { mode: "upi", amount: 2000 }] }],
    ["neither", {}],
    ["lines that do not add up", { tenders: [{ mode: "cash", amount: 4000 }, { mode: "upi", amount: 1000 }] }],
    ["a mode twice", { tenders: [{ mode: "cash", amount: 3000 }, { mode: "cash", amount: 3000 }] }],
    ["one line", { tenders: [{ mode: "cash", amount: 6000 }] }],
    ["a zero line", { amount: 6000, tenders: [{ mode: "cash", amount: 6000 }, { mode: "upi", amount: 0 }] }],
    ["a reference on a split", { referenceNumber: "UTR1", tenders: [{ mode: "cash", amount: 4000 }, { mode: "upi", amount: 2000 }] }],
    ["an unknown mode", { tenders: [{ mode: "cash", amount: 4000 }, { mode: "split", amount: 2000 }] }],
  ])("refuses %s", (_name, extra) => {
    expect(postInputSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  it("reads a split result with its lines", () => {
    const result = postedPaymentSchema.parse({
      commandId: base.commandId, status: "completed", receiptId: "00000000-0000-4000-8000-000000000003", receiptNumber: "SVP-1",
      studentId: base.studentId, sessionLabel: "2026-27", amountReceived: 6000, remainingBalance: 0, feesPending: 0, lateFeePending: 0,
      paymentDate: "2026-11-05", paymentMode: "split", receivedBy: null, quickDiscountApplied: 0, lateFeeWaivedApplied: 0, printUrl: "https://fees.vpps.co.in/x",
      tenders: [{ mode: "cash", amount: 4000 }, { mode: "upi", amount: 2000 }],
    });
    expect(result.tenders?.map((t) => t.mode)).toEqual(["cash", "upi"]);
  });
});
