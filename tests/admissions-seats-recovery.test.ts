import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permission: vi.fn(), preview: vi.fn(), context: vi.fn(), save: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: state.preview }));
vi.mock("@/modules/enrolments/data/enrolments-repo", () => ({ syncStudentEnrolments: vi.fn() }));
vi.mock("@/modules/students-fees/vx/admissions", () => ({ loadAdmissionsFeeContext: state.context }));
vi.mock("@/vx/screens/admissions/data", () => ({ saveSeats: state.save }));
import { saveSeatsAction } from "@/app/(app)/admissions/actions";
beforeEach(() => { vi.resetAllMocks(); state.permission.mockResolvedValue({ id: "qa-admin" }); state.context.mockResolvedValue({ sessionLabel: "QA-2026-27", classes: [{ id: "qa-class" }] }); });
it("derives the session and valid class on the server and preserves null clears", async () => {
  expect(await saveSeatsAction({ seats: [{ classId: "qa-class", seats: null }] })).toEqual({ ok: true, saved: 1 });
  expect(state.permission).toHaveBeenCalledWith("settings:manage"); expect(state.save).toHaveBeenCalledWith("QA-2026-27", [{ classId: "qa-class", seats: null }], "qa-admin");
});
it.each([-1, 501, Infinity, NaN])("refuses invalid seat limit %s before persisting", async (seats) => {
  expect((await saveSeatsAction({ seats: [{ classId: "qa-class", seats }] })).ok).toBe(false); expect(state.save).not.toHaveBeenCalled();
});
it("unknown classes cannot create limits", async () => {
  expect((await saveSeatsAction({ seats: [{ classId: "qa-other-session-class", seats: 30 }] })).ok).toBe(false); expect(state.save).not.toHaveBeenCalled();
});
it("a mixed valid and unknown class batch is refused as a whole", async () => {
  expect((await saveSeatsAction({ seats: [{ classId: "qa-class", seats: 30 }, { classId: "qa-other-session-class", seats: 40 }] })).ok).toBe(false);
  expect(state.save).not.toHaveBeenCalled();
});
it("conflicting entries for one class are refused before writing", async () => {
  expect((await saveSeatsAction({ seats: [{ classId: "qa-class", seats: 30 }, { classId: "qa-class", seats: null }] })).ok).toBe(false);
  expect(state.save).not.toHaveBeenCalled();
});
it("an unavailable active session cannot create a blank-session limit", async () => {
  state.context.mockResolvedValue({ sessionLabel: "", classes: [{ id: "qa-class" }] });
  expect((await saveSeatsAction({ seats: [{ classId: "qa-class", seats: 30 }] })).ok).toBe(false); expect(state.save).not.toHaveBeenCalled();
});
it.each([0, 500])("accepts the explicit boundary %i", async (seats) => { expect((await saveSeatsAction({ seats: [{ classId: "qa-class", seats }] })).ok).toBe(true); });
it.each(["permission", "preview", "context", "save"] as const)("%s failure cannot report a successful save", async (failure) => {
  state[failure].mockRejectedValue(new Error(`QA ${failure} refused`)); expect((await saveSeatsAction({ seats: [{ classId: "qa-class", seats: 30 }] })).ok).toBe(false);
  if (failure !== "save") expect(state.save).not.toHaveBeenCalled();
});
