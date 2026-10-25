import { beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({
  planNoteIds: ["note-1"] as (string | null)[],
  sources: [] as Record<string, unknown>[],
  sourceError: null as { message: string } | null,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({}));
vi.mock("@/modules/academics/data/academics-repo", () => ({ classLabelMap: async () => new Map([["class-1", "QA Class"]]) }));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({}));
vi.mock("@/modules/students/data/student-repo", () => ({}));
vi.mock("@/vx/screens/teach/students", () => ({
  childBasics: async () => new Map([["child-1", { fullName: "QA Child" }]]),
  staffNames: async () => new Map([["author", "QA Author"]]),
}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({ from(table: string) {
    const result = () => ({ data: table === "support_plans" ? scene.planNoteIds.map((noteId, index) => ({
      id: `plan-${index + 1}`, student_id: "child-1", class_id: "class-1", note_id: noteId,
      goal: "Read every day", status: "active", tell_parents: false, created_by: "author",
      created_at: "2026-10-25T10:00:00Z", updated_at: "2026-10-25T10:00:00Z",
    })) : table === "notes" ? scene.sources : [], error: table === "notes" ? scene.sourceError : null });
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "order", "limit", "returns"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  } }),
}));

import { visiblePlans, type NoteViewer } from "@/vx/screens/notes/data";

const viewer: NoteViewer = { id: "reader", isAdmin: false, readsEveryClass: false, correctsAttendance: false, classIds: new Set(["class-1"]), heldClassIds: new Set(["class-1"]), canWrite: true };
const source = { id: "note-1", tags: ["studies"], visibility: "team", written_by: "author", follow_up_staff_id: null, class_id: "class-1", body: "Synthetic private source text for a child", note_kinds: null };

describe("support-plan source privacy reads", () => {
  beforeEach(() => { scene.planNoteIds = ["note-1"]; scene.sources = [source]; scene.sourceError = null; });

  it("reads a team plan when its source was verified", async () => {
    expect((await visiblePlans(viewer, "QA-2026-27")).map((plan) => plan.id)).toEqual(["plan-1"]);
  });

  it("does not return plan content when the referenced source is missing", async () => {
    scene.sources = [];
    await expect(visiblePlans(viewer, "QA-2026-27")).rejects.toThrow();
  });

  it("does not return plan content when the source query fails", async () => {
    scene.sourceError = { message: "Synthetic query failure" };
    await expect(visiblePlans(viewer, "QA-2026-27")).rejects.toThrow();
  });

  it("rejects a partial source result even when one referenced source was verified", async () => {
    scene.planNoteIds = ["note-1", "note-2"];
    await expect(visiblePlans(viewer, "QA-2026-27")).rejects.toThrow();
  });

  it("still returns a plan that has no source note to verify", async () => {
    scene.planNoteIds = [null];
    scene.sources = [];
    expect((await visiblePlans(viewer, "QA-2026-27")).map((plan) => plan.id)).toEqual(["plan-1"]);
  });

  it("still hides an Only me health plan from another class teacher", async () => {
    scene.sources = [{ ...source, tags: ["health"], visibility: "private" }];
    expect(await visiblePlans(viewer, "QA-2026-27")).toEqual([]);
  });
});
