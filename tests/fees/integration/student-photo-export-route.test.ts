import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hasAnyRolePermission, hasRolePermission, type StaffRole } from "@/modules/fees/platform/roles";

const mocks = vi.hoisted(() => ({
  staff: vi.fn(), students: vi.fn(), master: vi.fn(), options: vi.fn(), workbook: vi.fn(), activity: vi.fn(), after: vi.fn(),
}));
vi.mock("server-only", () => ({}));
// One-only (Phase 3): a named session must be one the viewer may open. The
// gate has its own tests; here it lets the named TEST session through.
vi.mock("@/modules/fees/platform/session-context/route-session", () => ({
  visibleSessionForRoute: async (requested: string | null) => ({ ok: true, sessionLabel: requested ?? "" }),
}));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/modules/fees/platform/session", () => ({
  getAuthenticatedStaff: mocks.staff,
  hasStaffPermission: (staff: { appRole: StaffRole }, permission: Parameters<typeof hasRolePermission>[1]) => hasRolePermission(staff.appRole, permission),
  hasAnyStaffPermission: (staff: { appRole: StaffRole }, permissions: Parameters<typeof hasAnyRolePermission>[1]) => hasAnyRolePermission(staff.appRole, permissions),
}));
vi.mock("@/modules/students-fees/data/queries", () => ({ getAllStudents: mocks.students, getStudentMasterFieldsByIds: mocks.master, getStudentFormOptions: mocks.options }));
vi.mock("@/modules/exports/data/student-photo-workbook", () => ({ studentPhotoWorkbookResponse: mocks.workbook }));
vi.mock("@/modules/activity/data/events", () => ({ recordActivity: mocks.activity }));
vi.mock("@/modules/transactions/data/dues", () => ({ getOfficeWorkbookData: vi.fn() }));
vi.mock("@/modules/defaulters/data/queries", () => ({ getDefaulterExportRows: vi.fn() }));
vi.mock("@/modules/prev-year-dues/data/queries", () => ({ getPrevYearDuesCollectionRows: vi.fn() }));
vi.mock("@/modules/recovery/data/queries", () => ({ getRecoveryQueue: vi.fn() }));
vi.mock("@/modules/repayment-plans/data/queries", () => ({ getRepaymentPlanExportRows: vi.fn(), getRepaymentScheduleExportRows: vi.fn() }));
vi.mock("@/modules/fees/domain/queries", () => ({ getStudentConventionalDiscountAssignments: vi.fn() }));
vi.mock("@/modules/exports/data/ai-context-bundle", () => ({ aiContextBundleResponse: vi.fn() }));
import { GET } from "@/app/(app)/fees/exports/[exportType]/route";

const run = (suffix = "") => GET(new NextRequest(`https://example.test/fees/exports/student-master-photos?session=TEST-2026-27${suffix}`), {
  params: Promise.resolve({ exportType: "student-master-photos" }),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.staff.mockResolvedValue({ id: "staff-test", appRole: "admin", isActive: true });
  mocks.options.mockResolvedValue({ resolvedSessionLabel: "TEST-2026-27" });
  mocks.students.mockResolvedValue([{ id: "test-student", admissionNo: "TEST-001", fullName: "Test Student", classLabel: "Class 1", status: "active", photoPath: "test/photo.png" }]);
  mocks.master.mockResolvedValue(new Map());
  mocks.workbook.mockImplementation(async () => new Response("xlsx"));
});

describe("photo export route", () => {
  it.each(["admin", "teacher"])("allows %s and preserves session, search, class, status and segment filters", async (appRole) => {
    mocks.staff.mockResolvedValue({ id: "staff-test", appRole, isActive: true });
    const response = await run("&classId=test-class&query=Test&status=left&seg=neverPaid&dl=abcdefgh");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("vpps-dl=abcdefgh");
    expect(mocks.students.mock.calls[0][0]).toMatchObject({ sessionLabel: "TEST-2026-27", classId: "test-class", query: "Test", status: "left", segments: ["neverPaid"] });
    expect(mocks.workbook.mock.calls[0][1][0]).toMatchObject({ "SR no": "TEST-001", Student: "Test Student" });
    expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.activity).toHaveBeenCalledWith(expect.objectContaining({ kind: "export_downloaded", payload: expect.objectContaining({ sessionLabel: "TEST-2026-27", studentCount: 1 }) }));
  });
  it.each(["accountant", "fee_collector", "view_only"])("refuses %s before loading student records or photos", async (appRole) => {
    mocks.staff.mockResolvedValue({ appRole, isActive: true });
    expect((await run()).status).toBe(403);
    expect(mocks.students).not.toHaveBeenCalled();
    expect(mocks.workbook).not.toHaveBeenCalled();
  });
  it("refuses inactive staff and PDF requests", async () => {
    mocks.staff.mockResolvedValue({ appRole: "admin", isActive: false });
    expect((await run()).status).toBe(401);
    mocks.staff.mockResolvedValue({ appRole: "admin", isActive: true });
    expect((await run("&format=pdf")).status).toBe(400);
    expect(mocks.options).not.toHaveBeenCalled();
  });
  it("does not audit a file rejected for size", async () => {
    mocks.workbook.mockResolvedValue(new Response("Too large", { status: 413 }));
    expect((await run()).status).toBe(413);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.activity).not.toHaveBeenCalled();
  });
});
