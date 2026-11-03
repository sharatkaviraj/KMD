import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  canonical: false,
  officeReads: false,
  directory: vi.fn(),
  roster: vi.fn(),
  lookup: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("@/platform/auth/current-staff", () => ({ assertStaff: vi.fn(async () => ({ id: "qa-staff", role: "admin" })) }));
vi.mock("@/platform/auth/permissions", () => ({ can: (_staff: unknown, p: string) => state.perms.has(p) }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: vi.fn(async () => null) }));
vi.mock("@/modules/fees/platform/session-context/resolver", () => ({ resolveViewSession: vi.fn(async () => ({ sessionLabel: "QA-2026-27" })) }));
vi.mock("@/modules/students-fees/data/queries", () => ({ getStudents: state.students, getStudentMasterFieldsByIds: state.master }));
vi.mock("@/modules/receipts/data/queries", () => ({ getReceiptsList: state.receipts }));
vi.mock("@/modules/students-fees/vx/admin-students", () => ({ recentReceiptsFor: state.recent }));
vi.mock("@/modules/academics/data/academics-repo", () => ({
  resolveSessionLabel: vi.fn(async () => (state.canonical ? "2026-27" : "QA-2026-27")),
  classLabelMap: vi.fn(async () => new Map([["qa-class-7", "Class 7"]])),
}));
vi.mock("@/platform/fees-bridge/policy", () => ({ usesCanonicalFees: () => state.canonical, feesBridgeOfficeReads: () => state.officeReads }));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeDirectory: state.directory, lookupBridgeReceipt: state.lookup, getBridgeReceiptDetail: state.detail }));
vi.mock("@/modules/students/data/directory-repo", () => ({ searchStudents: state.roster }));
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

  it("says the students part failed instead of returning a confident empty list", async () => {
    state.perms = new Set(["students:view", "fees:view"]);
    state.students.mockRejectedValue(new Error("refused"));
    const r = await searchEverythingAction("aarav");
    expect(r.students).toEqual([]);
    expect(r.failed).toEqual(["students"]);
  });
});

describe("searchEverythingAction under the live Fees connection (S01)", () => {
  const row = {
    id: "qa-child", classId: "qa-class-7", fullName: "Aarav Test", admissionNo: "0001", classLabel: "Class 7", status: "active",
    fatherName: "Synthetic Father", motherName: "Synthetic Mother", fatherPhone: "9000000001", motherPhone: "9000000002",
    overdueAmount: 4200, outstandingAmount: 17500, pendingLateFeeAmount: 100, totalPaid: 6800, totalDue: 24400, lateFeeTotal: 100,
  };
  const page = (students: unknown[]) => ({ sessionLabel: "2026-27", students });

  beforeEach(() => {
    state.canonical = true;
    state.directory.mockResolvedValue(page([row]));
    state.roster.mockResolvedValue({ rows: [{ studentId: "qa-child", fullName: "Aarav Test", admissionNo: "0001", fatherName: "Synthetic Father", guardianPhone: "9000000001", classId: "qa-class-7", rollNo: "4" }], total: 1 });
    state.recent.mockResolvedValue([{ id: "00000000-0000-4000-8000-000000000001", number: "SVP-1", amount: 2400, date: "2026-10-02", mode: "upi", reversed: false, session: "2026-27" }]);
  });
  afterEach(() => {
    state.canonical = false;
    state.officeReads = false;
  });

  it("finds a typed receipt number through Fees' lookup once it is on", async () => {
    state.perms = new Set(["fees:view"]);
    state.officeReads = true;
    state.directory.mockResolvedValue(page([]));
    state.lookup.mockResolvedValue({ receiptId: "00000000-0000-4000-8000-000000000009", receiptNumber: "SVP20261103-0001", studentId: "qa-child" });
    state.detail.mockResolvedValue({ detail: { totalAmount: 2400, studentFullName: "Aarav Test", paymentDate: "2026-11-03", paymentMode: "cash", isVoided: false, reversedAmount: 0 } });
    const r = await searchEverythingAction("SVP20261103-0001");
    expect(state.lookup).toHaveBeenCalledWith("SVP20261103-0001", "2026-27");
    expect(r.receipts).toEqual([expect.objectContaining({ number: "SVP20261103-0001", amount: 2400, href: "/receipts/SVP20261103-0001?receiptId=00000000-0000-4000-8000-000000000009&session=2026-27" })]);
    expect(r.failed).toBeUndefined();
  });

  it("asks the Fees directory, never the refused local tables, and keeps money, Collect and the call", async () => {
    state.perms = new Set(["students:view", "fees:view", "fees:collect"]);
    const r = await searchEverythingAction("aarav");
    expect(state.students).not.toHaveBeenCalled();
    expect(state.receipts).not.toHaveBeenCalled();
    expect(state.directory).toHaveBeenCalledWith(expect.objectContaining({ sessionLabel: "2026-27", query: "aarav", status: "active", pageSize: 5 }));
    expect(r.students[0]).toEqual(expect.objectContaining({ name: "Aarav Test", sr: "0001", parent: "Synthetic Father", money: { kind: "pending", amount: 4200 } }));
    expect(r.actions.map((a) => a.kind)).toEqual(["collect", "call"]);
    expect(r.failed).toBeUndefined();
  });

  it("links a child's receipt with its source id and session, so the receipt page can open it", async () => {
    state.perms = new Set(["students:view", "fees:view"]);
    const r = await searchEverythingAction("aarav");
    expect(r.receipts[0].href).toBe("/receipts/SVP-1?receiptId=00000000-0000-4000-8000-000000000001&session=2026-27");
  });

  it("finds a child who has left when nobody on the roll matches", async () => {
    state.perms = new Set(["fees:view"]);
    state.directory.mockResolvedValueOnce(page([])).mockResolvedValueOnce(page([row]));
    const r = await searchEverythingAction("aarav");
    expect(state.directory.mock.calls.map(([input]) => input.status)).toEqual(["active", "all"]);
    expect(r.students).toHaveLength(1);
  });

  it("explains a parent's-name match and sends a pasted phone as ten digits", async () => {
    state.perms = new Set(["fees:view"]);
    expect((await searchEverythingAction("synthetic mother")).students[0].why).toEqual({ kind: "mother", text: "Synthetic Mother" });
    await searchEverythingAction("+91 90000 00002");
    expect(state.directory).toHaveBeenLastCalledWith(expect.objectContaining({ query: "9000000002" }));
  });

  it("uses One's own roster for a reader without fee access", async () => {
    state.perms = new Set(["students:view"]);
    const r = await searchEverythingAction("aarav");
    expect(state.directory).not.toHaveBeenCalled();
    expect(state.roster).toHaveBeenCalledWith({ text: "aarav", classId: null, page: 1 }, "2026-27");
    expect(r.students[0]).toEqual(expect.objectContaining({ classLabel: "Class 7", money: null, href: "/students/qa-child" }));
  });

  it("reports a failed Fees read instead of Nothing matches", async () => {
    state.perms = new Set(["fees:view"]);
    state.directory.mockRejectedValue(new Error("source down"));
    const r = await searchEverythingAction("aarav");
    expect(r.students).toEqual([]);
    expect(r.failed).toEqual(["students"]);
  });
});
