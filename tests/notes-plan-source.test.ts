import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * R01: a support plan made from an "Only me" note. The plan is read by the
 * child's whole team, so the server refuses a source note the writer cannot
 * see, a note about another child, an Only me note's words copied unasked,
 * and any parents' message for an Only me note. Synthetic ids and text only.
 */

const scene = vi.hoisted(() => ({
  staff: { id: "teacher-a", role: "teacher", displayName: "Synthetic teacher A" },
  notes: [] as unknown[],
  plans: [] as unknown[],
  sourceVisibility: "private" as string,
  sourceMissing: false,
  sourceError: null as { message: string } | null,
  writes: [] as { table: string; op: string; row?: unknown }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/vx/screens/settings/parent-switches", () => ({ readParentSwitches: async () => ({ absentAlert: "ask_on", note: true, supportPlan: true, birthday: true }) }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => scene.staff }));
vi.mock("@/platform/auth/permissions", () => ({ can: () => true, readsEveryClass: () => false }));
vi.mock("@/platform/auth/test-session-access", () => ({
  assertStudentVisible: async () => undefined,
  passesFence: async (check: () => Promise<void>) => check().then(() => true, () => false),
}));
vi.mock("@/platform/config/school", () => ({ schoolProfile: { shortName: "QA School" } }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "QA-2026-27" }));
vi.mock("@/modules/students/data/student-repo", () => ({ enrolmentForStudent: async () => ({ classId: "class-1" }) }));
vi.mock("@/vx/screens/teach/students", () => ({ childBasics: async () => new Map() }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/vx/screens/notes/data", () => ({
  noteViewer: async () => ({ id: scene.staff.id, classIds: new Set(["class-1"]), heldClassIds: new Set(["class-1"]), readsEveryClass: false, correctsAttendance: false }),
  visibleNotes: async () => scene.notes,
  visiblePlans: async () => scene.plans,
}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const done = (data: unknown) => Promise.resolve({ data, error: null });
      for (const m of ["select", "eq", "neq", "order", "limit", "in", "is"]) chain[m] = () => chain;
      chain.insert = (row: unknown) => {
        scene.writes.push({ table, op: "insert", row });
        return { ...chain, select: () => ({ single: () => done({ id: "plan-new" }) }), then: (r: (v: unknown) => unknown) => done(null).then(r) };
      };
      chain.update = (row: unknown) => {
        scene.writes.push({ table, op: "update", row });
        return chain;
      };
      chain.delete = () => {
        scene.writes.push({ table, op: "delete" });
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({
        data: table === "notes" && !scene.sourceMissing && !scene.sourceError ? { visibility: scene.sourceVisibility, body: PRIVATE_BODY } : null,
        error: scene.sourceError,
      });
      chain.single = () => done(null);
      chain.then = (r: (v: unknown) => unknown) => done(null).then(r);
      return chain;
    },
  }),
}));

import { createPlanAction, tellParentsAboutPlanAction } from "@/vx/screens/notes/actions";

const NOTE_ID = "00000000-0000-4000-8000-0000000000a1";
const CHILD = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CHILD = "00000000-0000-4000-8000-0000000000c2";
const PRIVATE_BODY = "Synthetic private worry about the child at home, kept to myself for now";

function note(over: Record<string, unknown> = {}) {
  return { id: NOTE_ID, studentId: CHILD, visibility: "private", writtenBy: "teacher-a", body: PRIVATE_BODY, tags: ["studies"], classId: "class-1", ...over };
}
const steps = [{ body: "Check the homework diary", ownerRole: "me" as const, whenLabel: null }];
const planWrites = () => scene.writes.filter((w) => w.table === "support_plans" && w.op === "insert");
const noteWrites = () => scene.writes.filter((w) => w.table === "notes");
const queueWrites = () => scene.writes.filter((w) => w.table === "parent_message_queue");

