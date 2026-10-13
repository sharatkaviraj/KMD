import { describe, expect, it } from "vitest";

import {
  checkGridRows,
  gridRowFromImport,
  gridToCsv,
  gridTotals,
  indexStudentsBySr,
  type GridRow,
} from "@/modules/payments/vx/domain/bulk-grid";
import {
  composeReference,
  composeRemarks,
  deskChips,
  deskProblems,
  deskTotals,
  isDueOn,
  isOverdueOn,
  findRecentDuplicate,
  helperChips,
  lateFeesOn,
  listPending,
  maskPhone,
  matchesDeskSearch,
  parseAmountInput,
  sessionStartDate,
  shortClassLabel,
  walkPayment,
  type DeskLedgerRow,
} from "@/modules/payments/vx/domain/desk";

// The design's worked example (PayDesk.dc.html, "Test Student A", Class 7):
// last session's ₹1,200, Installment 1 paid, Installment 2 part paid and
// overdue with a ₹1,000 late fee, Installments 3 and 4 not due yet.
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

const LEDGER: DeskLedgerRow[] = [
  row({ id: "i3", installmentNo: 3, label: "Installment 3", dueDate: "2026-10-20", charge: 7250, feesPending: 7250 }),
  row({ id: "old", installmentNo: 0, label: "Old balance 2025-26", isCarryForward: true, dueDate: "2026-04-01", charge: 1200, feesPending: 1200 }),
  row({ id: "i1", installmentNo: 1, label: "Installment 1", dueDate: "2026-04-20", charge: 7750, feesPaid: 7750 }),
  row({ id: "i2", installmentNo: 2, label: "Installment 2", dueDate: "2026-07-20", charge: 7250, feesPaid: 2000, feesPending: 5250, lateFeePending: 1000, lateFeeRaw: 1000, lateFeeStatus: "pending" }),
  row({ id: "i4", installmentNo: 4, label: "Installment 4", dueDate: "2027-01-20", charge: 7250, feesPending: 7250 }),
];
const TODAY = "2026-10-08";

describe("desk totals keep fees and late fees apart", () => {
  it("splits pending today, not due yet and the late fee", () => {
    expect(deskTotals(LEDGER, TODAY)).toEqual({
      pendingToday: 6450,
      dueToday: 0,
      notDueYet: 14500,
      lateFee: 1000,
      canTakeToday: 7450,
      wholeYear: 21950,
    });
  });

  // An installment due today is neither overdue nor upcoming. It used to be
  // counted as "not due yet", which told the cashier nothing was due that day.
  it("keeps an installment due today apart from overdue and upcoming, and the three add up", () => {
    const totals = deskTotals(LEDGER, "2026-10-20");
    expect(totals).toMatchObject({ pendingToday: 6450, dueToday: 7250, notDueYet: 7250, lateFee: 1000 });
    expect(totals.canTakeToday).toBe(6450 + 7250 + 1000);
    expect(totals.wholeYear).toBe(totals.pendingToday + totals.dueToday + totals.notDueYet + totals.lateFee);
    expect(isDueOn(LEDGER[0], "2026-10-20")).toBe(true);
    expect(isOverdueOn(LEDGER[0], "2026-10-20")).toBe(false);
    expect(isDueOn(LEDGER[1], "2026-04-01")).toBe(false);
  });

  it("splits what is left after a payment the same way", () => {
    const walk = walkPayment(LEDGER, 7450, { paymentDate: "2026-10-20", today: "2026-10-20", waiveLate: false });
    expect(walk.after).toEqual({ pendingToday: 0, dueToday: 7250, notDueYet: 7250, lateFee: 0 });
  });
});

