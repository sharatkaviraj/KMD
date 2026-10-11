import { beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({
  commit: vi.fn(), activity: vi.fn(), revalidate: vi.fn(),
  staff: { id: "synthetic-teacher", displayName: "Synthetic teacher" },
}));
vi.mock("next/cache", () => ({ revalidatePath: scene.revalidate }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "OPS-TEST" }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async () => scene.staff }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => undefined }));
vi.mock("@/vx/screens/exams/data", () => ({ logActivity: scene.activity, paperById: async () => ({ assessment_id: "synthetic-exam", class_label: "QA Class", subject_code: "Maths" }) }));
vi.mock("@/vx/screens/exams/guards", () => ({ previewRefusal: async () => null, mayEnterPaper: async () => true, isManager: () => false, classTeacherOf: async () => [], newToken: vi.fn(), NOT_YOURS: { en: "Not yours", hi: "QA" } }));
vi.mock("@/vx/screens/exams/marks-save", () => ({ commitMarks: scene.commit, withdrawMarks: vi.fn() }));

import { saveTeacherMarksAction } from "@/app/(app)/teach/marks/actions";
import type { SavePayload } from "@/vx/screens/exams/save-types";

const payload: SavePayload = { commandId: "00000000-0000-4000-8000-000000000001", paperId: "00000000-0000-4000-8000-000000000002", kind: "submit", expectedRevision: 0, reason: null, entries: [] };
const receipt = { ok: true, revision: 1, entryStatus: "submitted", savedAt: "2026-10-11T12:00:00Z", actorName: "Synthetic teacher", changed: 1, counts: null };

describe("successful submit replay activity", () => {
  beforeEach(() => { vi.clearAllMocks(); scene.activity.mockResolvedValue(undefined); });

  it("records a first successful submission once", async () => {
    scene.commit.mockResolvedValue({ ...receipt, replayed: false });
    await expect(saveTeacherMarksAction(payload)).resolves.toMatchObject({ ok: true });
    expect(scene.activity).toHaveBeenCalledTimes(1);
  });

  it("does not add a second activity for a receipt replay after an interrupted answer", async () => {
    scene.commit.mockResolvedValue({ ...receipt, replayed: true });
    await expect(saveTeacherMarksAction(payload)).resolves.toMatchObject({ ok: true });
    expect(scene.activity).not.toHaveBeenCalled();
    expect(scene.revalidate).toHaveBeenCalledWith("/teach/marks");
  });
});
