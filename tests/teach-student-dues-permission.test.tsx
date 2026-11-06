import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentStaff } from "@/platform/auth/current-staff";

/**
 * A child's dues are read only for `fees:view` (MCP feasibility §10).
 *
 * `/teach/student/[id]` used to read and show `feeStanding` to anybody with
 * `collection:view`, which the role matrix offers as "see details asked from
 * parents" and an admin can grant with no fee access — and the rule that a
 * teacher never holds `fees:*` does not reach a permission with another
 * prefix. The figure must not be *fetched* for such a viewer, so this checks
 * the read, not only the markup: the page never calls it, and the data
 * function refuses before the service-role client exists.
 */

const state = vi.hoisted(() => ({
  staff: null as unknown as CurrentStaff,
  feeStanding: vi.fn(),
  adminClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`Redirect: ${url}`); },
  notFound: () => { throw new Error("Not found"); },
  usePathname: () => "/teach/student/synthetic",
  useRouter: () => ({ back() {}, push() {}, refresh() {}, prefetch() {} }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));
vi.mock("@/platform/auth/current-staff", async () => {
  const { can } = await import("@/platform/auth/permissions");
  return {
    requirePermission: async (permission: Parameters<typeof can>[1]) => {
      if (!can(state.staff, permission)) throw new Error(`Redirect: /access-denied?permission=${permission}`);
      return state.staff;
    },
    assertPermission: async (permission: Parameters<typeof can>[1]) => {
      if (!can(state.staff, permission)) throw new Error(`Permission denied: ${permission}`);
      return state.staff;
    },
    getCurrentStaff: async () => state.staff,
  };
});
vi.mock("@/platform/i18n/page-title", () => ({ pageTitle: async () => "Student" }));
vi.mock("@/platform/auth/test-session-access", () => ({
  assertStudentVisible: async () => undefined,
  notFoundUnlessVisible: async () => undefined,
}));
vi.mock("@/modules/academics/data/academics-repo", () => ({
  resolveSessionLabel: async () => "QA-2026",
  classLabelMap: async () => new Map([["synthetic-class", "Class 6 A"]]),
}));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({
  attendanceRules: async () => ({ halfDayCredit: 0.5, lateCountsPresent: true }),
  studentAttendance: async () => [],
}));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({
  classScopeFor: async () => ({ everyClass: true }),
  ownClassIds: async () => [],
}));
vi.mock("@/modules/assessments/data/reports-repo", () => ({ termSummaries: async () => [] }));
vi.mock("@/modules/collection/data/documents-repo", () => ({
  documentsForStudent: async () => [],
  historyForStudent: async () => [],
  recordsForStudent: async () => [],
}));
vi.mock("@/modules/collection/data/storage-settings", () => ({ documentUploadMode: async () => "supabase" }));
vi.mock("@/modules/collection/ui/office-forms", () => ({ DocumentForm: () => null }));
vi.mock("@/modules/collection/ui/remove-document", () => ({ RemoveDocument: () => null }));
vi.mock("@/modules/notes/data/notes-repo", () => ({ listNoteKinds: async () => [], notesForStudent: async () => [] }));
vi.mock("@/modules/notes/ui/note-composer", () => ({ NoteComposer: () => null }));
vi.mock("@/modules/notes/ui/note-list", () => ({ NoteList: () => null }));
vi.mock("@/ui/page-header-localized", () => ({ PageHeader: () => null }));
vi.mock("@/modules/students/data/student-repo", () => ({
  feeStanding: state.feeStanding,
  enrolmentForStudent: async () => ({ classId: "synthetic-class", rollNo: "7" }),
  getStudentCard: async () => ({
    studentId: "synthetic", fullName: "Synthetic Child", admissionNo: "QA-1", fatherName: null,
    motherName: null, guardianPhone: null, primaryPhone: null, classId: "synthetic-class", rollNo: "7", status: "active",
  }),
}));
// For the real `feeStanding()` below: whatever it would reach must not be reached.
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: state.adminClient }));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => { throw new Error("Unexpected cookie client"); } }));
vi.mock("@/platform/env", () => ({ FEE_SCHEMA: "public", hasRequiredEnvVars: true }));
vi.mock("@/platform/fees-bridge/policy", () => ({ feesBridgeEnabled: () => false, usesCanonicalFees: () => false }));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeStudent: vi.fn() }));
vi.mock("@/modules/fees/platform/session-context/cookie", () => ({ getViewSessionCookie: async () => null }));

