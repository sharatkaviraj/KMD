import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { feesCopyCommandId, pendingFeesCopies } from "@/modules/collection/domain/fees-photo-copy";

const mocks = vi.hoisted(() => ({
  page: vi.fn(), one: vi.fn(), place: vi.fn(), feesRows: vi.fn(), oneRows: vi.fn(), statusFilter: vi.fn(),
  staff: vi.fn(), canonical: vi.fn(), preview: vi.fn(), health: vi.fn(), copy: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/fees-bridge/client", () => ({ getBridgeAiPhotos: mocks.page, getBridgeStudentPhoto: mocks.one }));
vi.mock("@/modules/collection/data/photos-repo", () => ({ placePhoto: mocks.place }));
vi.mock("@/platform/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => table === "fees_bridge_students"
      ? { select: () => ({ eq: () => ({ eq: (column: string, value: string) => { mocks.statusFilter(column, value); return { not: () => ({ limit: () => ({ returns: mocks.feesRows }) }) }; } }) }) }
      : { select: () => ({ is: () => ({ in: (_column: string, ids: string[]) => mocks.oneRows(ids) }) }) },
  }),
}));

const kid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const staff = { id: kid(999), role: "admin" } as CurrentStaff;
const jpeg = new Uint8Array([255, 216, 255, 217]).buffer;

describe("which Fees photos One copies for teachers", () => {
  it("copies a child with no photo in One, and a copy made from an older Fees photo", () => {
    const pending = pendingFeesCopies(
      [{ id: kid(1), photo_path: " a/1.jpg " }, { id: kid(2), photo_path: "a/2-new.jpg" }, { id: kid(3), photo_path: "a/3.jpg" }],
      [{ id: kid(102), student_id: kid(2), source: "fees", source_ref: "a/2-old.jpg" }, { id: kid(103), student_id: kid(3), source: "fees", source_ref: "a/3.jpg" }],
    );
    expect([...pending]).toEqual([[kid(1), { path: "a/1.jpg", expected: null }], [kid(2), { path: "a/2-new.jpg", expected: kid(102) }]]);
  });
  it("never replaces a photo a person placed in One, and skips children Fees has no photo of", () => {
    const pending = pendingFeesCopies(
      [{ id: kid(1), photo_path: "a/1.jpg" }, { id: kid(2), photo_path: "a/2.jpg" }, { id: kid(3), photo_path: "a/3.jpg" }, { id: kid(4), photo_path: null }, { id: kid(5), photo_path: "  " }],
      ["camera", "file", "folder"].map((source, i) => ({ id: kid(100 + i), student_id: kid(i + 1), source, source_ref: null })),
    );
    expect(pending.size).toBe(0);
  });
  it("gives each copy a stable command id in the UUID shape the database takes", () => {
    const want = { path: "a/1.jpg", expected: null };
    const id = feesCopyCommandId(kid(1), want);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(feesCopyCommandId(kid(1), { ...want })).toBe(id);
    expect(feesCopyCommandId(kid(2), want)).not.toBe(id);
    expect(feesCopyCommandId(kid(1), { path: "a/1b.jpg", expected: null })).not.toBe(id);
    // The same Fees photo coming back over a later copy is a new command, not a reused id.
    expect(feesCopyCommandId(kid(1), { path: "a/1.jpg", expected: kid(7) })).not.toBe(id);
  });
});

