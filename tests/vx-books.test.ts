import { describe, expect, it } from "vitest";

import {
  canMoveCheque,
  canRemind,
  chequeStatus,
  isWaitingForBank,
  maskPhone,
  nextSlipNumber,
  parseUpiStatement,
  requestStatus,
  suggestUpiMatches,
  upiLineState,
  usualDayTotal,
  versusUsual,
} from "@/modules/finance-controls/vx/domain/books";

describe("cheques", () => {
  it("takes the latest event, and no event means still to deposit", () => {
    expect(chequeStatus([])).toBe("to_deposit");
    expect(
      chequeStatus([
        { receiptId: "r", status: "deposited", createdAt: "2026-10-01T10:00:00Z" },
        { receiptId: "r", status: "cleared", createdAt: "2026-10-03T10:00:00Z" },
      ]),
    ).toBe("cleared");
    expect(isWaitingForBank("in_bag")).toBe(true);
    expect(isWaitingForBank("deposited")).toBe(false);
  });

  it("only moves forward, and only a deposited cheque can clear or bounce", () => {
    expect(canMoveCheque("to_deposit", "deposited")).toBe(true);
    expect(canMoveCheque("to_deposit", "bounced")).toBe(false);
    expect(canMoveCheque("deposited", "bounced")).toBe(true);
    expect(canMoveCheque("cleared", "bounced")).toBe(false);
  });

  it("numbers slips after the highest one used", () => {
    expect(nextSlipNumber([])).toBe("DS-0001");
    expect(nextSlipNumber(["DS-0002", "DS-0010", "other"])).toBe("DS-0011");
  });
});

describe("UPI statement", () => {
  it("parses rows, skips the header and reports bad lines", () => {
    const parsed = parseUpiStatement(
      ["Date,Amount,Payer,UTR", "2026-10-08 10:15,4500,TEST PAYER,ABC123456789", "08/10/2026,12.5,X,ABC12345", "bad line"].join("\n"),
    );
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ amount: 4500, utr: "ABC123456789" });
    expect(parsed.rows[0].txnAt).toBe("2026-10-08T04:45:00.000Z");
    expect(parsed.errors.map((e) => e.line)).toEqual([3, 4]);
  });

  it("matches only equal amounts, the UTR first, and never a receipt already matched", () => {
    const receipts = [
      { id: "a", receiptNumber: "1", paymentDate: "2026-10-08", amount: 4500, referenceNumber: null, studentName: "A", classLabel: null },
      { id: "b", receiptNumber: "2", paymentDate: "2026-10-01", amount: 4500, referenceNumber: "ABC123456789", studentName: "B", classLabel: null },
      { id: "c", receiptNumber: "3", paymentDate: "2026-10-08", amount: 4600, referenceNumber: null, studentName: "C", classLabel: null },
      { id: "d", receiptNumber: "4", paymentDate: "2026-10-08", amount: 4500, referenceNumber: null, studentName: "D", classLabel: null },
    ];
    const s = suggestUpiMatches({ txnAt: "2026-10-08T05:00:00Z", amount: 4500, utr: "ABC123456789" }, receipts, new Set(["d"]));
    expect(s.map((x) => x.id)).toEqual(["b", "a"]);
    expect(s[0].why).toBe("ref");
  });

  it("reads a line's state from its latest event", () => {
    expect(upiLineState([]).state).toBe("open");
    expect(
      upiLineState([
        { lineId: "l", action: "match", receiptId: "r", createdAt: "2026-10-01T00:00:00Z" },
        { lineId: "l", action: "unmatch", receiptId: null, createdAt: "2026-10-02T00:00:00Z" },
      ]).state,
    ).toBe("open");
  });
});

describe("today against a usual day", () => {
  it("averages the same weekday, ignoring days with no money", () => {
    // 2026-10-08 is a Thursday.
    const days = [
      { date: "2026-10-01", total: 30000 },
      { date: "2026-09-24", total: 10000 },
      { date: "2026-09-17", total: 0 },
      { date: "2026-09-30", total: 99999 },
    ];
    expect(usualDayTotal(days, "2026-10-08")).toBe(20000);
    expect(versusUsual(25000, 20000)).toBe(25);
    expect(versusUsual(1, null)).toBeNull();
  });
});

describe("requests", () => {
  it("withdrawn wins, then the decision", () => {
    expect(requestStatus({ decision: null, withdrawnAt: null, remindedAt: null })).toBe("waiting");
    expect(requestStatus({ decision: "approved", withdrawnAt: null, remindedAt: null })).toBe("approved");
    expect(requestStatus({ decision: null, withdrawnAt: "x", remindedAt: null })).toBe("withdrawn");
  });

  it("lets a reminder go once an hour", () => {
    const now = new Date("2026-10-08T10:00:00Z");
    expect(canRemind({ remindedAt: null, requestedAt: "2026-10-08T09:30:00Z" }, now)).toBe(false);
    expect(canRemind({ remindedAt: null, requestedAt: "2026-10-08T08:30:00Z" }, now)).toBe(true);
  });

  it("masks a phone to its last three digits", () => {
    expect(maskPhone("98290 00512")).toBe("••512");
    expect(maskPhone(null)).toBe("");
  });
});