import StudentPage from "@/app/(app)/teach/student/[id]/page";
import * as m from "@/messages/pairs";

function viewer(role: CurrentStaff["role"], permissions: string[]): CurrentStaff {
  return {
    id: "synthetic-staff", userId: "synthetic-user", email: "synthetic@example.invalid",
    displayName: "Synthetic Staff", shortName: "SS", role, isTeaching: role === "teacher",
    isActive: true, language: "en", preferredStart: null, permissions,
  };
}

async function render(): Promise<string> {
  const page = await StudentPage({ params: Promise.resolve({ id: "synthetic" }) } as never);
  return renderToStaticMarkup(page);
}

beforeEach(() => {
  state.feeStanding.mockReset().mockResolvedValue({
    feeDue: 4321, lateFeeDue: 55, paid: 1000, lastPaymentDate: null, available: true,
  });
  state.adminClient.mockReset().mockImplementation(() => { throw new Error("Unexpected service-role client"); });
});

describe("a child's dues on /teach/student/[id]", () => {
  // Both are a matrix row an admin can save today (Staff → Roles): the
  // coordinator given "see details asked from parents", and a teacher row
  // carrying both — whose `fees:view` the teacher rule strips.
  it.each([
    ["academic_coordinator", ["attendance:view", "collection:view"]],
    ["office", ["attendance:view", "collection:view", "documents:view"]],
    ["teacher", ["attendance:view", "collection:view", "fees:view"]],
  ] as const)("does not fetch or show dues for %s holding collection:view without fees:view", async (role, permissions) => {
    state.staff = viewer(role, [...permissions]);

    const html = await render();

    expect(state.feeStanding).not.toHaveBeenCalled();
    expect(html).not.toContain(m.studentFeeDue.en);
    expect(html).not.toContain(m.studentLateFee.en);
    expect(html).not.toContain("4,321");
    expect(html).not.toContain("/fees/students/synthetic");
    // The page itself still renders: the gate removed the money, not the child.
    expect(html).toContain("QA-1");
  });

  it("reads and shows dues, fee and late fee apart, for fees:view", async () => {
    state.staff = viewer("office", ["attendance:view", "collection:view", "fees:view"]);

    const html = await render();

    expect(state.feeStanding).toHaveBeenCalledWith("synthetic");
    expect(html).toContain(m.studentFeeDue.en);
    expect(html).toContain("₹4,321");
    expect(html).toContain("₹55");
    expect(html).toContain("/fees/students/synthetic");
  });
});

describe("feeStanding() itself", () => {
  it("refuses a collection:view viewer before the service-role client exists", async () => {
    const { feeStanding } = await vi.importActual<typeof import("@/modules/students/data/student-repo")>(
      "@/modules/students/data/student-repo",
    );
    state.staff = viewer("academic_coordinator", ["attendance:view", "collection:view"]);

    await expect(feeStanding("synthetic")).rejects.toThrow("Permission denied: fees:view");
    expect(state.adminClient).not.toHaveBeenCalled();
  });

  it("refuses a teacher even when her matrix row names fees:view", async () => {
    const { feeStanding } = await vi.importActual<typeof import("@/modules/students/data/student-repo")>(
      "@/modules/students/data/student-repo",
    );
    state.staff = viewer("teacher", ["attendance:view", "collection:view", "fees:view"]);

    await expect(feeStanding("synthetic")).rejects.toThrow("Permission denied: fees:view");
    expect(state.adminClient).not.toHaveBeenCalled();
  });

  it("reads for fees:view", async () => {
    const { feeStanding } = await vi.importActual<typeof import("@/modules/students/data/student-repo")>(
      "@/modules/students/data/student-repo",
    );
    state.staff = viewer("office", ["attendance:view", "fees:view"]);
    const query = {
      schema: () => query, from: () => query, select: () => query, eq: () => query,
      maybeSingle: async () => ({
        data: { base_outstanding_amount: 10, late_fee_outstanding_amount: 2, total_paid: 5, last_payment_date: null },
        error: null,
      }),
    };
    state.adminClient.mockReset().mockReturnValue(query);

    await expect(feeStanding("synthetic")).resolves.toEqual({
      feeDue: 10, lateFeeDue: 2, paid: 5, lastPaymentDate: null, available: true,
    });
  });
});
