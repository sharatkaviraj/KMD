import { Children, isValidElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fees: vi.fn(), photo: vi.fn(), contacts: vi.fn(), allowed: true, photosAllowed: false, contactAllowed: false, previewing: null as "teacher" | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ requirePermission: async () => ({ id: "qa-staff", language: "en" }) }));
vi.mock("@/vx/view-as", () => ({ getViewer: async () => ({ previewing: state.previewing }) }));
vi.mock("@/platform/auth/permissions", () => ({ can: (_staff: unknown, permission: string) => permission === "fees:view" ? state.allowed : permission === "collection:manage" ? state.photosAllowed : false }));
vi.mock("@/modules/collection/data/approved-photos", () => ({ approvedStudentPhotos: state.photo }));
vi.mock("@/vx/screens/family-contact/data", () => ({ familyContactAccess: async () => state.contactAllowed, familyContacts: state.contacts }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "QA" }));
vi.mock("@/modules/students-fees/vx/admin-students", () => ({ studentFees: state.fees }));
vi.mock("@/vx/screens/admin/notes-tab", () => ({ notesForStudentTab: async () => [], canWriteNotes: () => false }));
vi.mock("@/vx/screens/admin/data", () => ({ loadStudentSchool: async () => ({
  card: { fullName: "QA Child", admissionNo: "QA-1", status: "active", fatherName: null, motherName: null, guardianPhone: null, primaryPhone: null },
  classLabel: "QA Class", rollNo: "1", closedDays: [], attendance: [], attendancePercent: 90, attendanceCounted: 10, terms: [], documents: [], history: [],
}) }));
import { Student360Content } from "@/vx/screens/admin/student360-page";
import { Student360, type Student360Fees, type Student360Props } from "@/vx/screens/admin/student360";
async function card() {
  // The page and the list's drawer both render this reader (students/@drawer/(.)[id]).
  const result = await Student360Content({ id: "00000000-0000-4000-8000-000000000001", search: {} });
  const child = Children.toArray(result.props.children).find(node => isValidElement(node) && node.type === Student360) as ReactElement<{ p: Student360Props; fees?: Promise<Student360Fees | null> }>;
  return child.props;
}
beforeEach(() => { state.allowed = true; state.photosAllowed = false; state.contactAllowed = false; state.previewing = null; state.fees.mockReset(); state.photo.mockReset().mockResolvedValue(new Map()); state.contacts.mockReset(); });
describe("Student page fee failure mapping", () => {
  it("keeps a failed contact history unavailable rather than an empty contact log", async () => {
    state.fees.mockResolvedValue(null); state.contactAllowed = true; state.contacts.mockRejectedValue(new Error("Synthetic read failure"));
    const props = await card(); expect(props.p.contacts).toBeNull(); expect(props.p.unavailable).toContain("contacts");
  });
  it("uses the current-authorized approved portrait reader even without collection editing permission", async () => {
    state.fees.mockResolvedValue(null); const props = await card();
    expect(props.p.photoUrl).toBeNull(); expect(state.photo).toHaveBeenCalledWith(["00000000-0000-4000-8000-000000000001"]);
  });
  it("uses only the permitted private portrait and falls back on photo errors", async () => {
    state.fees.mockResolvedValue(null); state.photosAllowed = true; state.photo.mockResolvedValue(new Map([["00000000-0000-4000-8000-000000000001", "https://synthetic.invalid/private-signed"]]));
    expect((await card()).p.photoUrl).toBe("https://synthetic.invalid/private-signed");
    state.photo.mockRejectedValue(new Error("Synthetic expired photo")); expect((await card()).p.photoUrl).toBeNull();
  });
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
  it("binds contact recovery to the authenticated staff and active session", async () => {
    state.fees.mockResolvedValue(null);
    const props = await card();
    expect(props.p.contactRecoveryScope).toEqual({ owner: "qa-staff", sessionLabel: "QA", previewing: false });
  });
  it("marks preview contact recovery as non-posting", async () => {
    state.fees.mockResolvedValue(null); state.previewing = "teacher";
    const props = await card();
    expect(props.p.contactRecoveryScope).toEqual({ owner: "qa-staff", sessionLabel: "QA", previewing: true });
  });
});