describe("helper chips only fill the amount", () => {
  it("offers overdue, up to the next installments and the whole year, oldest first", () => {
    const chips = helperChips(LEDGER, TODAY, { waiveLate: false });
    expect(chips.map((c) => [c.kind, c.amount])).toEqual([
      ["overdue", 7450],
      ["upto", 14700],
      ["upto", 21950],
    ]);
    expect(chips.every((c) => c.withLate)).toBe(true);
  });

  it("leaves the late fee out of every chip while waiving it", () => {
    const chips = helperChips(LEDGER, TODAY, { waiveLate: true });
    expect(chips.map((c) => c.amount)).toEqual([6450, 13700, 20950]);
    expect(chips.some((c) => c.withLate)).toBe(false);
  });

  // The approved design's set (PayDesk `fm.chips`): overdue fees, the first
  // unpaid installment's balance, up to the installment after it, whole year.
  it("offers the design's four chips, each with the late fee the ledger will take", () => {
    const chips = deskChips(LEDGER, TODAY, { waiveLate: false });
    expect(chips.map((c) => [c.kind, "installmentNo" in c ? c.installmentNo : null, c.amount])).toEqual([
      ["overdue", null, 7450],
      ["installment", 2, 6250],
      ["upto", 3, 14700],
      ["year", null, 21950],
    ]);
    expect(chips.every((c) => c.withLate)).toBe(true);
  });

  it("drops the late fee from the design chips while waiving, and never offers a figure twice", () => {
    expect(deskChips(LEDGER, TODAY, { waiveLate: true }).map((c) => c.amount)).toEqual([6450, 5250, 13700, 20950]);
    const onlyOld = [row({ id: "old", installmentNo: 0, isCarryForward: true, dueDate: "2026-04-01", feesPending: 1200 })];
    expect(deskChips(onlyOld, TODAY, { waiveLate: false }).map((c) => [c.kind, c.amount])).toEqual([["overdue", 1200]]);
    expect(deskChips([], TODAY, { waiveLate: false })).toEqual([]);
  });
});

describe("allocation preview mapping", () => {
  it("clears oldest first: old balance, then Installment 2 fees, then its late fee, then pays ahead", () => {
    const walk = walkPayment(LEDGER, 7000, { paymentDate: TODAY, today: TODAY, waiveLate: false });
    expect(walk.lines.map((l) => [l.row.id, l.feesPaid, l.lateFeePaid, l.state])).toEqual([
      ["old", 1200, 0, "cleared"],
      ["i2", 5250, 550, "part"],
      ["i3", 0, 0, "untouched"],
      ["i4", 0, 0, "untouched"],
    ]);
    expect(walk.alreadyPaid).toEqual(["Installment 1"]);
    expect(walk.after).toEqual({ pendingToday: 0, dueToday: 0, notDueYet: 14500, lateFee: 450 });
    expect(walk.overMax).toBe(false);
    expect(walk.credit).toBe(0);
  });

  it("an advance flows into installments that are not due yet", () => {
    const walk = walkPayment(LEDGER, 10000, { paymentDate: TODAY, today: TODAY, waiveLate: false });
    const i3 = walk.lines.find((l) => l.row.id === "i3");
    expect(i3).toMatchObject({ feesPaid: 2550, feesAfter: 4700, state: "ahead" });
    expect(walk.after).toEqual({ pendingToday: 0, dueToday: 0, notDueYet: 11950, lateFee: 0 });
  });

  it("refuses more than everything owed, because the ledger holds no credit", () => {
    const walk = walkPayment(LEDGER, 22000, { paymentDate: TODAY, today: TODAY, waiveLate: false });
    expect(walk.maxAmount).toBe(21950);
    expect(walk.overMax).toBe(true);
    expect(walk.credit).toBe(0);
  });

  it("waiving takes the whole pending late fee off and lowers the most it will take", () => {
    const walk = walkPayment(LEDGER, 6450, { paymentDate: TODAY, today: TODAY, waiveLate: true });
    expect(walk.waiverAmount).toBe(1000);
    expect(walk.maxAmount).toBe(20950);
    expect(walk.lines.find((l) => l.row.id === "i2")).toMatchObject({ lateFeeWaived: true, lateFeePaid: 0, state: "cleared" });
    expect(walk.after).toEqual({ pendingToday: 0, dueToday: 0, notDueYet: 14500, lateFee: 0 });
  });

  it("follows an EMI plan's rows first, as the posting RPC does", () => {
    const planned = LEDGER.map((r) => (r.id === "i3" ? { ...r, planPriority: 0 } : r));
    const walk = walkPayment(planned, 1000, { paymentDate: TODAY, today: TODAY, waiveLate: false });
    expect(walk.lines[0]).toMatchObject({ row: { id: "i3" }, feesPaid: 1000 });
  });
});