describe("R01: a support plan from an Only me note", () => {
  beforeEach(() => {
    scene.writes = [];
    scene.notes = [];
    scene.plans = [];
    scene.staff = { id: "teacher-a", role: "teacher", displayName: "Synthetic teacher A" };
    scene.sourceVisibility = "private";
    scene.sourceMissing = false;
    scene.sourceError = null;
  });

  it("refuses a source note the writer cannot read, and touches nothing (not even its status)", async () => {
    scene.staff = { id: "teacher-b", role: "teacher", displayName: "Synthetic teacher B" };
    scene.notes = []; // visibleNotes hides another teacher's Only me note
    const res = await createPlanAction({ studentId: CHILD, noteId: NOTE_ID, goal: "Read ten minutes a day", steps, tellParents: false });
    expect(res.ok).toBe(false);
    expect(planWrites()).toHaveLength(0);
    expect(noteWrites()).toHaveLength(0);
  });

  it("refuses a goal that silently repeats the private note", async () => {
    scene.notes = [note()];
    const res = await createPlanAction({ studentId: CHILD, noteId: NOTE_ID, goal: PRIVATE_BODY.slice(0, 119), steps, tellParents: false });
    expect(res).toMatchObject({ ok: false });
    expect(planWrites()).toHaveLength(0);
  });

  it("keeps the words when the author deliberately chose to share them", async () => {
    scene.notes = [note()];
    const res = await createPlanAction({ studentId: CHILD, noteId: NOTE_ID, goal: PRIVATE_BODY.slice(0, 119), steps, tellParents: false, shareExcerpt: true });
    expect(res).toMatchObject({ ok: true, id: "plan-new" });
    expect(planWrites()).toHaveLength(1);
  });

  it("starts a plan in the author's own words with nothing copied", async () => {
    scene.notes = [note()];
    const res = await createPlanAction({ studentId: CHILD, noteId: NOTE_ID, goal: "Settle in and read every day", steps, tellParents: false });
    expect(res.ok).toBe(true);
    expect((planWrites()[0]!.row as { goal: string }).goal).toBe("Settle in and read every day");
  });

  it("never queues an Only me note's plan for the parents", async () => {
    scene.notes = [note()];
    const res = await createPlanAction({ studentId: CHILD, noteId: NOTE_ID, goal: "Settle in and read every day", steps, tellParents: true });
    expect(res.ok).toBe(false);
    expect(planWrites()).toHaveLength(0);
    expect(queueWrites()).toHaveLength(0);
  });

  it("refuses a team note about another child", async () => {
    scene.notes = [note({ visibility: "team", studentId: OTHER_CHILD })];
    const res = await createPlanAction({ studentId: CHILD, noteId: NOTE_ID, goal: "Read ten minutes a day", steps, tellParents: false });
    expect(res.ok).toBe(false);
    expect(planWrites()).toHaveLength(0);
  });

  it("still makes a plan from a team note, words and all", async () => {
    scene.notes = [note({ visibility: "team" })];
    const res = await createPlanAction({ studentId: CHILD, noteId: NOTE_ID, goal: PRIVATE_BODY.slice(0, 119), steps, tellParents: false });
    expect(res.ok).toBe(true);
  });

  it("refuses to tell parents about an existing plan whose note is Only me", async () => {
    scene.plans = [{ id: "plan-1", studentId: CHILD, classId: "class-1", noteId: NOTE_ID, studentName: "QA Child", goal: "Read daily", steps: [] }];
    scene.sourceVisibility = "private";
    const res = await tellParentsAboutPlanAction("00000000-0000-4000-8000-0000000000b1");
    expect(res.ok).toBe(false);
    expect(queueWrites()).toHaveLength(0);
  });

  it.each(["error", "missing"])("does not queue a plan when source privacy cannot be verified: %s", async (failure) => {
    scene.plans = [{ id: "plan-1", studentId: CHILD, classId: "class-1", noteId: NOTE_ID, studentName: "QA Child", goal: PRIVATE_BODY, steps: [] }];
    scene.sourceError = failure === "error" ? { message: "Synthetic unavailable read" } : null;
    scene.sourceMissing = failure === "missing";
    const res = await tellParentsAboutPlanAction("00000000-0000-4000-8000-0000000000b1");
    expect(res.ok).toBe(false);
    expect(scene.writes).toEqual([]);
  });

  it("can retry sharing a team plan after the source read recovers", async () => {
    scene.plans = [{ id: "plan-1", studentId: CHILD, classId: "class-1", noteId: NOTE_ID, studentName: "QA Child", goal: "Read daily", steps: [] }];
    scene.sourceVisibility = "team";
    scene.sourceError = { message: "Synthetic unavailable read" };
    expect((await tellParentsAboutPlanAction("00000000-0000-4000-8000-0000000000b1")).ok).toBe(false);
    scene.sourceError = null;
    expect((await tellParentsAboutPlanAction("00000000-0000-4000-8000-0000000000b1")).ok).toBe(true);
    expect(queueWrites()).toHaveLength(1);
  });
});
