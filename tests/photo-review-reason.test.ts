import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * U03: an admin sends a photograph back with the reason the teacher reads,
 * and cannot send one back without saying why. Synthetic ids only.
 */

const scene = vi.hoisted(() => ({
  staff: { id: "00000000-0000-4000-8000-0000000000ad", role: "admin" },
  rpc: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/platform/auth/current-staff", () => ({ assertStaff: async () => scene.staff }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ rpc: scene.rpc }) }));
// The by-id session fence has its own tests (native-write-fence, test-session-access).
vi.mock("@/platform/auth/test-session-access", () => ({ passesFence: async () => true, assertStudentVisible: async () => undefined, assertNotTestAccount: async () => undefined }));
vi.mock("@/modules/collection/data/profile-photo-context", () => ({ photoAuthority: vi.fn(), readPhotoContext: vi.fn(), PHOTO_UUID: /^[0-9a-f-]{36}$/i }));
vi.mock("@/modules/collection/data/photo-proposals", () => ({ photoOutcome: (data: unknown, error: unknown) => (error ? { ok: false, reason: "refused" } : { ok: true }) }));
vi.mock("@/modules/collection/data/photos-repo", () => ({ placePhoto: vi.fn() }));
vi.mock("@/modules/collection/data/photo-storage", () => ({ preparePhoto: vi.fn(), stagePhoto: vi.fn() }));
vi.mock("@/modules/teacher-tasks/data/collection-save", () => ({ submitCollectionPhoto: vi.fn() }));

import { reviewPhotoAction } from "@/app/(app)/collection/photos/profile-actions";
import { rejectionNote } from "@/modules/collection/domain/profile-photo";

const PROPOSAL = "00000000-0000-4000-8000-0000000000p1".replace("p1", "a1");

describe("sending a photograph back (U03)", () => {
  beforeEach(() => {
    scene.rpc.mockReset();
    scene.rpc.mockResolvedValue({ data: { ok: true }, error: null });
    scene.staff = { id: "00000000-0000-4000-8000-0000000000ad", role: "admin" };
  });

  it("keeps a reason of 3 to 300 letters, spaces folded, and nothing else", () => {
    expect(rejectionNote("  face   not clear ")).toBe("face not clear");
    expect(rejectionNote("ok")).toBeNull();
    expect(rejectionNote(null)).toBeNull();
    expect(rejectionNote("x".repeat(301))).toBeNull();
  });

  it("refuses to send a photograph back without a reason, and calls nothing", async () => {
    await expect(reviewPhotoAction(PROPOSAL, false, " ")).resolves.toEqual({ ok: false, reason: "reason_required" });
    expect(scene.rpc).not.toHaveBeenCalled();
  });

  it("records the reason with the rejection, and none with an approval", async () => {
    await expect(reviewPhotoAction(PROPOSAL, false, "Face is not clear")).resolves.toEqual({ ok: true });
    expect(scene.rpc).toHaveBeenLastCalledWith("review_student_photo", { p_actor: scene.staff.id, p_proposal: PROPOSAL, p_accept: false, p_note: "Face is not clear" });
    await reviewPhotoAction(PROPOSAL, true, "ignored");
    expect(scene.rpc).toHaveBeenLastCalledWith("review_student_photo", { p_actor: scene.staff.id, p_proposal: PROPOSAL, p_accept: true, p_note: null });
  });

  it("is admin-only", async () => {
    scene.staff = { id: scene.staff.id, role: "teacher" };
    await expect(reviewPhotoAction(PROPOSAL, true)).resolves.toEqual({ ok: false, reason: "not_permitted" });
    expect(scene.rpc).not.toHaveBeenCalled();
  });
});
