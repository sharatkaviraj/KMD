import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  actor: { id: "admin", role: "admin", isActive: true, isTestAccount: false },
  session: "2026-27", canonical: true, health: vi.fn(), from: vi.fn(), sign: vi.fn(),
  rows: [] as { id: string; photo_path: string | null }[], filters: [] as unknown[],
  copies: [] as { id: string; student_id: string; source: string; source_ref: string | null }[],
}));
vi.mock("server-only", () => ({}));
vi.mock("@/platform/auth/current-staff", () => ({ assertStaff: async () => state.actor }));
vi.mock("@/platform/fees-bridge/policy", () => ({ feesBridgeEnabled: () => true, usesCanonicalFees: () => state.canonical }));
vi.mock("@/platform/fees-bridge/state", () => ({ readFeesBridgeState: state.health }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from, storage: { from: () => ({ createSignedUrls: state.sign }) } }) }));
vi.mock("@/platform/supabase/server", () => ({ createClient: async () => ({ from: state.from }) }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => state.session }));
vi.mock("@/modules/attendance/data/teaching-repo", () => ({ classScopeFor: async () => ({ everyClass: false, classIds: [] }) }));
vi.mock("@/modules/collection/data/photo-link", () => ({ studentPhotoLink: (student: string, photo: string, size: string) => `/api/photos/students/${student}?v=${photo}&s=${size}` }));
import { approvedStudentPhotos } from "@/modules/collection/data/approved-photos";
import { bridgeStudentPhotoHref } from "@/platform/fees-bridge/student-photo";

const withPhoto = "00000000-0000-4000-8000-000000000001";
const withoutPhoto = "00000000-0000-4000-8000-000000000002";
beforeEach(() => {
  vi.clearAllMocks(); state.actor = { id: "admin", role: "admin", isActive: true, isTestAccount: false };
  state.session = "2026-27"; state.canonical = true; state.filters = []; state.copies = [];
  state.health.mockResolvedValue({});
  state.rows = [{ id: withPhoto, photo_path: "private-source/path.jpg" }, { id: withoutPhoto, photo_path: null }];
  state.from.mockImplementation((table: string) => {
    const query = { select: () => query, eq: (key: string, value: string) => { state.filters.push([key, value]); return query; },
      is: () => query, in: (key: string, value: string[]) => { state.filters.push([key, value]); return query; },
      then: (resolve: (v: unknown) => void) => Promise.resolve({ data: table === "fees_bridge_students" ? state.rows : table === "student_photos" ? state.copies : [], error: null }).then(resolve) };
    return query;
  });
});

describe("canonical real student portraits", () => {
  it("returns only authenticated same-origin URLs for the exact current session and requested IDs", async () => {
    const photos = await approvedStudentPhotos([withPhoto, withoutPhoto, withPhoto]);
    expect([...photos]).toEqual([[withPhoto, `/api/fees-bridge/students/${withPhoto}/photo?session=2026-27&variant=list`]]);
    expect(state.filters).toEqual([["session_label", "2026-27"], ["id", [withPhoto, withoutPhoto]], ["student_id", [withPhoto, withoutPhoto]]]);
    expect(state.from.mock.calls).toEqual([["fees_bridge_students"], ["student_photos"]]);
    expect(state.sign).not.toHaveBeenCalled();
    expect(JSON.stringify([...photos])).not.toContain("private-source");
  });
  it("uses One's up-to-date copy of the Fees photo as a link the phone keeps, and Fees otherwise", async () => {
    const third = "00000000-0000-4000-8000-000000000003";
    const copy = "00000000-0000-4000-8000-0000000000c1";
    const placed = "00000000-0000-4000-8000-0000000000c2";
    const stale = "00000000-0000-4000-8000-0000000000c3";
    state.rows = [{ id: withPhoto, photo_path: "private-source/path.jpg" }, { id: withoutPhoto, photo_path: null }, { id: third, photo_path: "private-source/new.jpg" }];
    state.copies = [
      { id: copy, student_id: withPhoto, source: "fees", source_ref: "private-source/path.jpg" },
      { id: placed, student_id: withoutPhoto, source: "camera", source_ref: null },
      { id: stale, student_id: third, source: "fees", source_ref: "private-source/old.jpg" },
    ];
    const photos = await approvedStudentPhotos([withPhoto, withoutPhoto, third]);
    expect(photos.get(withPhoto)).toBe(`/api/photos/students/${withPhoto}?v=${copy}&s=list`);
    expect(photos.get(withoutPhoto)).toBe(`/api/photos/students/${withoutPhoto}?v=${placed}&s=list`);
    // Fees has a newer photo than One's copy: Fees' own reader until the copy catches up.
    expect(photos.get(third)).toBe(`/api/fees-bridge/students/${third}/photo?session=2026-27&variant=list`);
    expect(JSON.stringify([...photos])).not.toContain("private-source");
  });
  it("asks nothing for ids that are not children's ids", async () => {
    const photos = await approvedStudentPhotos(["../secret", "own"]);
    expect(photos.size).toBe(0);
    expect(state.from).not.toHaveBeenCalled();
  });
  it("fails closed on stale projection health before reading any student photo metadata", async () => {
    state.health.mockRejectedValue(new Error("stale_roster"));
    await expect(approvedStudentPhotos([withPhoto])).rejects.toThrow("stale_roster");
    expect(state.from).not.toHaveBeenCalled(); expect(state.sign).not.toHaveBeenCalled();
  });
  it("leaves isolated TEST photographs on their existing approved local reader", async () => {
    state.canonical = false; state.actor.isTestAccount = true; state.session = "TEST-2026-27";
    await approvedStudentPhotos([withPhoto]);
    expect(state.health).not.toHaveBeenCalled(); expect(state.from.mock.calls).toEqual([["student_photos"]]);
  });
  it("does not broaden a view-only reader's permission", async () => {
    state.actor.role = "view_only";
    await expect(approvedStudentPhotos([withPhoto])).rejects.toThrow("not_permitted");
    expect(state.health).not.toHaveBeenCalled(); expect(state.from).not.toHaveBeenCalled();
  });
  it.each(["TEST-2026-27", "UAT-2026-27", "2026-27&variant=full", "", "https://foreign.test"])("rejects an unsafe photo session %s", session => {
    expect(() => bridgeStudentPhotoHref(withPhoto, session)).toThrow("invalid_photo_identity");
  });
  it("rejects path injection and supports only the two fixed variants", () => {
    expect(() => bridgeStudentPhotoHref("../secret", "2026-27")).toThrow();
    expect(bridgeStudentPhotoHref(withPhoto, "2026-27", "full")).toContain("variant=full");
    expect(() => bridgeStudentPhotoHref(withPhoto, "2026-27", "unknown" as "full")).toThrow();
  });
});
