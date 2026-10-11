import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({
  permission: vi.fn(), preview: vi.fn(), save: vi.fn(), register: vi.fn(), correction: vi.fn(),
  marks: vi.fn(), held: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission, assertStaff: state.permission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: state.preview }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "QA-2026", classLabelMap: async () => new Map() }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({
  saveRegisterCommand: state.save, findRegister: state.register, registerById: state.register,
  listMarks: state.marks, studentNames: async () => new Map(), findAttendanceCommand: async () => null,
}));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({ heldClassIds: state.held, classScopeFor: async () => ({ kind: "all" }) }));
vi.mock("@/modules/attendance/data/corrections-repo", () => ({ getCorrection: state.correction, hasPendingCorrection: async () => false, requestCorrection: vi.fn(), rejectCorrection: vi.fn() }));
vi.mock("@/modules/notes/data/notes-repo", () => ({ writeNote: vi.fn(), deleteOwnNote: vi.fn() }));
vi.mock("@/modules/students/data/student-repo", () => ({ enrolmentForStudent: vi.fn() }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => { throw new Error("Unexpected real client"); } }));
vi.mock("@/app/(app)/duty/[id]/actions", () => ({ acknowledgeDutyAction: vi.fn(), cannotCoverAction: vi.fn() }));
vi.mock("@/vx/screens/teach/students", () => ({ childBasics: vi.fn() }));

import { saveAttendanceAction, decideCorrectionAction } from "@/app/(app)/teach/actions";
import { saveRegisterVx } from "@/vx/screens/teach/actions";
import { idleAttendanceState } from "@/modules/attendance/domain/attendance-receipt";

const classId = "00000000-0000-4000-8000-000000000001";
const studentId = "00000000-0000-4000-8000-000000000002";
const correctionId = "00000000-0000-4000-8000-000000000003";
function payload(kind = "correction") {
  return JSON.stringify({ commandId: "00000000-0000-4000-8000-000000000004", classId, day: "2026-10-10", kind,
    expectedRevision: 1, reason: kind === "correction" ? "Marked by mistake" : null, marks: [{ studentId, status: "present" }] });
}
async function save(kind = "correction") {
  const form = new FormData(); form.set("payload", payload(kind));
  return saveAttendanceAction(idleAttendanceState, form);
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-10T05:00:00Z"));
  state.permission.mockReset().mockResolvedValue({ id: "qa-teacher", role: "teacher", permissions: ["attendance:view", "attendance:mark"] });
  state.preview.mockReset().mockResolvedValue(undefined);
  state.held.mockReset().mockResolvedValue([classId]);
  state.register.mockReset().mockResolvedValue({ id: "qa-register", sessionLabel: "QA-2026", classId, day: "2026-10-10", revision: 2, submittedAt: "2026-10-10T04:29:00Z" });
  state.marks.mockReset().mockResolvedValue(new Map([[studentId, { status: "half_day", note: null }]]));
  state.correction.mockReset().mockResolvedValue({ id: correctionId, registerId: "qa-register", studentId, fromStatus: "absent", toStatus: "present", reason: "Marked by mistake", requestedBy: "other-teacher", status: "pending" });
  state.save.mockReset().mockResolvedValue({ outcome: "saved", receipt: { registerId: "qa-register" } });
});
afterEach(() => vi.useRealTimers());
describe("attendance entry-point refusal and correction recovery", () => {
  it("refuses the direct action while previewing before any save", async () => {
    state.preview.mockRejectedValue(new Error("preview"));
    await expect(save("save")).rejects.toThrow("preview"); expect(state.save).not.toHaveBeenCalled();
  });
  it.each(["2026-10-10T04:29:00Z", "2026-10-10T04:30:00Z"])("refuses an owner's direct correction after the window (%s)", async submittedAt => {
    state.register.mockResolvedValue({ submittedAt });
    expect((await save()).status).toBe("refused"); expect(state.save).not.toHaveBeenCalled();
  });
  it("allows a held-class correction at 29 minutes", async () => {
    state.register.mockResolvedValue({ submittedAt: "2026-10-10T04:31:00Z" });
    expect((await save()).status).toBe("saved"); expect(state.save).toHaveBeenCalledOnce();
  });
  it("allows the office to correct after the owner window", async () => {
    state.permission.mockResolvedValue({ id: "qa-office", role: "office", permissions: ["attendance:view", "attendance:correct"] });
    expect((await save()).status).toBe("saved");
  });
  it("returns an explicit refusal for a permission-service error instead of an offline transport exception", async () => {
    state.permission.mockRejectedValue(new Error("Could not verify staff permissions"));
    await expect(saveRegisterVx(payload(), false)).resolves.toMatchObject({ status: "refused" }); expect(state.save).not.toHaveBeenCalled();
  });
  it("refuses approval of a stale requested mark before building a write", async () => {
    state.permission.mockResolvedValue({ id: "qa-office", role: "office", permissions: ["attendance:correct"] });
    const form = new FormData(); form.set("correctionId", correctionId); form.set("approve", "true");
    await expect(decideCorrectionAction(form)).rejects.toThrow(/changed|stale/i); expect(state.save).not.toHaveBeenCalled();
  });
  it("preserves the register revision for a request whose original mark still matches", async () => {
    state.permission.mockResolvedValue({ id: "qa-office", role: "office", permissions: ["attendance:correct"] });
    state.marks.mockResolvedValue(new Map([[studentId, { status: "absent", note: null }]]));
    const form = new FormData(); form.set("correctionId", correctionId); form.set("approve", "true");
    await decideCorrectionAction(form); expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2, correctionRequestId: correctionId }));
  });
  it("does not save an owner correction outside the held-class scope", async () => {
    state.held.mockResolvedValue([]);
    expect((await save()).status).toBe("refused"); expect(state.save).not.toHaveBeenCalled();
  });
  it("reports a register race during approval rather than claiming success", async () => {
    state.permission.mockResolvedValue({ id: "qa-office", role: "office", permissions: ["attendance:correct"] });
    state.marks.mockResolvedValue(new Map([[studentId, { status: "absent", note: null }]]));
    state.save.mockResolvedValue({ outcome: "stale", latest: null });
    const form = new FormData(); form.set("correctionId", correctionId); form.set("approve", "true");
    await expect(decideCorrectionAction(form)).rejects.toThrow();
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
  });
});
