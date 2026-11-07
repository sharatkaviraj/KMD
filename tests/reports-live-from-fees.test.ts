import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  balances: vi.fn(), receipts: vi.fn(), daybook: vi.fn(),
  copyClasses: vi.fn(), copyBalances: vi.fn(), copyReceipts: vi.fn(), schedules: vi.fn(), teachers: vi.fn(), finance: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeReportBalances: m.balances, getBridgeReportReceipts: m.receipts, getBridgeReportDaybook: m.daybook }));
vi.mock("@/modules/reports/vx/reports-data", () => ({
  getClasses: m.copyClasses, getInstallmentBalances: m.copyBalances, getCollectionReceipts: m.copyReceipts,
  getReportSchedules: m.schedules, withClassTeachers: m.teachers,
}));
vi.mock("@/modules/finance-controls/data/queries", () => ({ getFinanceControlsPageData: m.finance }));

import { getReportsPageData } from "@/modules/reports/vx/reports-page-data";
import { bridgeReportBalancesSchema, bridgeReportDaybookSchema, bridgeReportReceiptsSchema } from "@/platform/fees-bridge/screen-read-contracts";

const pins = { sessionLabel: "2026-27", asOf: "2026-11-07T04:00:00Z", asOfDate: "2026-11-07" };
const feesClass = { id: "c1", className: "Class 5", section: "A", streamName: null, sortOrder: 5 };
const balance = { studentId: "s1", studentName: "TEST Child", admissionNo: "TEST-1", fatherName: null, fatherPhone: "9000000000", classId: "c1",
  classLabel: "Class 5 A", installmentNo: 3, dueDate: "2026-10-20", pendingAmount: 4000, lateFeePending: 1000, studentStatus: "active", isCarryForward: false };
const input = { sheet: "" as const, today: "2026-11-07", sessionLabel: "2026-27", schoolName: "TEST School", preset: "month" as const };

beforeEach(() => {
  vi.clearAllMocks();
  m.balances.mockResolvedValue({ ...pins, classes: [feesClass], balances: [balance] });
  m.receipts.mockResolvedValue({ ...pins, asOf: "2026-11-07T04:00:05Z", from: "2026-11-01", to: "2026-11-07", classes: [feesClass],
    receipts: [{ paymentDate: "2026-11-07", paymentMode: "upi", amount: 1500, classId: "c1", reversed: false }] });
  m.daybook.mockResolvedValue({ ...pins, date: "2026-11-06", closure: null, collected: 0, paidOut: 0, receiptCount: 0, reversedCount: 0, rows: [] });
  m.teachers.mockImplementation(async (classes: typeof feesClass[]) => classes.map((c) => ({ id: c.id, label: "Class 5 A", sortOrder: 5, teacher: null, teacherPhone: null })));
  m.schedules.mockResolvedValue([]);
  for (const copy of [m.copyClasses, m.copyBalances, m.copyReceipts, m.finance]) copy.mockRejectedValue(new Error("the copy must not be read"));
});

describe("Reports read from Fees for real staff (7 Nov 2026)", () => {
  it("the hub reads balances and receipts from Fees, never the copy, and says when", async () => {
    const data = await getReportsPageData({ ...input, view: "hub", live: true });
    expect(m.balances).toHaveBeenCalledWith("2026-27");
    expect(m.receipts).toHaveBeenCalledWith("2026-27", "2026-10-25", "2026-11-07");
    expect(data.hub).toMatchObject({ todayTotal: 1500, todayReceipts: 1, pendingToday: 4000, lateFeePending: 1000, defaulters: 1 });
    expect(data.classes.map((c) => c.id)).toEqual(["c1"]);
    expect(m.teachers).toHaveBeenCalledWith([feesClass], "2026-27");
    expect(data.liveAsOf).toBe("2026-11-07T04:00:00Z");
  });
  it("collection names classes from the receipts' own classes", async () => {
    const data = await getReportsPageData({ ...input, view: "collection", live: true });
    expect(m.balances).not.toHaveBeenCalled();
    expect(data.classes.map((c) => c.id)).toEqual(["c1"]);
    expect(data.collection?.receipts).toEqual([{ date: "2026-11-07", mode: "upi", amount: 1500, classId: "c1", reversed: false }]);
  });
  it("the day book is Fees' own, not before today", async () => {
    const data = await getReportsPageData({ ...input, view: "daybook", date: "2026-12-01", live: true });
    expect(m.daybook).toHaveBeenCalledWith("2026-27", "2026-11-07");
    expect(data.daybook).toEqual({ date: "2026-11-06", closure: null, collected: 0, paidOut: 0, receiptCount: 0, reversedCount: 0, rows: [] });
    expect(data.classes).toEqual([]);
  });
  it("a Fees failure is not covered with the copy's numbers", async () => {
    m.balances.mockRejectedValue(new Error("source_unavailable"));
    await expect(getReportsPageData({ ...input, view: "defaulters", live: true })).rejects.toThrow("source_unavailable");
    expect(m.copyBalances).not.toHaveBeenCalled();
  });
  it("TEST sessions keep One's copy and never call Fees", async () => {
    m.copyClasses.mockResolvedValue([]); m.copyBalances.mockResolvedValue([]);
    const data = await getReportsPageData({ ...input, sessionLabel: "TEST-2026-27", view: "defaulters" });
    expect(m.balances).not.toHaveBeenCalled();
    expect(data.liveAsOf).toBeNull();
  });
  it("the contracts parse what Fees sends", () => {
    expect(bridgeReportBalancesSchema.safeParse({ ...pins, classes: [feesClass], balances: [balance] }).success).toBe(true);
    expect(bridgeReportReceiptsSchema.safeParse({ ...pins, from: "a", to: "b", classes: [], receipts: [{ paymentDate: "2026-11-01", paymentMode: "cash", amount: 1, classId: null, reversed: true }] }).success).toBe(true);
    expect(bridgeReportDaybookSchema.safeParse({ ...pins, date: "2026-11-06", closure: { status: "closed", closedAt: null, closedByName: null }, collected: 5, paidOut: 0,
      receiptCount: 1, reversedCount: 0, rows: [{ id: "collection-e1", type: "collection", postedAt: "x", studentId: null, studentName: "TEST", classLabel: null,
        receiptNumber: "SVP-1", mode: "cash", cashIn: 5, cashOut: 0, status: "Posted", tone: "good", note: null }] }).success).toBe(true);
    expect(bridgeReportBalancesSchema.safeParse({ ...pins, classes: [], balances: [{ ...balance, pendingAmount: "4000" }] }).success).toBe(false);
  });
});
