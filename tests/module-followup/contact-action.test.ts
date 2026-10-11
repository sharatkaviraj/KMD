import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ allowed: true, tables: [] as string[], inserted: [] as unknown[], permission: vi.fn(), preview: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: state.refresh }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: state.permission }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: state.preview }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "OPS-FOLLOWUP-2026-27" }));
vi.mock("@/vx/format", () => ({ schoolToday: () => "2026-10-11" }));
vi.mock("@/vx/screens/family-contact/data", () => ({ familyContactAccess: async () => state.allowed }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from(table: string) {
  state.tables.push(table);
  if (table === "enrolments") {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { class_id: "OPS-other-class" } }) };
    return query;
  }
  if (table === "student_followups") return { insert: async (value: unknown) => { state.inserted.push(value); return { error: null }; } };
  throw new Error(`Unexpected side effect table ${table}`);
} }) }));

import { logFamilyContactAction } from "@/vx/screens/family-contact/actions";
const studentId = "00000000-0000-4000-8000-000000000001";
describe("family contact actual action guarded no-send boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); state.allowed = true; state.tables = []; state.inserted = [];
    state.permission.mockResolvedValue({ id: "OPS-synthetic-teacher" }); state.preview.mockResolvedValue(undefined);
  });
  it("denied class access does not append or refresh", async () => {
    state.allowed = false;
    const result = await logFamilyContactAction({ studentId, outcome: "spoke", note: "OPS synthetic denied contact" });
    expect(result.ok).toBe(false);
    expect(state.permission).toHaveBeenCalledWith("students:view");
    expect(state.preview).toHaveBeenCalledOnce();
    expect(state.tables).toEqual(["enrolments"]);
    expect(state.inserted).toEqual([]); expect(state.refresh).not.toHaveBeenCalled();
  });
  it("completed conversation appends only its record and creates no message queue effect", async () => {
    expect(await logFamilyContactAction({ studentId, outcome: "spoke", note: "  OPS conversation already completed  ", agreedOn: "2026-10-20" })).toEqual({ ok: true });
    expect(state.tables).toEqual(["enrolments", "student_followups"]);
    expect(state.inserted).toEqual([{ session_label: "OPS-FOLLOWUP-2026-27", student_id: studentId, kind: "contact", outcome: "spoke", note: "OPS conversation already completed", agreed_on: null, note_id: null, created_by: "OPS-synthetic-teacher" }]);
    expect(state.refresh).toHaveBeenCalledWith(`/students/${studentId}`);
  });
  it("invalid agreed calendar days return validation before any DB read or append", async () => {
    for (const agreedOn of ["2026-11-31", "2027-02-29"]) {
      const result = await logFamilyContactAction({ studentId, outcome: "follow_up_agreed", agreedOn });
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ error: { en: "Choose a valid agreed date." } });
    }
    expect(state.tables).toEqual([]); expect(state.inserted).toEqual([]);
    expect(state.refresh).not.toHaveBeenCalled();
  });
});
