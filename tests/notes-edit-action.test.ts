import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Smoke 20 Oct, stream "notes": a saved note could not be corrected, the
 * follow-up date had only three fixed days, and a plan's goal — the note's
 * words cut mid-word — went into the parents' message. The actions, with the
 * database faked. Synthetic ids and text only.
 */

const scene = vi.hoisted(() => ({
  staff: { id: "teacher-a", role: "teacher", displayName: "Synthetic teacher A" },
  notes: [] as unknown[],
  plans: [] as unknown[],
  source: { visibility: "team", body: "" } as { visibility: string; body: string },
  writes: [] as { table: string; op: string; row?: unknown }[],
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/vx/screens/settings/parent-switches", () => ({ readParentSwitches: async () => ({ absentAlert: "ask_on", note: true, supportPlan: true, birthday: true }) }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => scene.staff }));
vi.mock("@/platform/auth/permissions", () => ({ can: () => true, readsEveryClass: () => false }));
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
      for (const m of ["select", "eq", "neq", "order", "limit", "in", "is", "returns"]) chain[m] = () => chain;
      chain.insert = (row: unknown) => {
        scene.writes.push({ table, op: "insert", row });
        return { ...chain, select: () => ({ single: () => done({ id: "new-id" }) }), then: (r: (v: unknown) => unknown) => done(null).then(r) };
      };
      chain.update = (row: unknown) => {
        scene.writes.push({ table, op: "update", row });
        return chain;
      };
      chain.maybeSingle = () => done(table === "notes" ? scene.source : null);
      chain.single = () => done(null);
      chain.then = (r: (v: unknown) => unknown) => {
        // note_kinds: one kind so a note can be filed.
        if (table === "note_kinds") return done([{ id: "kind-1", code: "other" }]).then(r);
        return done(null).then(r);
      };
      return chain;
    },
  }),
}));

import { createNoteAction, editNoteAction, tellParentsAboutPlanAction } from "@/vx/screens/notes/actions";
import { schoolToday } from "@/vx/format";

const NOTE_ID = "00000000-0000-4000-8000-0000000000a1";
const CHILD = "00000000-0000-4000-8000-0000000000c1";

function note(over: Record<string, unknown> = {}) {
  return { id: NOTE_ID, studentId: CHILD, visibility: "team", writtenBy: "teacher-a", body: "Synthetic note about reading", tags: ["studies"], classId: "class-1", status: "open", createdAt: new Date().toISOString(), tellParents: false, ...over };
}
const writes = (table: string, op: string) => scene.writes.filter((w) => w.table === table && w.op === op);

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  scene.writes = [];
  scene.notes = [];
  scene.plans = [];
  scene.staff = { id: "teacher-a", role: "teacher", displayName: "Synthetic teacher A" };
  scene.source = { visibility: "team", body: "" };
});

describe("changing a saved note's words", () => {
  it("lets the author change her note, and the history says so", async () => {
    scene.notes = [note()];
    const res = await editNoteAction(NOTE_ID, "Synthetic note about reading, with one more line");
    expect(res.ok).toBe(true);
    expect(writes("notes", "update")).toEqual([{ table: "notes", op: "update", row: { body: "Synthetic note about reading, with one more line" } }]);
    expect(writes("note_replies", "insert")[0]?.row).toMatchObject({ note_id: NOTE_ID, body: "Note changed", source: "system" });
  });

  it("refuses another teacher, a done note and an old note, and writes nothing", async () => {
    for (const over of [{ writtenBy: "teacher-b" }, { status: "done" }, { createdAt: "2026-01-05T05:00:00Z" }]) {
      scene.writes = [];
      scene.notes = [note(over)];
      const res = await editNoteAction(NOTE_ID, "Changed words");
      expect(res.ok).toBe(false);
      expect(scene.writes).toHaveLength(0);
    }
  });

  it("refuses empty words", async () => {
    scene.notes = [note()];
    expect((await editNoteAction(NOTE_ID, "   ")).ok).toBe(false);
    expect(scene.writes).toHaveLength(0);
  });
});

describe("a follow-up date picked by hand", () => {
  const base = { studentId: CHILD, body: "Synthetic note", tags: ["studies" as const], source: "typed" as const, needsFollowUp: true, followWhen: null, followOwner: "me" as const, visibility: "team" as const, tellParents: false };

  it("saves the picked date", async () => {
    const day = addDays(schoolToday(), 15);
    const expected = new Date(`${day}T00:00:00Z`).getUTCDay() === 0 ? addDays(day, 1) : day;
    const res = await createNoteAction({ ...base, followOn: day });
    expect(res.ok).toBe(true);
    expect(writes("notes", "insert")[0]?.row).toMatchObject({ follow_up_on: expected, needs_follow_up: true });
  });

  it("refuses a date in the past and saves nothing", async () => {
    const res = await createNoteAction({ ...base, followOn: addDays(schoolToday(), -3) });
    expect(res.ok).toBe(false);
    expect(writes("notes", "insert")).toHaveLength(0);
  });
});

describe("telling the parents about a plan", () => {
  it("leaves out a goal that is the note's words, cut mid-word", async () => {
    const body = "Synthetic team note: has been absent 3 days this month. Please check with the family and help him catch up on lessons";
    scene.source = { visibility: "team", body };
    scene.plans = [{ id: "plan-1", studentId: CHILD, classId: "class-1", noteId: NOTE_ID, studentName: "QA Child", goal: `${body.slice(0, 119)}…`, steps: [{ body: "अनुपस्थित होने पर घर फ़ोन करें" }] }];
    const res = await tellParentsAboutPlanAction("00000000-0000-4000-8000-0000000000b1");
    expect(res.ok).toBe(true);
    const row = writes("parent_message_queue", "insert")[0]?.row as { body_en: string; body_hi: string };
    expect(row.body_en).not.toContain("Synthetic team note");
    expect(row.body_en).toContain("1. Call home when absent");
    expect(row.body_hi).toContain("1. अनुपस्थित होने पर घर फ़ोन करें");
  });
});
