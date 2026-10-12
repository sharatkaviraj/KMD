import { beforeEach, expect, it, vi } from "vitest";
import type { CurrentStaff } from "@/platform/auth/current-staff";
const state = vi.hoisted(() => ({ placement: null as { classId: string; rollNo: string } | null, scope: { everyClass: false, classIds: ["own-class"] } as { everyClass: boolean; classIds?: string[] }, attendance: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => {} }));
vi.mock("@/modules/students/data/student-repo", () => ({ getStudentCard: async () => ({ fullName: "Synthetic Child", classId: "own-class" }), enrolmentForStudent: async () => state.placement }));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({ classScopeFor: async () => state.scope }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ classLabelMap: async () => new Map() }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({ studentAttendance: state.attendance, attendanceRules: async () => ({ halfDayCredit: .5 }), attendanceCalendar: async () => new Map() }));
import { loadStudentSchool } from "@/vx/screens/admin/data";
const staff: CurrentStaff = { id: "synthetic", userId: "synthetic-user", email: "synthetic@example.invalid", displayName: "Synthetic Teacher", shortName: "ST", role: "teacher", isTeaching: true, isActive: true, language: "en", preferredStart: null, permissions: ["students:view", "attendance:view"] };
beforeEach(() => { state.placement = null; state.scope = { everyClass: false, classIds: ["own-class"] }; state.attendance.mockReset().mockResolvedValue([]); });
it("rejects an RLS-hidden current placement even when the legacy class is in scope", async () => {
  expect(await loadStudentSchool(staff, "synthetic", "QA")).toBeNull(); expect(state.attendance).not.toHaveBeenCalled();
});
it("rejects a moved current placement instead of falling back to the old class", async () => {
  state.placement = { classId: "other-class", rollNo: "1" }; expect(await loadStudentSchool(staff, "synthetic", "QA")).toBeNull(); expect(state.attendance).not.toHaveBeenCalled();
});
it("allows an in-scope placement without expanding permissions", async () => {
  state.placement = { classId: "own-class", rollNo: "1" }; expect((await loadStudentSchool(staff, "synthetic", "QA"))?.classId).toBe("own-class");
});
it("preserves broad-reader access to an unassigned card", async () => {
  state.scope = { everyClass: true }; expect(await loadStudentSchool({ ...staff, role: "office", permissions: [] }, "synthetic", "QA")).not.toBeNull();
});
