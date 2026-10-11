import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertPermission: vi.fn(), preview: vi.fn(), receipts: vi.fn(), history: vi.fn(), insert: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/(app)/fees/payments/actions", () => ({ reverseReceiptAdminAction: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: mocks.assertPermission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: mocks.preview }));
vi.mock("@/modules/receipts/vx/data", () => ({ loadDeskReceipts: mocks.receipts, getDeskReceipt: vi.fn() }));
vi.mock("@/vx/screens/receipts/data", () => ({
  listCloseEvents: mocks.history, insertCloseEvent: mocks.insert,
  approveReversalRequests: vi.fn(), insertReversalRequest: vi.fn(),
}));

import { closeDayAction, reopenDayAction } from "@/app/(app)/receipts/actions";

const input = { date: "2026-10-10", sessionLabel: "QA-2026-27", denominations: {}, upiChecked: true, note: "QA counted cash" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertPermission.mockResolvedValue({ id: "qa-staff", displayName: "QA desk" });
  mocks.preview.mockResolvedValue(undefined);
  mocks.history.mockResolvedValue([]);
  mocks.receipts.mockResolvedValue({ rows: [], truncated: false });
  mocks.insert.mockResolvedValue(undefined);
});

describe("day close writes require a complete, session-scoped read", () => {
  it("refuses 501-receipt truncated data instead of persisting 500-receipt totals", async () => {
    mocks.receipts.mockResolvedValue({ rows: Array.from({ length: 500 }, (_, i) => ({
      id: `qa-${i}`, receiptNumber: `QA-${i}`, paymentDate: input.date,
      createdAt: "2026-10-10T10:00:00Z", paymentMode: "cash", totalAmount: 1, isReversed: false,
    })), truncated: true });
    const result = await closeDayAction(input);
    expect(result.ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("requests close history for the selected academic session", async () => {
    expect((await closeDayAction(input)).ok).toBe(true);
    expect(mocks.history).toHaveBeenCalledWith(input.date, input.date, { strict: true, sessionLabel: input.sessionLabel });
  });
  it("requests reopen history for the selected academic session", async () => {
    mocks.history.mockResolvedValue([{ action: "close", createdAt: "2026-10-10T10:00:00Z" }]);
    expect((await reopenDayAction(input)).ok).toBe(true);
    expect(mocks.history).toHaveBeenCalledWith(input.date, input.date, { strict: true, sessionLabel: input.sessionLabel });
  });
  it.each(["history", "receipts"] as const)("a failed %s read never closes an apparently empty day", async (read) => {
    mocks[read].mockRejectedValue(new Error("QA dependency unavailable"));
    expect(await closeDayAction(input)).toEqual({ ok: false, error: "QA dependency unavailable" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not mutate when authorization is refused", async () => {
    mocks.assertPermission.mockRejectedValue(new Error("Denied"));
    expect((await closeDayAction(input)).ok).toBe(false);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("does not mutate from role preview", async () => {
    mocks.preview.mockRejectedValue(new Error("Preview"));
    expect((await closeDayAction(input)).ok).toBe(false);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("persists only same-day non-reversed receipts and sanitized finite note counts", async () => {
    mocks.receipts.mockResolvedValue({ rows: [
      { paymentDate: input.date, totalAmount: 10, paymentMode: "cash", isReversed: false },
      { paymentDate: input.date, totalAmount: 100, paymentMode: "upi", isReversed: false },
      { paymentDate: input.date, totalAmount: 80, paymentMode: "cash", isReversed: true },
      { paymentDate: "2026-10-09", totalAmount: 900, paymentMode: "cash", isReversed: false },
    ], truncated: false });
    expect((await closeDayAction({ ...input, note: "", denominations: { 100: Infinity, 50: NaN, 20: -2, 10: 1.9 } })).ok).toBe(true);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ cashExpected: 10, cashCounted: 10, expected: { cash: 10, upi: 100, cheque: 0, bank: 0, total: 110 }, receiptCount: 2, reversedCount: 1, denominations: { "10": 1 } }));
  });
  it.each(["", "  "])("a missing session %j cannot create an empty-day close", async (sessionLabel) => {
    expect((await closeDayAction({ ...input, sessionLabel })).ok).toBe(false); expect(mocks.history).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("a failed insert never reports a successful close", async () => {
    mocks.insert.mockRejectedValue(new Error("QA insert failed")); expect(await closeDayAction(input)).toEqual({ ok: false, error: "QA insert failed" });
  });
  it("a repeated close is refused after a previous close is observed", async () => {
    mocks.history.mockResolvedValue([{ action: "close", createdAt: "2026-10-10T10:00:00Z" }]);
    expect((await closeDayAction(input)).ok).toBe(false); expect(mocks.receipts).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each(["denied", "preview", "history", "insert"])("reopen refuses %s without claiming success", async (failure) => {
    mocks.history.mockResolvedValue([{ action: "close", createdAt: "2026-10-10T10:00:00Z" }]);
    if (failure === "denied") mocks.assertPermission.mockRejectedValue(new Error("QA denied"));
    if (failure === "preview") mocks.preview.mockRejectedValue(new Error("QA preview"));
    if (failure === "history") mocks.history.mockRejectedValue(new Error("QA history"));
    if (failure === "insert") mocks.insert.mockRejectedValue(new Error("QA insert"));
    expect((await reopenDayAction(input)).ok).toBe(false);
    expect(mocks.assertPermission).toHaveBeenCalledWith("fees:manage");
    if (failure !== "insert") expect(mocks.insert).not.toHaveBeenCalled();
  });
  it("characterizes the unresolved database race: two callers can observe the same open history", async () => {
    // This is an explicit remaining defect, not an assertion of atomic safety.
    // The table has no serialized transition RPC/unique open-state constraint.
    let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
    mocks.history.mockImplementation(async () => { await barrier; return []; });
    const first = closeDayAction(input); const second = closeDayAction(input);
    await Promise.resolve(); await Promise.resolve(); release();
    expect((await Promise.all([first, second])).map(result => result.ok)).toEqual([true, true]);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
  });
});
