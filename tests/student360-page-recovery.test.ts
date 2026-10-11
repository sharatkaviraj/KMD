import { Children, isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fees: vi.fn(), allowed: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async () => ({ id: "qa-staff", language: "en" }) }));
vi.mock("@/platform/auth/permissions", () => ({ can: (_staff: unknown, permission: string) => permission === "fees:view" ? state.allowed : false }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "QA" }));
vi.mock("@/modules/students-fees/vx/admin-students", () => ({ studentFees: state.fees }));
vi.mock("@/vx/screens/admin/notes-tab", () => ({ notesForStudentTab: async () => [], canWriteNotes: () => false }));
vi.mock("@/vx/screens/admin/data", () => ({ loadStudentSchool: async () => ({
  card: { fullName: "QA Child", admissionNo: "QA-1", status: "active", fatherName: null, motherName: null, guardianPhone: null, primaryPhone: null },
  classLabel: "QA Class", rollNo: "1", closedDays: [], attendance: [], attendancePercent: 90, attendanceCounted: 10, terms: [], documents: [], history: [],
}) }));
import StudentPage from "@/app/(app)/students/[id]/page";
import { Student360, type Student360Fees, type Student360Props } from "@/vx/screens/admin/student360";
async function card() {
  const result = await StudentPage({ params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }), searchParams: Promise.resolve({}) });
  const child = Children.toArray(result.props.children).find(node => isValidElement(node) && node.type === Student360) as ReactElement<{ p: Student360Props; fees?: Promise<Student360Fees | null> }>;
  return child.props;
}
beforeEach(() => { state.allowed = true; state.fees.mockReset(); });
describe("Student page fee failure mapping", () => {
  it("streams the school model without waiting for a fee result", async () => {
    let finish!: (value: null) => void;
    state.fees.mockReturnValue(new Promise<null>(resolve => { finish = resolve; }));
    const props = await card(); expect(props.p.name).toBe("QA Child"); expect(props.fees).toBeInstanceOf(Promise);
    finish(null); await expect(props.fees).resolves.toBeNull();
  });
  it("turns failed fee reads into unavailable rather than an empty record", async () => {
    state.fees.mockRejectedValue(new Error("QA read failure"));
    const props = await card(); expect(props.p.attendance.percent).toBe(90);
    await expect(props.fees).resolves.toEqual({ unavailable: true });
  });
  it("does not start a fee read for a reader without fees:view", async () => {
    state.allowed = false; const props = await card();
    expect(props.fees).toBeUndefined(); expect(props.p.tabs).not.toContain("fees"); expect(state.fees).not.toHaveBeenCalled();
  });
});
