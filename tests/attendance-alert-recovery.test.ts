import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ stage: "", save: vi.fn(), queries: [] as string[], sentDuringCancel: false, queueStatus: "queued" }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => ({ id: "qa", role: "admin", permissions: ["attendance:view", "attendance:correct"] }) }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/app/(app)/teach/actions", () => ({ saveAttendanceAction: state.save, checkAttendanceSaveAction: vi.fn() }));
vi.mock("@/app/(app)/duty/[id]/actions", () => ({ acknowledgeDutyAction: vi.fn(), cannotCoverAction: vi.fn() }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "QA", classLabelMap: async () => new Map([["class", "QA class"]]) }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({ findRegister: vi.fn(), listMarks: async () => new Map([["qa-child", { status: "absent" }]]) }));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({ heldClassIds: vi.fn() }));
vi.mock("@/modules/students/data/student-repo", () => ({ enrolmentForStudent: vi.fn() }));
vi.mock("@/vx/screens/teach/students", () => ({ childBasics: async () => new Map([["qa-child", { fullName: "QA Child" }]]) }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query() }) }));
function query() {
  let operation = "read";
  let statusFilter: string | null = null;
  const result = () => {
    state.queries.push(operation);
    if (operation === "cancel" && state.sentDuringCancel) state.queueStatus = "sent";
    if (operation === "cancel" && state.stage !== operation && (statusFilter === null || statusFilter === state.queueStatus)) state.queueStatus = "cancelled";
    return { data: [{ id: "old-queue", student_id: "qa-no-longer-absent", status: "queued" }], error: state.stage === operation ? { message: `${operation} failed` } : null };
  };
  const api = { select() { return api; }, eq(column: string, value: string) { if (column === "status") statusFilter = value; return api; }, in() { return api; }, neq() { return api; },
    update() { operation = "cancel"; return api; }, insert() { operation = "insert"; return api; },
    returns() { return Promise.resolve(result()); }, then(resolve: (value: ReturnType<typeof result>) => unknown) { return Promise.resolve(result()).then(resolve); },
  }; return api;
}
import { saveRegisterVx } from "@/vx/screens/teach/actions";
beforeEach(() => { state.stage = ""; state.queries = []; state.sentDuringCancel = false; state.queueStatus = "queued"; state.save.mockReset().mockResolvedValue({ status: "saved", receipt: { registerId: "qa-register" } }); });
describe("attendance and parent queue have truthful separate outcomes", () => {
  it.each(["read", "cancel", "insert"])("keeps the attendance receipt and warns when queue %s fails", async stage => {
    state.stage = stage;
    const result = await saveRegisterVx(JSON.stringify({ classId: "class", day: "2026-10-10", kind: "save" }), true);
    expect(result).toMatchObject({ status: "saved", queueWarning: { en: expect.stringContaining("Attendance saved") } });
    expect(result.queued).toBeUndefined(); expect(state.queries.at(-1)).toBe(stage);
  });
  it("reports queue count only when all queue operations succeeded", async () => {
    const result = await saveRegisterVx(JSON.stringify({ classId: "class", day: "2026-10-10", kind: "save" }), true);
    expect(result).toMatchObject({ status: "saved", queued: 1 }); expect(result.queueWarning).toBeUndefined();
    expect(state.queries).toEqual(["read", "cancel", "insert"]);
  });
  it("preserves a queued alert marked sent by PR #63's manual sender before cancellation", async () => {
    state.sentDuringCancel = true;
    const result = await saveRegisterVx(JSON.stringify({ classId: "class", day: "2026-10-10", kind: "save" }), true);
    expect(result.status).toBe("saved"); expect(state.queueStatus).toBe("sent");
  });
});
