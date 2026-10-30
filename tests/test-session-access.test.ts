import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentStaff } from "@/platform/auth/current-staff";

/**
 * Phase 3 (D-340; critique0 #15, critique1 B10, B14): the server half of the
 * test-session fence — the resolver with a forbidden cookie, the switcher's
 * per-viewer filter, and the by-id student check. Synthetic ids, mocked
 * clients, nothing fetched.
 */

const state = vi.hoisted(() => ({
  staff: null as CurrentStaff | null,
  cookieDeleted: vi.fn(),
  cookieStoreThrows: false,
  students: new Map<string, string | null>(),
  readError: null as unknown,
  sessionsRead: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    delete: (name: string) => {
      if (state.cookieStoreThrows) throw new Error("Cookies can only be modified in a Server Action");
      state.cookieDeleted(name);
    },
  }),
}));
vi.mock("@/platform/auth/current-staff", () => ({ getCurrentStaff: async () => state.staff }));
vi.mock("@/modules/fees/platform/session-context/active", () => ({ getActiveSessionLabel: async () => "2026-27" }));
vi.mock("@/modules/fees/platform/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        order: async () => {
          state.sessionsRead();
          return {
            data: [
              { id: "s1", session_label: "2026-27", status: "active" },
              { id: "s2", session_label: "2027-28", status: "active" },
              { id: "s3", session_label: "TEST-2026-27", status: "active" },
            ],
            error: null,
          };
        },
      }),
    }),
  }),
}));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
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
          returns: async () => ({
            data: state.readError
              ? null
              : ids.filter((id) => state.students.has(id)).map((id) => ({ id, class: { session_label: state.students.get(id) } })),
            error: state.readError,
          }),
        };
        return query;
      },
    }),
  }),
}));

import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getSessionSwitcherData } from "@/modules/fees/platform/session-context/switcher";
import {
  assertSessionWritable,
  assertStudentVisible,
  filterVisibleStudentIds,
  notFoundUnlessVisible,
} from "@/platform/auth/test-session-access";

const REAL = "11111111-1111-4111-8111-111111111111";
const TEST = "22222222-2222-4222-8222-222222222222";

function as(role: CurrentStaff["role"], isTestAccount: boolean) {
  state.staff = {
    id: "p",
    userId: "u",
    email: null,
    displayName: "QA",
    shortName: "QA",
    role,
    isTeaching: false,
    isActive: true,
    language: "en",
    preferredStart: null,
    permissions: role === "teacher" ? ["attendance:view"] : ["fees:view", "students:view"],
    isTestAccount,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.cookieStoreThrows = false;
  state.readError = null;
  state.students = new Map([
    [REAL, "2026-27"],
    [TEST, "TEST-2026-27"],
  ]);
});

describe("resolveViewSession", () => {
  it("office handed ?session=TEST-2026-27 lands on 2026-27", async () => {
    as("office", false);
    const resolved = await resolveViewSession({ searchParamSession: "TEST-2026-27" });
    expect(resolved).toMatchObject({ sessionLabel: "2026-27", source: "default", isTest: false });
  });

  it("a forbidden cookie falls back and is deleted where cookies can change", async () => {
    as("office", false);
    const resolved = await resolveViewSession({ cookieSession: "TEST-2026-27" });
    expect(resolved.sessionLabel).toBe("2026-27");
    expect(state.cookieDeleted).toHaveBeenCalledWith("vpps_view_session");
  });

  it("while rendering (cookies read-only) the forbidden cookie is ignored, not an error", async () => {
    as("office", false);
    state.cookieStoreThrows = true;
    await expect(resolveViewSession({ cookieSession: "TEST-2026-27" })).resolves.toMatchObject({ sessionLabel: "2026-27" });
  });

  it("a test account defaults to TEST-2026-27 and cannot be sent to 2026-27", async () => {
    as("accountant", true);
    expect((await resolveViewSession({})).sessionLabel).toBe("TEST-2026-27");
    expect((await resolveViewSession({ searchParamSession: "2026-27", cookieSession: "2026-27" })).sessionLabel).toBe("TEST-2026-27");
  });

  it("a real admin can open TEST-2026-27 by URL", async () => {
    as("admin", false);
    expect(await resolveViewSession({ searchParamSession: "TEST-2026-27" })).toMatchObject({ sessionLabel: "TEST-2026-27", isTest: true, source: "url" });
  });

  it("a teacher (no pill) always gets the active session", async () => {
    as("teacher", false);
    expect((await resolveViewSession({ searchParamSession: "2027-28", cookieSession: "2027-28" })).sessionLabel).toBe("2026-27");
  });
});