describe("back-dated late fee", () => {
  it("drops the late fee when a payment dated before the due date clears the installment", () => {
    const walk = walkPayment(LEDGER, 7000, { paymentDate: "2026-07-18", today: TODAY, waiveLate: false });
    const i2 = walk.lines.find((l) => l.row.id === "i2");
    expect(i2).toMatchObject({ lateFeeDropped: true, lateFeePaid: 0, lateFeeAfter: 0, state: "cleared" });
    // The ₹1,000 the late fee would have taken pays Installment 3 ahead instead.
    expect(walk.lines.find((l) => l.row.id === "i3")).toMatchObject({ feesPaid: 550 });
    expect(walk.after.lateFee).toBe(0);
  });

  it("keeps the late fee when the back-dated payment does not clear the installment", () => {
    const walk = walkPayment(LEDGER, 3000, { paymentDate: "2026-07-18", today: TODAY, waiveLate: false });
    expect(walk.lines.find((l) => l.row.id === "i2")).toMatchObject({ lateFeeDropped: false, lateFeeAfter: 1000 });
  });

  it("keeps the late fee when the payment is dated after the due date", () => {
    const walk = walkPayment(LEDGER, 7000, { paymentDate: "2026-07-21", today: TODAY, waiveLate: false });
    expect(walk.lines.find((l) => l.row.id === "i2")).toMatchObject({ lateFeeDropped: false, lateFeePaid: 550 });
  });

  it("says which late fees a date can still avoid", () => {
    expect(lateFeesOn(LEDGER, "2026-07-18").avoidable.map((r) => r.id)).toEqual(["i2"]);
    expect(lateFeesOn(LEDGER, TODAY).due.map((r) => r.id)).toEqual(["i2"]);
  });
});

describe("what blocks Review & save", () => {
  const base = { amount: 7000, paymentDate: TODAY, mode: "cash" as const, chequeNo: "", chequeBank: "", waiveLate: false, waiveReason: "" };
  const ctx = { today: TODAY, sessionStart: "2026-04-01", lateFeeOwed: 1000 };
  const ok = { maxAmount: 21950, overMax: false };

  it("passes a plain cash payment", () => {
    expect(deskProblems(base, ok, ctx)).toEqual([]);
  });

  it("names each problem", () => {
    expect(deskProblems({ ...base, amount: 0 }, ok, ctx)).toEqual([{ key: "amount" }]);
    expect(deskProblems(base, { maxAmount: 21950, overMax: true }, ctx)).toEqual([{ key: "over", max: 21950 }]);
    expect(deskProblems({ ...base, paymentDate: "2026-10-09" }, ok, ctx)).toEqual([{ key: "date-future" }]);
    expect(deskProblems({ ...base, paymentDate: "2026-03-31" }, ok, ctx)).toEqual([{ key: "date-before-session", start: "2026-04-01" }]);
    expect(deskProblems({ ...base, paymentDate: "18/07/2026" }, ok, ctx)).toEqual([{ key: "date-invalid" }]);
    expect(deskProblems({ ...base, mode: "cheque", chequeNo: "4518", chequeBank: "" }, ok, ctx)).toEqual([]);
    expect(deskProblems({ ...base, waiveLate: true }, ok, ctx)).toEqual([{ key: "waive-reason" }]);
    expect(deskProblems(base, { maxAmount: 0, overMax: true }, ctx)).toEqual([{ key: "nothing-owed" }]);
  });
});

describe("reference and remarks", () => {
  it("puts the cheque number in the reference and its bank and date in the remarks", () => {
    expect(composeReference({ mode: "cheque", reference: "x", chequeNo: " 004518 " })).toBe("004518");
    expect(composeReference({ mode: "upi", reference: "6281  4410 7735", chequeNo: "" })).toBe("6281 4410 7735");
    expect(composeReference({ mode: "cash", reference: "ignored", chequeNo: "" })).toBe("");
    expect(
      composeRemarks({ mode: "cheque", chequeBank: "SBI Amet", chequeDate: "2026-10-08", waiveLate: true, waiveReason: "First time late", waiveNote: "", notes: "Paid by uncle" }),
    ).toBe("Cheque: SBI Amet, dated 2026-10-08; subject to clearing. Late fee waived: First time late. Paid by uncle");
  });
});

describe("duplicate guard", () => {
  const now = Date.parse("2026-10-08T05:20:00Z");
  const receipts = [
    { id: "a", receiptNumber: "SVP20261008-0014", amount: 3000, mode: "cash", paymentDate: TODAY, createdAt: "2026-10-08T05:12:00Z", isReversed: false },
    { id: "b", receiptNumber: "SVP20261008-0003", amount: 3000, mode: "cash", paymentDate: TODAY, createdAt: "2026-10-08T04:00:00Z", isReversed: false },
  ];

  it("matches the same amount and mode inside ten minutes", () => {
    expect(findRecentDuplicate(receipts, { amount: 3000, mode: "cash" }, now)?.id).toBe("a");
  });

  it("ignores another mode, another amount, an older receipt or a reversed one", () => {
    expect(findRecentDuplicate(receipts, { amount: 3000, mode: "upi" }, now)).toBeNull();
    expect(findRecentDuplicate(receipts, { amount: 3001, mode: "cash" }, now)).toBeNull();
    expect(findRecentDuplicate(receipts, { amount: 3000, mode: "cash" }, now + 3 * 60_000)).toBeNull();
    expect(findRecentDuplicate([{ ...receipts[0], isReversed: true }], { amount: 3000, mode: "cash" }, now)).toBeNull();
  });
});

