import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StaffRole } from "@/platform/auth/permissions";

const state = vi.hoisted(() => ({
  role: "teacher" as StaffRole,
  signedIn: true,
  hasProfile: true,
  active: true,
  queryError: null as { message: string } | null,
  adminClient: vi.fn(),
  schema: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  returns: vi.fn(),
  versions: vi.fn(async () => []),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/platform/env", () => ({ hasRequiredEnvVars: true, FEE_SCHEMA: "public" }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`Redirect: ${url}`); },
  // The page title is the design's top bar, whose phone Back reads the route.
  usePathname: () => "/timetable",
  useRouter: () => ({ back() {}, push() {}, refresh() {}, prefetch() {} }),
}));
vi.mock("@/platform/supabase/server", () => ({
  createClient: async () => ({
    // This suite models a successful matrix read. Failure and revoked grants
    // are exercised separately in matrix-auth-failure.test.ts.
    rpc: async () => ({ data: ["admin", "office", "academic_coordinator", "exam_coordinator"].includes(state.role)
      ? ["timetable:view", "academics:view"]
      : ["teacher", "view_only"].includes(state.role) ? ["timetable:view"] : [], error: null }),
    auth: {
      getClaims: async () => ({
        data: { claims: state.signedIn ? { sub: "test-user", email: "test@example.invalid" } : null },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state.hasProfile ? {
              id: "test-staff", display_name: "Test staff", short_name: "TS",
              role: state.role, is_teaching: true, is_active: state.active,
              preferred_language: "en", preferred_start: null,
            } : null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: state.adminClient }));
vi.mock("@/modules/academics/data/academics-repo", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/modules/academics/data/academics-repo")>(),
  resolveSessionLabel: async () => "2026-27",
  listClassAliases: async () => [],
}));
vi.mock("@/modules/timetable/data/timetable-repo", () => ({
  listVersions: state.versions,
  getPublishedVersion: async () => ({ id: "test-version", label: "Test timetable", slotCount: 1 }),
  listSlots: async () => [{ classId: "test-class", staffProfileId: "test-staff", day: "Monday" }],
}));
vi.mock("@/modules/staff/data/staff-repo", () => ({
  listStaff: async () => [{ id: "test-staff", displayName: "Test staff", shortName: "TS", isActive: true, isTeaching: true }],
}));
vi.mock("@/platform/i18n/page-title", () => ({ pageTitle: async () => "Timetable" }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/modules/timetable/ui/timetable-views", () => ({
  TimetableViews: ({ classes }: { classes: { id: string; label: string }[] }) => (
    <div data-testid="timetable-views">{classes.map((entry) => <span key={entry.id}>{entry.label}</span>)}</div>
  ),
}));

import { listFeeClasses, listTimetableClasses } from "@/modules/academics/data/academics-repo";
import { can } from "@/platform/auth/permissions";
import TimetablePage from "@/app/(app)/timetable/classic/page";

beforeEach(() => {
  vi.clearAllMocks();
  state.role = "teacher";
  state.signedIn = true;
  state.hasProfile = true;
  state.active = true;
  state.queryError = null;
  const query = {
    schema: state.schema, from: state.from, select: state.select,
    eq: state.eq, order: state.order, returns: state.returns,
  };
  state.adminClient.mockReturnValue(query);
  for (const method of [state.schema, state.from, state.select, state.eq, state.order]) {
    method.mockReturnValue(query);
  }
  state.returns.mockImplementation(async () => ({
    data: [{
      id: "test-class", class_name: "Class 6", section: "A", stream_name: null,
      sort_order: null, session_label: "2026-27",
    }],
    error: state.queryError,
  }));
});

const academicRoles = ["admin", "office", "academic_coordinator", "exam_coordinator"] as const;
const timetableOnlyRoles = ["teacher", "view_only"] as const;
const deniedRoles = ["accountant", "fee_collector"] as const;

describe("capability-specific class loading", () => {
  it.each([...academicRoles, ...timetableOnlyRoles])("allows %s to load timetable classes", async (role) => {
    state.role = role;
    await expect(listTimetableClasses("2026-27")).resolves.toEqual([{
      id: "test-class", className: "Class 6", section: "A", streamName: null,
      sortOrder: 0, sessionLabel: "2026-27",
    }]);
    expect(state.schema).toHaveBeenCalledWith("public");
    expect(state.from).toHaveBeenCalledWith("classes");
    expect(state.eq).toHaveBeenCalledWith("session_label", "2026-27");
    expect(state.order).toHaveBeenCalledWith("sort_order");
    expect(state.select).toHaveBeenCalledWith("id, class_name, section, stream_name, sort_order, session_label");
  });

  it.each(deniedRoles)("rejects %s before constructing the admin client", async (role) => {
    state.role = role;
    await expect(listTimetableClasses("2026-27")).rejects.toThrow("Permission denied: timetable:view");
    expect(state.adminClient).not.toHaveBeenCalled();
  });

  it.each(["signed-out", "missing-profile", "inactive"] as const)("rejects %s before the privileged query", async (account) => {
    state.signedIn = account !== "signed-out";
    state.hasProfile = account !== "missing-profile";
    state.active = account !== "inactive";
    await expect(listTimetableClasses("2026-27")).rejects.toThrow("Not signed in.");
    expect(state.adminClient).not.toHaveBeenCalled();
  });

  it.each([...timetableOnlyRoles, ...deniedRoles])("does not grant %s the academics/enrolment class loader", async (role) => {
    state.role = role;
    await expect(listFeeClasses("2026-27")).rejects.toThrow("Permission denied: academics:view");
    expect(state.adminClient).not.toHaveBeenCalled();
  });

  it.each(academicRoles)("preserves the existing academics class loader for %s", async (role) => {
    state.role = role;
    expect(await listFeeClasses("2026-27")).toEqual(await listTimetableClasses("2026-27"));
  });

  it("propagates class-query failure rather than reporting an empty timetable", async () => {
    state.queryError = { message: "Test query failure" };
    await expect(listTimetableClasses("2026-27")).rejects.toThrow("Could not read the fee app's classes: Test query failure");
  });
});

describe("timetable route regression", () => {
  it.each(timetableOnlyRoles)("renders the timetable for %s without academics:view", async (role) => {
    state.role = role;
    expect(can({ role }, "timetable:view")).toBe(true);
    expect(can({ role }, "academics:view")).toBe(false);
    const html = renderToStaticMarkup(await TimetablePage());
    expect(html).toContain('data-testid="timetable-views"');
    expect(html).toContain("Class 6 A");
    expect(html).not.toContain("/timetable/import");
  });

  it.each(deniedRoles)("redirects %s before loading timetable data", async (role) => {
    state.role = role;
    await expect(TimetablePage()).rejects.toThrow("Redirect: /access-denied?permission=timetable%3Aview");
    expect(state.adminClient).not.toHaveBeenCalled();
    expect(state.versions).not.toHaveBeenCalled();
  });
});