describe("copying a batch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.oneRows.mockResolvedValue({ data: [], error: null });
    mocks.place.mockResolvedValue({ ok: true, photoId: kid(500), replaced: null, replayed: false });
    mocks.one.mockResolvedValue({ bytes: jpeg, contentType: "image/jpeg" });
  });
  const copy = async (opts: { after: string | null; budgetMs: number }) =>
    (await import("@/modules/collection/data/fees-photo-copy")).copyFeesPhotos(staff, "2026-27", opts);

  it("reads only children on the roll, and stops at once when nothing is missing", async () => {
    mocks.feesRows.mockResolvedValue({ data: [{ id: kid(1), photo_path: "a/1.jpg" }], error: null });
    mocks.oneRows.mockResolvedValue({ data: [{ id: kid(101), student_id: kid(1), source: "fees", source_ref: "a/1.jpg" }], error: null });
    expect(await copy({ after: null, budgetMs: 1000 })).toEqual({ total: 1, pending: 0, copied: 0, failed: 0, next: null });
    expect(mocks.statusFilter).toHaveBeenCalledWith("status", "active");
    expect(mocks.page).not.toHaveBeenCalled();
    expect(mocks.one).not.toHaveBeenCalled();
  });

  it("asks for a few changed photos one by one and places them as Fees copies", async () => {
    mocks.feesRows.mockResolvedValue({ data: [{ id: kid(1), photo_path: "a/1.jpg" }, { id: kid(2), photo_path: "a/2.jpg" }], error: null });
    mocks.oneRows.mockResolvedValue({ data: [{ id: kid(102), student_id: kid(2), source: "fees", source_ref: "a/2-old.jpg" }], error: null });
    mocks.place.mockResolvedValueOnce({ ok: true, photoId: kid(500), replaced: null, replayed: false }).mockResolvedValueOnce({ ok: false, reason: "stale" });
    expect(await copy({ after: null, budgetMs: 1000 })).toEqual({ total: 2, pending: 2, copied: 1, failed: 1, next: null });
    expect(mocks.one).toHaveBeenCalledWith(kid(1), "2026-27", "full");
    expect(mocks.place).toHaveBeenCalledWith(expect.objectContaining({
      studentId: kid(2), source: "fees", sourceRef: "a/2.jpg", expectedCurrent: kid(102), actorStaffId: staff.id,
      commandId: feesCopyCommandId(kid(2), { path: "a/2.jpg", expected: kid(102) }),
    }));
    expect(mocks.page).not.toHaveBeenCalled();
  });

  it("stops the batch when Fees refuses the admin, and counts any other failure", async () => {
    mocks.feesRows.mockResolvedValue({ data: [{ id: kid(1), photo_path: "a/1.jpg" }], error: null });
    mocks.one.mockRejectedValueOnce(new FeesBridgeError("not_found", "missing"));
    expect(await copy({ after: null, budgetMs: 1000 })).toMatchObject({ copied: 0, failed: 1 });
    mocks.one.mockRejectedValueOnce(new FeesBridgeError("forbidden", "no grant"));
    await expect(copy({ after: null, budgetMs: 1000 })).rejects.toThrow("no grant");
  });

  it("reads many through Fees' photo pages, placing only the missing ones and counting unreadable photos", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: kid(i + 1), photo_path: `a/${i + 1}.jpg` }));
    mocks.feesRows.mockResolvedValue({ data: rows, error: null });
    mocks.oneRows.mockResolvedValue({ data: [{ id: kid(103), student_id: kid(3), source: "camera", source_ref: null }], error: null });
    const photo = (n: number, status = "active") => ({ studentId: kid(n), admissionNo: null, fullName: "Synthetic", classLabel: "1-A", status, contentType: "image/jpeg", data: "/9j/2Q==" });
    mocks.page
      .mockResolvedValueOnce({ photos: [photo(1), photo(2), photo(3), photo(40)], skipped: [{ studentId: kid(4), admissionNo: null, fullName: "Synthetic", reason: "unreadable" }], next: kid(40), total: 30 })
      .mockResolvedValueOnce({ photos: [photo(5), photo(6, "left")], skipped: [], next: null, total: 30 });
    expect(await copy({ after: null, budgetMs: 60_000 })).toEqual({ total: 20, pending: 19, copied: 3, failed: 1, next: null });
    expect(mocks.page).toHaveBeenNthCalledWith(1, "2026-27", null);
    expect(mocks.page).toHaveBeenNthCalledWith(2, "2026-27", kid(40));
    expect(mocks.place.mock.calls.map(([input]) => input.studentId).sort()).toEqual([kid(1), kid(2), kid(5)]);
    expect(mocks.one).not.toHaveBeenCalled();
  });

  it("hands back where it stopped once the time is spent", async () => {
    mocks.feesRows.mockResolvedValue({ data: Array.from({ length: 20 }, (_, i) => ({ id: kid(i + 1), photo_path: `a/${i + 1}.jpg` })), error: null });
    mocks.page.mockResolvedValue({ photos: [], skipped: [], next: kid(40), total: 30 });
    expect(await copy({ after: kid(20), budgetMs: 0 })).toMatchObject({ next: kid(40) });
    expect(mocks.page).toHaveBeenCalledTimes(1);
    expect(mocks.page).toHaveBeenCalledWith("2026-27", kid(20));
  });

  it("refuses to guess when One's own lists cannot be read", async () => {
    mocks.feesRows.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(copy({ after: null, budgetMs: 1000 })).rejects.toThrow("photo_copy_unavailable");
  });
});

