import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ stage: "", save: vi.fn(), queries: [] as string[], sentDuringCancel: false, queueStatus: "queued", told: new Map<string, "sick" | "other">(), marks: new Map<string, { status: string }>(), decide: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/vx/screens/settings/parent-switches", () => ({ readParentSwitches: async () => ({ absentAlert: "ask_on", note: true, supportPlan: true, birthday: true }) }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => ({ id: "qa", role: "admin", permissions: ["attendance:view", "attendance:correct"] }) }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/app/(app)/teach/actions", () => ({ saveAttendanceAction: state.save, checkAttendanceSaveAction: vi.fn() }));
vi.mock("@/app/(app)/duty/[id]/actions", () => ({ acknowledgeDutyAction: vi.fn(), cannotCoverAction: vi.fn() }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "QA", classLabelMap: async () => new Map([["class", "QA class"]]) }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({ findRegister: vi.fn(), listMarks: async () => state.marks }));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({ heldClassIds: vi.fn() }));
vi.mock("@/modules/students/data/student-repo", () => ({ enrolmentForStudent: vi.fn() }));
vi.mock("@/vx/screens/teach/students", () => ({ childBasics: async () => new Map([["qa-child", { fullName: "QA Child" }]]) }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: () => query() }) }));
// A parent's WhatsApp note that the child would be away (D-588): read on its own, so the queue's reads stay countable here.
vi.mock("@/modules/attendance/data/parent-notes", () => ({ parentNotesOn: async (_session: string, _day: string, ids: readonly string[]) => new Map([...state.told].filter(([id]) => ids.includes(id))) }));
// A waiting note the register applies (D-601): applying it is what makes the parent "told" for the alerts.
vi.mock("@/modules/whatsapp/data/parent-suggestions", () => ({ decideParentSuggestions: state.decide }));
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
const KID = "00000000-0000-4000-8000-0000000000a1";
const KID2 = "00000000-0000-4000-8000-0000000000a2";
const NOTE = "00000000-0000-4000-8000-0000000000e1";
const NOTE2 = "00000000-0000-4000-8000-0000000000e2";
const CHILD_OF: Record<string, string> = { [NOTE]: KID, [NOTE2]: KID2 };
beforeEach(() => {
  state.stage = ""; state.queries = []; state.sentDuringCancel = false; state.queueStatus = "queued"; state.told = new Map();
  state.marks = new Map([["qa-child", { status: "absent" }]]);
  state.save.mockReset().mockResolvedValue({ status: "saved", receipt: { registerId: "qa-register" } });
  state.decide.mockReset().mockImplementation(async ({ ids }: { ids: string[] }) => {
    for (const id of ids) state.told.set(CHILD_OF[id], "sick");
    return { ok: true, applied: ids.length, dismissed: 0, results: ids.map((id) => ({ id, outcome: "applied", kind: "absence" })) };
  });
});
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
  it("queues no absent message for a child whose parent already told the school on WhatsApp (D-588)", async () => {
    state.told = new Map([["qa-child", "sick"]]);
    const result = await saveRegisterVx(JSON.stringify({ classId: "class", day: "2026-10-10", kind: "save" }), true);
    expect(result).toMatchObject({ status: "saved", queued: 0 }); expect(result.queueWarning).toBeUndefined();
    expect(state.queries).toEqual(["read", "cancel"]);
  });
  it("preserves a queued alert marked sent by PR #63's manual sender before cancellation", async () => {
    state.sentDuringCancel = true;
    const result = await saveRegisterVx(JSON.stringify({ classId: "class", day: "2026-10-10", kind: "save" }), true);
    expect(result.status).toBe("saved"); expect(state.queueStatus).toBe("sent");
  });
});

describe("a parent's note beside a child on the register (D-601)", () => {
  const save = (marks: Array<[string, string]>, notes: unknown) =>
    saveRegisterVx(JSON.stringify({ classId: "class", day: "2026-10-10", kind: "save", marks: marks.map(([studentId, status]) => ({ studentId, status })), notes }), true);

  it("applies it as the teacher, with the mark the child was saved with, before the alerts: no absent message for that child", async () => {
    state.marks = new Map([[KID, { status: "absent" }]]);
    const result = await save([[KID, "absent"]], [{ id: NOTE, studentId: KID, mark: "absent" }]);
    expect(state.decide).toHaveBeenCalledTimes(1);
    expect(state.decide).toHaveBeenCalledWith({ actorStaffId: "qa", ids: [NOTE], decision: "apply", mark: "absent", via: "register" });
    expect(result).toMatchObject({ status: "saved", queued: 0 }); expect(result.queueWarning).toBeUndefined();
    expect(state.queries).not.toContain("insert");
  });

  it("applies Leave and Absent each with its own mark", async () => {
    state.marks = new Map([[KID, { status: "leave" }], [KID2, { status: "absent" }]]);
    await save([[KID, "leave"], [KID2, "absent"]], [{ id: NOTE, studentId: KID, mark: "leave" }, { id: NOTE2, studentId: KID2, mark: "absent" }]);
    expect(state.decide.mock.calls.map(([input]) => [input.ids, input.mark])).toEqual([[[NOTE], "leave"], [[NOTE2], "absent"]]);
  });

  it("leaves the note waiting when the child was saved Present, or saved with another mark", async () => {
    state.marks = new Map([[KID, { status: "present" }], [KID2, { status: "half_day" }]]);
    await save([[KID, "present"], [KID2, "half_day"]], [{ id: NOTE, studentId: KID, mark: "absent" }, { id: NOTE2, studentId: KID2, mark: "absent" }]);
    expect(state.decide).not.toHaveBeenCalled();
  });

  it("keeps the register saved and says so when the database refuses the note, and the absent message is then queued as usual", async () => {
    state.marks = new Map([[KID, { status: "absent" }]]);
    state.decide.mockResolvedValueOnce({ ok: true, applied: 0, dismissed: 0, results: [{ id: NOTE, outcome: "already" }] });
    const result = await save([[KID, "absent"]], [{ id: NOTE, studentId: KID, mark: "absent" }]);
    expect(result).toMatchObject({ status: "saved", queued: 1, queueWarning: { en: "Attendance saved. A parent's note was not applied: Someone has already decided this one." } });
    expect(result.queueWarning?.hi).toContain("हाज़िरी सेव हुई");
  });

  it("ignores anything that is not a note, and never applies one for a register that was not saved", async () => {
    state.marks = new Map([[KID, { status: "absent" }]]);
    await save([[KID, "absent"]], [{ id: "not-a-note", studentId: KID, mark: "absent" }]);
    await save([[KID, "absent"]], [{ id: NOTE, studentId: KID, mark: "present" }]);
    await save([[KID, "absent"]], "everything");
    expect(state.decide).not.toHaveBeenCalled();
    state.save.mockResolvedValueOnce({ status: "refused", message: { en: "QA closed", hi: "" } });
    const refused = await save([[KID, "absent"]], [{ id: NOTE, studentId: KID, mark: "absent" }]);
    expect(refused.status).toBe("refused");
    expect(state.decide).not.toHaveBeenCalled();
  });
});