describe("getSessionSwitcherData", () => {
  it("caches the full list once and filters it per viewer", async () => {
    as("office", false);
    const office = await getSessionSwitcherData();
    as("office", true);
    const tester = await getSessionSwitcherData();
    as("admin", false);
    const admin = await getSessionSwitcherData();

    expect(office.availableSessions.map((s) => s.session_label)).toEqual(["2026-27", "2027-28"]);
    expect(tester.availableSessions.map((s) => s.session_label)).toEqual(["TEST-2026-27"]);
    expect(admin.availableSessions.map((s) => s.session_label).sort()).toEqual(["2026-27", "2027-28", "TEST-2026-27"]);
    // One read for three viewers: the cache holds everybody's list, unfiltered.
    expect(state.sessionsRead).toHaveBeenCalledTimes(1);
  });

  it("an admin previewing a role sees that role's sessions", async () => {
    as("admin", false);
    const preview = await getSessionSwitcherData({ role: "academic_coordinator", isTestAccount: false, feeReader: false });
    expect(preview.availableSessions.map((s) => s.session_label)).toEqual(["2026-27"]);
  });
});

describe("assertStudentVisible", () => {
  it("refuses a TEST student to real staff and a real student to a test account", async () => {
    as("office", false);
    await expect(assertStudentVisible(null, TEST)).rejects.toMatchObject({ code: "session_access_denied" });
    await expect(assertStudentVisible(null, REAL)).resolves.toBeUndefined();
    as("office", true);
    await expect(assertStudentVisible(null, REAL)).rejects.toMatchObject({ code: "session_access_denied" });
    await expect(assertStudentVisible(null, TEST)).resolves.toBeUndefined();
  });

  it("a test admin cannot open a real student; a real admin opens both without a read", async () => {
    as("admin", true);
    await expect(assertStudentVisible(null, REAL)).rejects.toMatchObject({ code: "session_access_denied" });
    as("admin", false);
    state.readError = { message: "should not be read" };
    await expect(assertStudentVisible(null, REAL)).resolves.toBeUndefined();
    await expect(assertStudentVisible(null, TEST)).resolves.toBeUndefined();
  });

  it("fails closed when the class cannot be read", async () => {
    as("office", false);
    state.readError = { message: "boom" };
    await expect(assertStudentVisible(null, REAL)).rejects.toMatchObject({ code: "session_access_denied" });
  });

  it("a page turns the refusal into not-found", async () => {
    as("office", true);
    await expect(notFoundUnlessVisible(() => assertStudentVisible(null, REAL))).rejects.toThrow("NOT_FOUND");
  });

  it("filters a search list by session, keeping order", async () => {
    as("office", false);
    expect(await filterVisibleStudentIds(null, [TEST, REAL])).toEqual([REAL]);
  });
});

describe("assertSessionWritable", () => {
  it("refuses a write into a session the viewer may not write, and a write with no session", async () => {
    as("accountant", true);
    await expect(assertSessionWritable(null, "2026-27")).rejects.toMatchObject({ code: "session_access_denied" });
    await expect(assertSessionWritable(null, "TEST-2026-27")).resolves.toBeUndefined();
    await expect(assertSessionWritable(null, "")).rejects.toMatchObject({ code: "session_access_denied" });
    as("accountant", false);
    await expect(assertSessionWritable(null, "TEST-2026-27")).rejects.toMatchObject({ code: "session_access_denied" });
    await expect(assertSessionWritable(null, "2026-27")).resolves.toBeUndefined();
  });

  it("nobody signed in is refused", async () => {
    state.staff = null;
    await expect(assertSessionWritable(null, "2026-27")).rejects.toMatchObject({ code: "session_access_denied" });
  });
});
