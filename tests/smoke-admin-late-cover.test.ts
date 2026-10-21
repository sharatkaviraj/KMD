import { beforeEach, describe, expect, it, vi } from "vitest";

/* School-day run, 20 Oct (dev group 5): a running period nobody covers can have a teacher sent in. */

const calls = vi.hoisted(() => ({ late: vi.fn(), permission: vi.fn(), preview: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: calls.refresh }));
vi.mock("@/platform/auth/current-staff", () => ({ assertPermission: async (key: string) => { calls.permission(key); return { id: "11111111-1111-4111-8111-111111111111" }; } }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => calls.preview() }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => "QA-LATE", classLabelMap: vi.fn(), listSubjects: vi.fn() }));
vi.mock("@/modules/staff/data/staff-repo", () => ({ listStaff: vi.fn() }));
vi.mock("@/modules/attendance/data/attendance-repo", () => ({ schoolCalendar: async () => new Map() }));
vi.mock("@/modules/substitutions/data/absences-repo", () => ({ absencesOn: async () => [] }));
vi.mock("@/modules/substitutions/data/cover-repo", () => ({ coverDayRevision: vi.fn() }));
vi.mock("@/modules/substitutions/data/arrange-day", () => ({ readCoverDay: vi.fn(), arrangeLateCover: calls.late }));
vi.mock("@/modules/timetable/data/timetable-repo", () => ({ createDraft: vi.fn(), getPublishedVersion: vi.fn(), listSlots: vi.fn(), publishVersion: vi.fn() }));
vi.mock("@/app/(app)/substitutions/actions", () => ({ coverCommandAction: vi.fn(), checkCoverCommandAction: vi.fn() }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => { throw new Error("no direct writes"); } }));

import { lateCoverAction } from "@/app/(app)/timetable/vx-actions";

const input = { commandId: "22222222-2222-4222-8222-222222222222", sessionLabel: "QA-LATE", day: "2026-10-21", needKey: "Tue|2|class-7", coveringStaffId: "33333333-3333-4333-8333-333333333333" };
const receipt = { ok: true, command_id: input.commandId, kind: "late_assign", day: input.day, day_revision: 4, assigned: 1, needs_help: 0, new: 1, changed: 0, cancelled: 0, unchanged: 0, pinned: 0, skipped_started: 0, notices_queued: 1, notices_withdrawn: 0, notice_recipients: 1, recipients_without_phone: 0, replayed: false };

describe("lateCoverAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("checks the cover permission and the preview guard before writing", async () => {
    calls.late.mockResolvedValue(receipt);
    const result = await lateCoverAction(input);
    expect(calls.permission).toHaveBeenCalledWith("substitutions:manage");
    expect(calls.preview).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.message.en).toMatch(/^Sent now · 1 duty assigned/);
    expect(calls.late).toHaveBeenCalledWith(expect.objectContaining({ needKey: input.needKey, coveringStaffId: input.coveringStaffId, sessionLabel: "QA-LATE" }));
  });

  it("says plainly when the database update is not in yet", async () => {
    calls.late.mockResolvedValue({ ok: false, reason: "unavailable" });
    const result = await lateCoverAction(input);
    expect(result.ok).toBe(false);
    expect(result.message.en).toContain("Phone the teacher");
  });

  it("a period that has ended cannot be sent into", async () => {
    calls.late.mockResolvedValue({ ok: false, reason: "not_running" });
    expect((await lateCoverAction(input)).message.en).toContain("no longer running");
  });

  it("refuses a bad id or another session without calling the database", async () => {
    expect((await lateCoverAction({ ...input, coveringStaffId: "nope" })).ok).toBe(false);
    expect((await lateCoverAction({ ...input, sessionLabel: "OTHER" })).ok).toBe(false);
    expect(calls.late).not.toHaveBeenCalled();
  });
});
