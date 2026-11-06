import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canonical: vi.fn(), feesDues: vi.fn(), feesFamily: vi.fn(), feesPeople: vi.fn(),
  localBoard: vi.fn(), localLeft: vi.fn(), localCalled: vi.fn(), localWeek: vi.fn(), localFamily: vi.fn(), localBriefs: vi.fn(), localPaid: vi.fn(),
  promises: vi.fn(), writeOffs: vi.fn(), session: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: async () => null }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession: mocks.session }));
vi.mock("@/platform/fees-bridge/policy", () => ({ usesCanonicalFees: mocks.canonical }));
vi.mock("@/platform/env", () => ({ isRepaymentPlanCreationEnabled: () => true }));
vi.mock("@/modules/defaulters/vx/fees-data", () => ({ loadDuesFromFees: mocks.feesDues, familyDetailFromFees: mocks.feesFamily, peopleFromFees: mocks.feesPeople }));
vi.mock("@/modules/defaulters/vx/data", () => ({
  loadDuesBoard: mocks.localBoard, loadLeftOwing: mocks.localLeft, studentsCalledToday: mocks.localCalled, collectedThisWeek: mocks.localWeek,
  loadFamilyDetail: mocks.localFamily, studentBriefs: mocks.localBriefs, paymentsSince: mocks.localPaid,
}));
vi.mock("@/vx/screens/dues/data", () => ({ listPromises: mocks.promises, listWriteOffRequests: mocks.writeOffs }));

import { DuesFeesUnavailable, duesReadsFees, loadDues } from "@/vx/screens/dues/load";
import type { CurrentStaff } from "@/platform/auth/current-staff";

const admin = { id: "p", userId: "u", role: "admin", isActive: true, isTeaching: false, language: "en" } as unknown as CurrentStaff;
const student = { studentId: "a", fullName: "TEST Child", fatherName: "TEST Father", fatherPhone: "9000000000", classLabel: "Class 5", transportRouteId: null,
  overdueAmount: 4000, totalPending: 6000, lateFee: 0, notDueYet: 2000, daysOverdue: 17, familyGroupId: null, lastPaymentDate: null, overdueInstallments: [3] };
const board = { students: [student], contacts: {}, classByInst: [] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ sessionLabel: "2026-27" });
  mocks.promises.mockResolvedValue([]); mocks.writeOffs.mockResolvedValue([]);
  mocks.feesDues.mockResolvedValue({ board, left: [], calledIds: ["a"], collectedWeek: 12500, asOf: "2026-11-06T05:00:00Z" });
  mocks.feesFamily.mockResolvedValue({ installments: { a: [] }, contacts: [], meta: {} });
  mocks.feesPeople.mockResolvedValue({ briefs: [], payments: [] });
  mocks.localBoard.mockResolvedValue(board); mocks.localLeft.mockResolvedValue([]); mocks.localCalled.mockResolvedValue([]); mocks.localWeek.mockResolvedValue(0);
  mocks.localBriefs.mockResolvedValue([]); mocks.localPaid.mockResolvedValue([]); mocks.localFamily.mockResolvedValue({ installments: {}, contacts: [] });
});

describe("Dues & calls reads Fees for real staff", () => {
  it("only on a real session under the live connection", () => {
    mocks.canonical.mockReturnValue(true);
    expect(duesReadsFees(admin, "2026-27")).toBe(true);
    expect(duesReadsFees(admin, "TEST-2026-27")).toBe(false);
    mocks.canonical.mockReturnValue(false);
    expect(duesReadsFees(admin, "2026-27")).toBe(false);
  });
  it("live: every figure from Fees, none from the copy, and the writes off", async () => {
    mocks.canonical.mockReturnValue(true);
    const key = (await loadDues(admin, {})).families[0].key;
    const props = await loadDues(admin, { family: key });
    expect(mocks.feesDues).toHaveBeenCalledWith("2026-27");
    expect(mocks.feesFamily).toHaveBeenCalledWith("2026-27", ["a"]);
    for (const local of [mocks.localBoard, mocks.localLeft, mocks.localCalled, mocks.localWeek, mocks.localFamily, mocks.localBriefs, mocks.localPaid]) expect(local).not.toHaveBeenCalled();
    expect(props.live).toEqual({ asOf: "2026-11-06T05:00:00Z" });
    expect(props.metrics).toMatchObject({ collectedWeek: 12500, callsToday: 1, notDueYet: 2000 });
    expect(props.perms).toMatchObject({ log: false, plan: false, writeOff: false, callSheet: false });
  });
  it("live and Fees does not answer: unavailable, never the copy's numbers", async () => {
    mocks.canonical.mockReturnValue(true);
    mocks.feesDues.mockRejectedValue(new Error("timeout"));
    await expect(loadDues(admin, {})).rejects.toBeInstanceOf(DuesFeesUnavailable);
    expect(mocks.localBoard).not.toHaveBeenCalled();
  });
  it("test accounts and TEST sessions keep One's copy and its writes", async () => {
    mocks.canonical.mockReturnValue(false);
    mocks.session.mockResolvedValue({ sessionLabel: "TEST-2026-27" });
    const props = await loadDues(admin, {});
    expect(mocks.feesDues).not.toHaveBeenCalled();
    expect(mocks.localBoard).toHaveBeenCalledWith("TEST-2026-27");
    expect(props.live).toBeNull();
    expect(props.perms.log).toBe(true);
  });
});
