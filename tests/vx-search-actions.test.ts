import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The search palette's one server call keeps its permission checks while it
 * draws the design's results (D07/F04): money words only for `fees:view`,
 * Collect only for `fees:collect`, receipts only for the fee desk, nothing
 * for a reader with neither roster nor fee access. Synthetic records only.
 */

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  students: vi.fn(),
  master: vi.fn(),
  receipts: vi.fn(),
  recent: vi.fn(),
}));

vi.mock("@/platform/auth/current-staff", () => ({ assertStaff: vi.fn(async () => ({ id: "qa-staff", role: "admin" })) }));
vi.mock("@/platform/auth/permissions", () => ({ can: (_staff: unknown, p: string) => state.perms.has(p) }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: vi.fn(async () => null) }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession: vi.fn(async () => ({ sessionLabel: "QA-2026-27" })) }));
vi.mock("@/modules/students-fees/data/queries", () => ({ getStudents: state.students, getStudentMasterFieldsByIds: state.master }));
vi.mock("@/modules/receipts/data/queries", () => ({ getReceiptsList: state.receipts }));
vi.mock("@/modules/students-fees/vx/admin-students", () => ({ recentReceiptsFor: state.recent }));
vi.mock("@/modules/staff/data/staff-repo", () => ({
  listStaff: vi.fn(async () => [
    { id: "qa-t1", displayName: "Jainendra Test", shortName: "JT", isActive: true },
    { id: "qa-t2", displayName: "Old Teacher", shortName: "OT", isActive: false },
  ]),
}));

import { searchEverythingAction } from "@/vx/shell/search-actions";

const child = {
  id: "qa-child",
  fullName: "Aarav Test",
  classLabel: "Class 7",
  admissionNo: "0001",
  fatherPhone: "9000000001",
  motherPhone: null,
  overdueAmount: 4200,
  outstandingAmount: 17500,
  pendingLateFeeAmount: 100,
  totalPaid: 6800,
  totalDue: 24400,
  lateFeeTotal: 100,
};

beforeEach(() => {
  vi.clearAllMocks();
  state.perms = new Set();
  state.students.mockResolvedValue([child]);
  state.master.mockResolvedValue(new Map([["qa-child", { fatherName: "Synthetic Father", motherName: null }]]));
  state.receipts.mockResolvedValue([]);
  state.recent.mockResolvedValue([{ id: "qa-r1", number: "QA-0001", amount: 2400, date: "2026-10-02", mode: "upi", reversed: true }]);
});

describe("searchEverythingAction", () => {
  it("finds a colleague by name for whoever may see the staff list (school-day run B12)", async () => {
    state.perms = new Set(["staff:view"]);
    const r = await searchEverythingAction("jainendra");
    expect(r.staff).toEqual([{ id: "qa-t1", name: "Jainendra Test", short: "JT", href: "/staff?id=qa-t1" }]);
    expect(state.students).not.toHaveBeenCalled();
  });

  it("sends a reader with only the timetable to the teacher's week, and never lists former staff", async () => {
    state.perms = new Set(["timetable:view"]);
    expect((await searchEverythingAction("test")).staff?.map((s) => s.href)).toEqual(["/timetable?view=teacher&teacher=qa-t1"]);
    expect(await searchEverythingAction("old")).toEqual({ students: [], receipts: [], actions: [] });
  });

  it("gives a reader with neither roster nor fee access nothing, and reads nothing", async () => {
    expect(await searchEverythingAction("aarav")).toEqual({ students: [], receipts: [], actions: [] });
    expect(state.students).not.toHaveBeenCalled();
  });

  it("finds students for the roster but no money, no Collect and no receipts", async () => {
    state.perms = new Set(["students:view"]);
    const r = await searchEverythingAction("aarav");
    expect(r.students).toEqual([expect.objectContaining({ name: "Aarav Test", parent: "Synthetic Father", money: null, href: "/students/qa-child" })]);
    expect(r.actions.map((a) => a.kind)).toEqual(["call"]);
    expect(r.receipts).toEqual([]);
    expect(state.recent).not.toHaveBeenCalled();
  });

  it("gives the fee desk pending today without the late fee, Collect, and the child's latest receipts marked reversed", async () => {
    state.perms = new Set(["students:view", "fees:view", "fees:collect"]);
    const r = await searchEverythingAction("aarav");
    expect(r.students[0].money).toEqual({ kind: "pending", amount: 4200 });
    expect(r.actions[0]).toEqual({ kind: "collect", href: "/payments?student=qa-child", student: "Aarav Test", pending: 4200 });
    expect(r.actions[1]).toEqual(expect.objectContaining({ kind: "call", tel: "9000000001", who: "Synthetic Father", relation: "father" }));
    expect(r.receipts).toEqual([expect.objectContaining({ number: "QA-0001", reversed: true, byChild: true })]);
  });

  it("does not search for one letter", async () => {
    state.perms = new Set(["students:view", "fees:view"]);
    expect(await searchEverythingAction("a")).toEqual({ students: [], receipts: [], actions: [] });
    expect(state.students).not.toHaveBeenCalled();
  });
});
