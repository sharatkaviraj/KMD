import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), family: vi.fn(), detail: vi.fn(), snapshot: vi.fn(), balances: vi.fn(), receiptError: null as null | { message: string } }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: mocks.permission }));
vi.mock("@/modules/fees/data/queries", () => ({ getWorkbookInstallmentBalances: mocks.balances }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: async () => "QA" }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession: async () => ({ sessionLabel: "QA" }) }));
vi.mock("@/modules/receipts/data/reversals", () => ({ getReceiptReversalTotals: async () => new Map(), isReceiptReversed: () => false }));
vi.mock("@/modules/students-fees/data/directory", () => ({ getStudentSegmentCounts: vi.fn() }));
vi.mock("@/modules/students-fees/data/queries", () => ({ getStudentDetail: mocks.detail, getStudentFamilyMembersDetail: mocks.family, getStudentsPage: vi.fn() }));
vi.mock("@/modules/fees/data/policy", () => ({ getStudentFinancialSnapshot: mocks.snapshot }));
vi.mock("@/modules/fees/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, limit: () => query,
    returns: async () => ({ data: [], error: mocks.receiptError }) }; return query;
} }) }));
import { studentFees } from "@/modules/students-fees/vx/admin-students";
beforeEach(() => {
  mocks.permission.mockReset().mockResolvedValue({ id: "qa-reader" });
  mocks.family.mockReset().mockResolvedValue({ familyGroupId: null, members: [] });
  mocks.detail.mockReset().mockResolvedValue(null); mocks.snapshot.mockReset().mockResolvedValue(null);
  mocks.balances.mockReset().mockResolvedValue([]); mocks.receiptError = null;
});
describe("Student 360 fee reader error recovery", () => {
  it("keeps genuine empty data distinct from failed reads", async () => {
    const result = await studentFees("qa-child");
    expect(result.family).toEqual([]); expect(result.installments).toEqual([]); expect(result.summary.creditBalance).toBe(0);
  });
  it.each(["family", "detail", "snapshot", "balances"] as const)("surfaces a failed %s read rather than empty or zero data", async key => {
    mocks[key].mockRejectedValue(new Error(`QA ${key} unavailable`));
    await expect(studentFees("qa-child")).rejects.toThrow(`QA ${key} unavailable`);
  });
  it("surfaces a receipt read failure", async () => {
    mocks.receiptError = { message: "QA receipts unavailable" };
    await expect(studentFees("qa-child")).rejects.toThrow("QA receipts unavailable");
  });
  it("refuses before any fee read if authorization fails", async () => {
    mocks.permission.mockRejectedValue(new Error("QA denied"));
    await expect(studentFees("qa-child")).rejects.toThrow("QA denied");
    expect(mocks.balances).not.toHaveBeenCalled(); expect(mocks.family).not.toHaveBeenCalled();
  });
});
