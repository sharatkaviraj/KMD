import { describe, expect, it } from "vitest";

import {
  addDays,
  canCloseDay,
  cashDiff,
  closeBlocker,
  countedCash,
  deskModeOf,
  filterReceipts,
  groupByDay,
  hasDeskFilters,
  isIsoDate,
  isReversalReason,
  latestCloseState,
  NO_DESK_FILTERS,
  postedAfterClose,
  spanRange,
  summarizeReceipts,
  type DeskReceipt,
} from "@/modules/receipts/vx/domain/day-close";

const r = (over: Partial<DeskReceipt & { studentFullName: string; classLabel: string }>): DeskReceipt & { studentFullName: string; classLabel: string } => ({
  id: over.receiptNumber ?? "id",
  receiptNumber: "R-1",
  paymentDate: "2026-10-08",
  createdAt: "2026-10-08T04:00:00Z",
  paymentMode: "cash",
  totalAmount: 1000,
  isReversed: false,
  receivedBy: "Desk A",
  studentFullName: "Test Child",
  classLabel: "Class 4",
  ...over,
});

describe("counting the cash", () => {
  it("adds notes and coins", () => {
    expect(countedCash({ 500: 12, 200: 3, 100: 4, 50: 2, 20: 1, 10: 0, 1: 5 })).toBe(6000 + 600 + 400 + 100 + 20 + 5);
  });

  it("ignores negative and fractional counts", () => {
    expect(countedCash({ 500: -2, 100: 2.7 })).toBe(200);
  });

  it("says match, short or over", () => {
    expect(cashDiff(1000, 1000)).toEqual({ kind: "match" });
    expect(cashDiff(900, 1000)).toEqual({ kind: "short", amount: 100 });
    expect(cashDiff(1100, 1000)).toEqual({ kind: "over", amount: 100 });
  });
});

describe("closing the day", () => {
  it("closes when cash matches and UPI is checked", () => {
    expect(canCloseDay({ counted: 500, expected: 500, note: "", upiChecked: true })).toBe(true);
  });

  it("needs UPI checked even when the cash matches", () => {
    expect(canCloseDay({ counted: 500, expected: 500, note: "", upiChecked: false })).toBe(false);
    expect(closeBlocker({ counted: 500, expected: 500, note: "", upiChecked: false })).toBe("upi");
  });

  it("needs a note of five characters when the cash does not match", () => {
    expect(canCloseDay({ counted: 400, expected: 500, note: "oops", upiChecked: true })).toBe(false);
    expect(closeBlocker({ counted: 400, expected: 500, note: "oops", upiChecked: true })).toBe("note");
    expect(canCloseDay({ counted: 400, expected: 500, note: "₹100 change given", upiChecked: true })).toBe(true);
  });

  it("treats a reopen after a close as open again", () => {
    const events = [
      { action: "close" as const, createdAt: "2026-10-08T11:00:00Z" },
      { action: "reopen" as const, createdAt: "2026-10-08T12:00:00Z" },
    ];
    expect(latestCloseState(events).closed).toBe(false);
    expect(latestCloseState(events.slice(0, 1)).closed).toBe(true);
    expect(latestCloseState([]).closed).toBe(false);
  });

  it("flags receipts posted after the close instead of hiding them", () => {
    const list = [r({ receiptNumber: "A", createdAt: "2026-10-08T10:00:00Z" }), r({ receiptNumber: "B", createdAt: "2026-10-08T12:30:00Z" })];
    expect(postedAfterClose(list, "2026-10-08T11:00:00Z").map((x) => x.receiptNumber)).toEqual(["B"]);
    expect(postedAfterClose(list, null)).toEqual([]);
  });
});

describe("day totals", () => {
  it("leaves reversed receipts out of every total but counts them", () => {
    const s = summarizeReceipts([
      r({ paymentMode: "cash", totalAmount: 1000 }),
      r({ paymentMode: "upi", totalAmount: 2500 }),
      r({ paymentMode: "cash", totalAmount: 3000, isReversed: true }),
      r({ paymentMode: "bank_transfer", totalAmount: 400 }),
    ]);
    expect(s.net).toBe(3900);
    expect(s.count).toBe(3);
    expect(s.reversedCount).toBe(1);
    expect(s.byMode.cash).toEqual({ amount: 1000, count: 1 });
    expect(s.byMode.bank.amount).toBe(400);
  });

  it("does not count a discount close-out as money", () => {
    const s = summarizeReceipts([r({ paymentMode: "discount", totalAmount: 700 })]);
    expect(s.net).toBe(0);
    expect(deskModeOf("discount")).toBe("other");
  });

  it("groups by day, newest first", () => {
    const groups = groupByDay([
      r({ receiptNumber: "1", paymentDate: "2026-10-07", createdAt: "2026-10-07T05:00:00Z" }),
      r({ receiptNumber: "2", paymentDate: "2026-10-08", createdAt: "2026-10-08T04:00:00Z" }),
      r({ receiptNumber: "3", paymentDate: "2026-10-08", createdAt: "2026-10-08T06:00:00Z" }),
    ]);
    expect(groups.map((g) => g.date)).toEqual(["2026-10-08", "2026-10-07"]);
    expect(groups[0].receipts.map((x) => x.receiptNumber)).toEqual(["3", "2"]);
    expect(groups[0].net).toBe(2000);
  });
});

describe("filters and days", () => {
  it("filters by mode, staff and search", () => {
    const list = [r({ receiptNumber: "SVP-1", paymentMode: "upi" }), r({ receiptNumber: "SVP-2", receivedBy: "Desk B", studentFullName: "Other Name" })];
    expect(filterReceipts(list, { ...NO_DESK_FILTERS, mode: "upi" }).map((x) => x.receiptNumber)).toEqual(["SVP-1"]);
    expect(filterReceipts(list, { ...NO_DESK_FILTERS, staff: "Desk B" }).map((x) => x.receiptNumber)).toEqual(["SVP-2"]);
    expect(filterReceipts(list, { ...NO_DESK_FILTERS, query: "other" }).map((x) => x.receiptNumber)).toEqual(["SVP-2"]);
    expect(hasDeskFilters(NO_DESK_FILTERS)).toBe(false);
  });

  it("anchors today, yesterday and three days on the desk's date", () => {
    expect(spanRange("today", "2026-10-01")).toEqual({ from: "2026-10-01", to: "2026-10-01" });
    expect(spanRange("yesterday", "2026-10-01")).toEqual({ from: "2026-09-30", to: "2026-09-30" });
    expect(spanRange("3d", "2026-10-01")).toEqual({ from: "2026-09-29", to: "2026-10-01" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("only accepts real dates and known reasons", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-10-08")).toBe(true);
    expect(isReversalReason("wrong_student")).toBe(true);
    expect(isReversalReason("because")).toBe(false);
  });
});
