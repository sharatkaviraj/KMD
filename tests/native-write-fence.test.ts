import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentStaff } from "@/platform/auth/current-staff";

/**
 * Phase C: the native (vppsone) academic writes check the record they name by
 * id, not only the session they resolve (the allow-list Phase B left in
 * tests/architecture.test.ts is empty now). A test account resolves
 * TEST-2026-27, so the label check passes; handing it a REAL child's id must
 * still be refused, and nothing written. Synthetic ids, mocked clients.
 */

const REAL = "11111111-1111-4111-8111-111111111111";
const TEST = "22222222-2222-4222-8222-222222222222";
const CLASS = "33333333-3333-4333-8333-333333333333";

const state = vi.hoisted(() => ({
  staff: null as CurrentStaff | null,
  writes: [] as Array<{ table: string; op: string }>,
  students: new Map<string, string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/platform/auth/current-staff", () => ({
  getCurrentStaff: async () => state.staff,
  assertPermission: async () => state.staff,
  assertStaff: async () => state.staff,
}));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/modules/academics/data/academics-repo", () => ({
  resolveSessionLabel: async () => "TEST-2026-27",
  classLabelMap: async () => new Map(),
  listSubjects: async () => [],
}));
vi.mock("@/vx/screens/exams/guards", () => ({
  classTeacherOf: async () => [CLASS],
  isManager: () => true,
  mayEnterPaper: () => true,
  newToken: () => "t",
  NOT_YOURS: { en: "Not yours" },
  previewRefusal: async () => null,
}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    // The fee schema: student -> class -> session, as the fence reads it.
    schema: () => ({
      from: () => {
        let ids: string[] = [];
        const query = {
          select: () => query,
          in: (_column: string, values: string[]) => {
            ids = values;
            return query;
          },
          eq: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          returns: async () => ({
            data: ids.filter((id) => state.students.has(id)).map((id) => ({ id, class: { session_label: state.students.get(id) } })),
            error: null,
          }),
        };
        return query;
      },
    }),
    // vppsone: every write is recorded; reads find an enrolment in CLASS.
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const read = () => chain;
      Object.assign(chain, {
        select: read,
        eq: read,
        in: read,
        is: read,
        order: read,
        limit: read,
        maybeSingle: async () => ({ data: { class_id: CLASS, session_label: "TEST-2026-27" }, error: null }),
        single: async () => ({ data: { id: "row" }, error: null }),
        returns: async () => ({ data: [], error: null }),
        then: (resolve: (value: { data: null; error: null }) => unknown) => resolve({ data: null, error: null }),
      });
      const write = (op: string) => () => {
        state.writes.push({ table, op });
        return chain;
      };
      chain.insert = write("insert");
      chain.upsert = write("upsert");
      chain.update = write("update");
      chain.delete = write("delete");
      return chain;
    },
  }),
}));

function as(role: CurrentStaff["role"], isTestAccount: boolean) {
  state.staff = {
    id: "44444444-4444-4444-8444-444444444444",
    userId: "u",
    email: null,
    displayName: "QA",
    shortName: "QA",
    role,
    isTeaching: true,
    isActive: true,
    language: "en",
    preferredStart: null,
    permissions: ["attendance:view", "marks:write", "notes:write", "academics:manage"],
    isTestAccount,
  };
}

beforeEach(() => {
  state.writes = [];
  state.students = new Map([
    [REAL, "2026-27"],
    [TEST, "TEST-2026-27"],
  ]);
});

const { saveFollowupAction } = await import("@/app/(app)/academics/coordinator-actions");
const { saveRemarkAction } = await import("@/app/(app)/teach/marks/actions");

describe("a test account naming a real child", () => {
  it("cannot log a follow-up about them", async () => {
    as("office", true);
    const refused = await saveFollowupAction({ studentId: REAL, kind: "improving" });
    expect(refused.ok).toBe(false);
    expect(state.writes).toEqual([]);

    const allowed = await saveFollowupAction({ studentId: TEST, kind: "improving" });
    expect(allowed.ok).toBe(true);
    expect(state.writes).toEqual([{ table: "student_followups", op: "insert" }]);
  });

  it("cannot write their report-card remark", async () => {
    as("teacher", true);
    const refused = await saveRemarkAction({ studentId: REAL, term: "T1", remark: "Works hard" });
    expect(refused.ok).toBe(false);
    expect(state.writes).toEqual([]);

    const allowed = await saveRemarkAction({ studentId: TEST, term: "T1", remark: "Works hard" });
    expect(allowed.ok).toBe(true);
    expect(state.writes.map((w) => w.table)).toContain("report_card_remarks");
  });
});

describe("real staff naming a TEST child", () => {
  it("is refused the same way", async () => {
    as("office", false);
    const refused = await saveFollowupAction({ studentId: TEST, kind: "improving" });
    expect(refused.ok).toBe(false);
    expect(state.writes).toEqual([]);
  });
});
