import { describe, expect, it } from "vitest";

import { emptyLiveIsBelievable, overlayLiveBalances } from "@/modules/payments/vx/domain/live-balance";
import { submitMisfit, type Cell } from "@/vx/screens/exams/domain/entry";

/*
 * Findings from the independent review of the 19 October assessment fixes.
 * Synthetic ids and amounts only.
 */

describe("a final submit is checked against the whole saved column (review 4)", () => {
  const roster = ["s1", "s2", "s3"];
  const v = (value: number): Cell => ({ state: "value", value });

  it("names a saved 7.5 on a whole-marks paper even when the command sends nothing for it", () => {
    const saved = { s1: v(40), s2: v(7.5), s3: { state: "absent", value: null } as Cell };
    expect(submitMisfit(roster, saved, [], 80, 1)).toBe("s2");
    // Sending a different pupil's mark does not hide it.
    expect(submitMisfit(roster, saved, [{ studentId: "s1", state: "value", value: 41 }], 80, 1)).toBe("s2");
  });

  it("lets the paper through once the old mark is corrected in this command, and never rewrites it otherwise", () => {
    const saved = { s1: v(40), s2: v(7.5), s3: v(0) };
    expect(submitMisfit(roster, saved, [{ studentId: "s2", state: "value", value: 8 }], 80, 1)).toBeNull();
    expect(saved.s2.value).toBe(7.5);
  });

  it("checks the range too, and ignores rows for pupils off the roster", () => {
    expect(submitMisfit(roster, { s1: v(81), s2: v(1), s3: v(2) }, [], 80, 1)).toBe("s1");
    expect(submitMisfit(roster, { s1: v(1), s2: v(1), s3: v(2), gone: v(0.25) }, [], 80, 1)).toBeNull();
    expect(submitMisfit(roster, { s1: v(7.5), s2: v(1), s3: v(2) }, [], 80, 0.5)).toBeNull();
  });
});

describe("an empty live ledger is believed only when the receipt agrees (review 5)", () => {
  it("is nothing owed when this payment cleared the child", () => {
    expect(emptyLiveIsBelievable(0, 0)).toBe(true);
  });
  it("is not the balance now when the receipt says money is still owed, or the receipt is unknown", () => {
    expect(emptyLiveIsBelievable(0, 1500)).toBe(false);
    expect(emptyLiveIsBelievable(0, null)).toBe(false);
  });
  it("trusts any live rows", () => {
    expect(emptyLiveIsBelievable(2, 1500)).toBe(true);
  });

  it("keeps paise exactly rather than truncating them", () => {
    const row = { id: "i1", installmentNo: 1, label: "Q1", isCarryForward: false, dueDate: "2026-07-10", charge: 1000, feesPaid: 0, feesPending: 1000, lateFeePending: 0, lateFeeRaw: 0, lateFeeWaived: 0, lateFeeStatus: "none" as const, planPriority: 1 };
    const live = [{ installmentId: "i1", installmentNo: 1, label: "Q1", isCarryForward: false, dueDate: "2026-07-10", amountDue: 1000, feesPending: 999.5, lateFeePending: 0, rawLateFee: 0, waiverApplied: 0, planPriority: 1 }];
    expect(overlayLiveBalances([row], live)[0].feesPending).toBe(999.5);
  });
});
