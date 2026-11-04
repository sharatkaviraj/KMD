import { beforeEach, describe, expect, it, vi } from "vitest";
import { bridgeSectionsFixture, bridgeWorkspaceFixture, sourceReceiptId, sourceStudentId } from "./fixtures/bridge-student-workspace";

/**
 * Review P02: the callers that used to read a child's whole Fees workspace now
 * ask for what they show. The palette's receipt cards ask for their two
 * receipts; `studentFees` for the money band, receipts and family.
 */
const state = vi.hoisted(() => ({ staff: vi.fn(), receipts: vi.fn(), view: vi.fn(), workspace: vi.fn(), canSeeReceipts: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.staff }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: async () => "2026-27" }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession: async () => ({ sessionLabel: "2026-27" }) }));
vi.mock("@/platform/fees-bridge/policy", async (original) => ({ ...await original<Record<string, unknown>>(), usesCanonicalFees: () => true }));
vi.mock("@/platform/fees-bridge/read-permissions", async (original) => {
  const real = await original<typeof import("@/platform/fees-bridge/read-permissions")>();
  return { ...real, oneStudentReadPermissions: (staff: never) => ({ ...real.oneStudentReadPermissions(staff), receipts: state.canSeeReceipts }) };
});
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeDirectory: vi.fn(), getBridgeStudentReceipts: state.receipts, getBridgeStudentView: state.view, getBridgeWorkspace: state.workspace }));
import { recentReceiptsFor, studentFees } from "@/modules/students-fees/vx/admin-students";

beforeEach(() => {
  vi.clearAllMocks(); state.canSeeReceipts = true;
  state.staff.mockResolvedValue({ id: sourceStudentId, userId: sourceStudentId, role: "office", permissions: ["students:view", "fees:view"] });
  state.receipts.mockResolvedValue(bridgeSectionsFixture().receipts);
  state.view.mockResolvedValue(bridgeWorkspaceFixture());
});

describe("Fees student read callers", () => {
  it("the palette's receipt cards ask Fees for exactly the receipts they show", async () => {
    const rows = await recentReceiptsFor(sourceStudentId);
    expect(state.receipts).toHaveBeenCalledWith(sourceStudentId, "2026-27", { pageSize: 2 });
    expect(rows).toEqual([{ id: sourceReceiptId, number: "SYN20261101-0001", amount: 1000, date: "2026-11-01", mode: "cash", reversed: false, session: "2026-27" }]);
    expect(state.view).not.toHaveBeenCalled(); expect(state.workspace).not.toHaveBeenCalled();
    await recentReceiptsFor(sourceStudentId, 500);
    expect(state.receipts).toHaveBeenLastCalledWith(sourceStudentId, "2026-27", { pageSize: 100 });
  });
  it("a role that cannot see receipts gets none, without a Fees read", async () => {
    state.canSeeReceipts = false;
    expect(await recentReceiptsFor(sourceStudentId)).toEqual([]);
    expect(state.receipts).not.toHaveBeenCalled();
  });
  it("Fees refusing the receipts reads as none, and a failed read still fails", async () => {
    state.receipts.mockResolvedValue({ ...bridgeSectionsFixture().receipts, receipts: null, pagination: null });
    expect(await recentReceiptsFor(sourceStudentId)).toEqual([]);
    state.receipts.mockRejectedValue(new Error("unavailable"));
    await expect(recentReceiptsFor(sourceStudentId)).rejects.toThrow("unavailable");
  });
  it("studentFees asks for the money band, receipts and family only", async () => {
    const fees = await studentFees(sourceStudentId);
    expect(state.view).toHaveBeenCalledWith(sourceStudentId, "2026-27", {}, ["receipts", "household"]);
    expect(fees.summary.paidThisSession).toBe(1000); expect(fees.receipts).toHaveLength(1); expect(fees.family).toHaveLength(1);
    expect(state.workspace).not.toHaveBeenCalled();
  });
});