vi.mock("@/platform/auth/current-staff", () => ({ getCurrentStaff: mocks.staff }));
vi.mock("@/platform/fees-bridge/policy", async (original) => ({ ...(await original<object>()), usesCanonicalFees: mocks.canonical }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: mocks.preview }));
vi.mock("@/platform/fees-bridge/state", () => ({ readFeesBridgeHealth: mocks.health }));

describe("the photo copy route", () => {
  const admin = { id: kid(999), role: "admin", isActive: true, isTestAccount: false };
  const ask = async (body: unknown = {}, origin = "https://one.vpps.co.in") => {
    const { POST } = await import("@/app/api/fees-bridge/photos/copy/route");
    return POST(new Request("https://one.vpps.co.in/api/fees-bridge/photos/copy", {
      method: "POST", headers: { origin, host: "one.vpps.co.in", "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.staff.mockResolvedValue(admin); mocks.canonical.mockReturnValue(true); mocks.preview.mockResolvedValue(undefined);
    mocks.health.mockResolvedValue({ state: { active_session_label: "2026-27" }, status: "fresh" });
    mocks.feesRows.mockResolvedValue({ data: [], error: null });
  });

  it("copies for a real admin of the real year", async () => {
    const response = await ask({ after: null });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, total: 0, pending: 0, copied: 0, failed: 0, next: null });
  });

  it("refuses another origin, other roles, test accounts, a preview and a bad cursor", async () => {
    expect((await ask({}, "https://evil.test")).status).toBe(403);
    for (const who of [{ ...admin, role: "office" }, { ...admin, isTestAccount: true }, null]) {
      mocks.staff.mockResolvedValueOnce(who);
      expect((await ask()).status).toBe(403);
    }
    mocks.preview.mockRejectedValueOnce(new Error("previewing"));
    expect((await ask()).status).toBe(403);
    expect((await ask({ after: "../x" })).status).toBe(400);
    expect(mocks.feesRows).not.toHaveBeenCalled();
  });

  it("does nothing for a test year", async () => {
    mocks.health.mockResolvedValue({ state: { active_session_label: "TEST-2026-27" }, status: "fresh" });
    expect(await (await ask()).json()).toMatchObject({ ok: true, pending: 0, next: null });
    expect(mocks.feesRows).not.toHaveBeenCalled();
  });

  it("names a Fees refusal without passing its words on", async () => {
    mocks.feesRows.mockResolvedValue({ data: Array.from({ length: 2 }, (_, i) => ({ id: kid(i + 1), photo_path: `a/${i}.jpg` })), error: null });
    mocks.oneRows.mockResolvedValue({ data: [], error: null });
    mocks.one.mockRejectedValue(new FeesBridgeError("forbidden", "private words"));
    const response = await ask();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, code: "bridge_forbidden" });
  });
});
