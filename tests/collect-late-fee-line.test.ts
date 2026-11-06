import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { DeskLedgerRow } from "@/modules/payments/vx/domain/desk";
import { lateTaken } from "@/vx/screens/collect/parts";

// Office replay, 6 Nov 2026: the check card said "Late fee · Collected ₹3,000"
// on a ₹1,000 payment, because it printed the whole late fee owed. It now
// says what this payment takes, and what stays owed.
const row = (over: Partial<DeskLedgerRow>): DeskLedgerRow => ({
  id: "r",
  installmentNo: 1,
  label: "Installment 1",
  isCarryForward: false,
  dueDate: "2026-04-20",
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

// Three overdue installments, ₹1,000 late fee on each.
const ROWS: DeskLedgerRow[] = [1, 2, 3].map((n) =>
  row({ id: `i${n}`, installmentNo: n, label: `Installment ${n}`, dueDate: ["2026-04-20", "2026-07-20", "2026-10-20"][n - 1], charge: 5000, feesPending: 5000, lateFeePending: 1000, lateFeeRaw: 1000, lateFeeStatus: "pending" }),
);
const ON = "2026-11-06";

describe("collect check card: late fee line", () => {
  it("counts only the late fee this payment reaches", () => {
    expect(lateTaken(ROWS, 6000, true, ON)).toBe(1000);
    expect(lateTaken(ROWS, 18000, true, ON)).toBe(3000);
    expect(lateTaken(ROWS, 3000, true, ON)).toBe(0);
  });

  it("is 0 when the late fee is not taken", () => {
    expect(lateTaken(ROWS, 18000, false, ON)).toBe(0);
    expect(lateTaken(ROWS, 0, true, ON)).toBe(0);
  });

  it("the card uses it, and says what stays owed", () => {
    const src = readFileSync("src/vx/screens/collect/collect.tsx", "utf8");
    expect(src).toContain("lateTaken(d.rows, shares[i] ?? 0, takesLate(d), date)");
    expect(src).toContain("mc.lateCollectedPart");
  });
});