describe("small helpers", () => {
  it("parses what a cashier types", () => {
    expect(parseAmountInput("₹7,000")).toBe(7000);
    expect(parseAmountInput("7000.50")).toBeNaN();
    expect(parseAmountInput("")).toBe(0);
  });

  it("finds the session's first day without sorting labels", () => {
    expect(sessionStartDate("2026-27")).toBe("2026-04-01");
    expect(sessionStartDate("TEST-2026-27")).toBe("2026-04-01");
  });

  it("counts installments past their due date, and any carry-forward, as pending today", () => {
    expect(
      listPending({ instPending: [0, 5250, 7250, 7250], baseOutstanding: 20950, lateOutstanding: 1000 }, ["2026-04-20", "2026-07-20", "2026-10-20", "2027-01-20"], TODAY),
    ).toEqual({ pendingToday: 6450, lateFee: 1000 });
  });

  it("shortens class labels the way the class picker shows them", () => {
    expect(["Nursery", "JKG", "Class 7", "Class 10", "11 Commerce", "12 Science"].map(shortClassLabel)).toEqual(["Nur", "JKG", "7", "10", "11 C", "12 S"]);
  });

  it("masks a phone and searches by name, SR, father or its last digits", () => {
    expect(maskPhone("+91 98290 12512")).toBe("98290 ••512");
    const s = { name: "Test Student", sr: "1234", father: "Test Father", classLabel: "Class 7", phone: "9829012512" };
    expect(matchesDeskSearch(s, "father")).toBe(true);
    expect(matchesDeskSearch(s, "1234")).toBe(true);
    expect(matchesDeskSearch(s, "512")).toBe(true);
    expect(matchesDeskSearch(s, "nobody")).toBe(false);
  });
});

describe("bulk grid", () => {
  const index = indexStudentsBySr([
    { id: "s1", name: "Test One", sr: "1031", classLabel: "Class 9", father: null },
    { id: "s2", name: "Test Two", sr: "0933", classLabel: "11 Commerce", father: null },
  ]);
  const ctx = { today: TODAY, sessionStart: "2026-04-01" };
  const g = (over: Partial<GridRow>): GridRow => ({ key: "k", sr: "1031", amount: "3000", date: "2026-10-05", mode: "cash", reference: "", ...over });

  it("checks each row the way the design marks it", () => {
    const rows = [g({}), g({ sr: "0933", mode: "cheque" }), g({ sr: "9999" }), g({}), g({ sr: "" }), g({ amount: "abc" }), g({ date: "2026-10-09" })];
    expect(checkGridRows(rows, index, ctx)).toEqual([
      { status: "ok" },
      { status: "warn", reason: "cheque-no" },
      { status: "err", reason: "sr-unknown", sr: "9999" },
      { status: "warn", reason: "repeat", row: 1 },
      { status: "err", reason: "sr-missing" },
      { status: "err", reason: "amount" },
      { status: "err", reason: "date" },
    ]);
  });

  it("totals what will be saved and skips the rows with a problem", () => {
    const rows = [g({}), g({ sr: "9999", amount: "1500" }), g({ sr: "0933", amount: "4000", mode: "bank_transfer", reference: "SBIN2610054471" })];
    const checks = checkGridRows(rows, index, ctx);
    expect(gridTotals(rows, checks)).toEqual({ ready: 2, toCheck: 0, problems: 1, saving: 2, amount: 7000 });
    const { csv, included } = gridToCsv(rows, checks);
    expect(included).toHaveLength(2);
    expect(csv).toBe("SR no,Amount,Payment date,Payment mode,Remarks\n1031,3000,2026-10-05,Cash,\n0933,4000,2026-10-05,Bank transfer,Ref SBIN2610054471\n");
  });

  it("reads a server-validated row back into the grid", () => {
    expect(gridRowFromImport({ admissionNo: "1311", amount: 2350, paymentDate: "2026-10-06", paymentMode: "cheque", remarks: "Cheque no. 004518" }, "x")).toEqual({
      key: "x", sr: "1311", amount: "2350", date: "2026-10-06", mode: "cheque", reference: "004518",
    });
  });
});
