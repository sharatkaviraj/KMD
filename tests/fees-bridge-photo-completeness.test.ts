import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ canonical: true, tables: [] as string[], health: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => ({ role: "admin", language: "en" }) }));
vi.mock("@/platform/fees-bridge/policy", () => ({ usesCanonicalFees: () => state.canonical }));
vi.mock("@/platform/fees-bridge/state", () => ({ readFeesBridgeState: state.health }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => state.canonical ? "2026-27" : "TEST-2026-27", classLabelMap: async () => new Map([["class", "Class 1"]]) }));
vi.mock("@/modules/collection/data/fields-repo", () => ({ listFieldsPublic: async () => [{ id: "photo-field", key: "student_photo", labelEn: "Photo", labelHi: "Photo", isActive: true, feeColumn: null }] }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => {
  const from = (table: string) => {
    state.tables.push(table);
    const students = [{ id: "source-photo", full_name: "Synthetic A", house: null, transport_route_id: null, photo_path: "private/photo.jpg" }, { id: "local-photo", full_name: "Synthetic B", house: null, transport_route_id: null, photo_path: null }];
    const data = table === "enrolments" ? students.map(s => ({ student_id: s.id, class_id: "class" }))
      : ["fees_action_students", "students"].includes(table) ? students
      : table === "student_photos" ? [{ student_id: "local-photo" }] : [];
    const query = { select: () => query, eq: () => query, or: () => query, order: () => query, range: () => query, in: () => query, is: () => query, returns: () => query,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data, error: null }).then(resolve) };
    return query;
  };
  return { from, schema: () => ({ from }) };
} }));
import { assignmentContext } from "@/modules/teacher-tasks/data/assignment";
beforeEach(() => { state.canonical = true; state.tables = []; vi.clearAllMocks(); state.health.mockResolvedValue({}); });

it("does not mark a real child missing-photo when their canonical Fees photo is already present", async () => {
  const result = await assignmentContext();
  expect(result.students.map(s => [s.id, s.hasPhoto, s.values.student_photo])).toEqual([
    ["source-photo", true, "present"], ["local-photo", false, null],
  ]);
  expect(state.tables).toContain("fees_action_students");
  expect(state.tables).not.toContain("student_photos");
  expect(state.health).toHaveBeenCalledOnce();
});
it("preserves approved local photo completeness for isolated TEST students", async () => {
  state.canonical = false;
  const result = await assignmentContext();
  expect(result.students.map(s => [s.id, s.hasPhoto, s.values.student_photo])).toEqual([
    ["source-photo", false, null], ["local-photo", true, "present"],
  ]);
  expect(state.tables).toContain("student_photos"); expect(state.tables).not.toContain("fees_action_students");
  expect(state.health).not.toHaveBeenCalled();
});
