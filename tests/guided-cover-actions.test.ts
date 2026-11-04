import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Review C01: the guided cover flow's server boundary. The data layer is
 * mocked — these check what the actions guard, what they hand the cover
 * command and how they report its answers. Nothing is sent: the dispatcher is
 * a stub and `after` only records.
 */

const fixture = vi.hoisted(() => ({ session: "TEST-2026-27" as string | null, permitted: true, preview: false }));
const calls = vi.hoisted(() => ({
  writable: vi.fn(),
  arrange: vi.fn(),
  build: vi.fn(),
  committed: vi.fn(),
  leave: vi.fn(),
  find: vi.fn(),
  refresh: vi.fn(),
  after: vi.fn(),
  dispatch: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: calls.refresh }));
vi.mock("next/server", () => ({ after: calls.after }));
vi.mock("@/platform/auth/current-staff", () => ({
  assertPermission: async (permission: string) => {
    if (!fixture.permitted || permission !== "substitutions:manage") throw new Error("denied");
    return { id: "00000000-0000-4000-8000-0000000000c0" };
  },
}));
vi.mock("@/platform/auth/test-session-access", () => ({ assertSessionWritable: calls.writable }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: async () => { if (fixture.preview) throw new Error("preview"); } }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: async () => fixture.session }));
vi.mock("@/modules/substitutions/data/arrange-day", () => ({ arrangeDay: calls.arrange }));
vi.mock("@/modules/substitutions/data/cover-repo", () => ({ findCommand: calls.find }));
vi.mock("@/modules/substitutions/data/guided", () => ({ approvedLeaveOn: calls.leave, buildGuidedPreview: calls.build, readCommitted: calls.committed }));
vi.mock("@/modules/staff-notices/data/dispatcher", () => ({ dispatchStaffNotices: calls.dispatch }));

import { checkGuidedCoverAction, confirmGuidedCoverAction, previewGuidedCoverAction } from "@/app/(app)/substitutions/guided-actions";

const STAFF = "00000000-0000-4000-8000-0000000000a1";
const COVER = "00000000-0000-4000-8000-0000000000b1";
const COMMAND = "00000000-0000-4000-8000-0000000000d1";
const absence = { day: "2026-11-03", staffProfileId: STAFF, periods: [0, 1, 2] };
const confirmInput = { ...absence, commandId: COMMAND, dayRevision: 7, choices: [{ needKey: "lesson-1", coveringStaffId: COVER }], fingerprint: "3-abc123" };
const receipt = { ok: true, command_id: COMMAND, kind: "absence", day: "2026-11-03", day_revision: 8, assigned: 3, needs_help: 0, new: 3, changed: 0, cancelled: 0, unchanged: 0, pinned: 0, skipped_started: 0, notices_queued: 2, notices_withdrawn: 0, notice_recipients: 2, recipients_without_phone: 0, replayed: false };

beforeEach(() => {
  fixture.session = "TEST-2026-27";
  fixture.permitted = true;
  fixture.preview = false;
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.leave.mockResolvedValue({ [STAFF]: [0, 1, 2, 3], other: [4] });
  calls.committed.mockResolvedValue([{ period: 0, classLabels: ["Class 6"], subjectCode: "MATHS", status: "assigned", coveringName: "Test Teacher" }]);
});

describe("previewGuidedCoverAction", () => {
  it("needs cover management and a writable session, and writes nothing", async () => {
    calls.build.mockResolvedValue({ ok: true, preview: { fingerprint: "1-a" } });
    const result = await previewGuidedCoverAction({ ...absence, choices: [{ needKey: "z", coveringStaffId: COVER }, { needKey: "a", coveringStaffId: null }] });
    expect(result).toEqual({ ok: true, preview: { fingerprint: "1-a" } });
    expect(calls.writable).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }), "TEST-2026-27");
    expect(calls.build).toHaveBeenCalledWith({
      sessionLabel: "TEST-2026-27",
      ...absence,
      choices: [{ needKey: "a", coveringStaffId: null }, { needKey: "z", coveringStaffId: COVER }],
    });
    expect(calls.arrange).not.toHaveBeenCalled();

    fixture.permitted = false;
    await expect(previewGuidedCoverAction(absence)).rejects.toThrow("denied");
  });

  it("refuses an absence it cannot read rather than guessing", async () => {
    for (const bad of [
      { ...absence, day: "3 Nov" },
      { ...absence, staffProfileId: "nobody" },
      { ...absence, periods: [] },
      { ...absence, periods: [0, 9] },
    ]) {
      expect(await previewGuidedCoverAction(bad)).toEqual({ ok: false, reason: "bad_request" });
    }
    expect(await previewGuidedCoverAction({ ...absence, choices: [{ needKey: "x", coveringStaffId: "not-an-id" }] })).toEqual({ ok: false, reason: "bad_request" });
    expect(calls.build).not.toHaveBeenCalled();
    fixture.session = null;
    expect(await previewGuidedCoverAction(absence)).toEqual({ ok: false, reason: "no_session" });
  });

  it("a failed read says so", async () => {
    calls.build.mockRejectedValue(new Error("db down"));
    expect(await previewGuidedCoverAction(absence)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("confirmGuidedCoverAction", () => {
  it("hands the cover command exactly what was reviewed, and reports what the database then holds", async () => {
    calls.arrange.mockResolvedValue(receipt);
    const result = await confirmGuidedCoverAction(confirmInput);
    expect(calls.arrange).toHaveBeenCalledWith({
      actorStaffId: "00000000-0000-4000-8000-0000000000c0",
      sessionLabel: "TEST-2026-27",
      day: "2026-11-03",
      commandId: COMMAND,
      intent: { kind: "absence", staffProfileId: STAFF, periods: [0, 1, 2], choices: confirmInput.choices },
      expectedDayRevision: 7,
      expectedPlan: "3-abc123",
      // The absent teacher's own leave is not a reason to keep them off their own lessons.
      onLeave: { other: [4] },
    });
    expect(result).toMatchObject({ status: "saved", receipt: { commandId: COMMAND, noticesQueued: 2, noticeRecipients: 2 }, committed: [{ coveringName: "Test Teacher" }] });
    expect(calls.committed).toHaveBeenCalledWith("TEST-2026-27", "2026-11-03", STAFF, [0, 1, 2]);
    expect(calls.refresh).toHaveBeenCalledWith("/timetable");
    // Notices are the outbox's, after the response — never sent from here.
    expect(calls.after).toHaveBeenCalledTimes(1);
    expect(calls.dispatch).not.toHaveBeenCalled();
  });

  it("a save whose details cannot be read back is still saved", async () => {
    calls.arrange.mockResolvedValue({ ...receipt, notices_queued: 0 });
    calls.committed.mockRejectedValue(new Error("read failed"));
    expect(await confirmGuidedCoverAction(confirmInput)).toMatchObject({ status: "saved", committed: null });
    expect(calls.after).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: false, reason: "stale", current: { day_revision: 8 } }, { status: "stale" }],
    [{ ok: false, reason: "plan_changed", current: { day_revision: 7 } }, { status: "plan_changed" }],
    [{ ok: false, reason: "invalid", problems: [] }, { status: "plan_changed" }],
    [{ ok: false, reason: "failed", message: "x" }, { status: "unknown" }],
    [{ ok: false, reason: "refused_override", blocked: ["regular_class"] }, { status: "refused", reason: "refused_override" }],
    [{ ok: false, reason: "id_reused" }, { status: "refused", reason: "id_reused" }],
    [{ ok: false, reason: "disabled" }, { status: "refused", reason: "disabled" }],
  ])("reports %j as %j, and nothing as saved", async (outcome, expected) => {
    calls.arrange.mockResolvedValue(outcome);
    expect(await confirmGuidedCoverAction(confirmInput)).toEqual(expected);
    expect(calls.committed).not.toHaveBeenCalled();
    expect(calls.after).not.toHaveBeenCalled();
  });

  it("an error is not 'nothing happened': it is unknown, for the screen to check", async () => {
    calls.arrange.mockRejectedValue(new Error("socket hang up"));
    expect(await confirmGuidedCoverAction(confirmInput)).toEqual({ status: "unknown" });
  });

  it("checks permission, preview and the session before it reads anything", async () => {
    fixture.preview = true;
    await expect(confirmGuidedCoverAction(confirmInput)).rejects.toThrow("preview");
    fixture.preview = false;
    calls.writable.mockRejectedValueOnce(new Error("test session"));
    await expect(confirmGuidedCoverAction(confirmInput)).rejects.toThrow("test session");
    expect(calls.arrange).not.toHaveBeenCalled();
  });

  it("refuses a request without its command id, revision or fingerprint", async () => {
    for (const bad of [{ commandId: "x" }, { dayRevision: -1 }, { dayRevision: 1.5 }, { fingerprint: "" }, { fingerprint: "drop table" }]) {
      expect(await confirmGuidedCoverAction({ ...confirmInput, ...bad })).toEqual({ status: "refused", reason: "bad_request" });
    }
    expect(calls.arrange).not.toHaveBeenCalled();
  });
});

describe("checkGuidedCoverAction", () => {
  it("returns the first receipt of a command that landed", async () => {
    calls.find.mockResolvedValue({ ...receipt, replayed: true });
    expect(await checkGuidedCoverAction({ ...absence, commandId: COMMAND })).toMatchObject({ status: "saved", receipt: { replayed: true }, committed: [{}] });
    expect(calls.find).toHaveBeenCalledWith(COMMAND, "00000000-0000-4000-8000-0000000000c0");
  });

  it("says not found only when the server says so; a failed read throws", async () => {
    calls.find.mockResolvedValue(null);
    expect(await checkGuidedCoverAction({ ...absence, commandId: COMMAND })).toEqual({ status: "not_found" });
    calls.find.mockRejectedValue(new Error("Could not read that command"));
    await expect(checkGuidedCoverAction({ ...absence, commandId: COMMAND })).rejects.toThrow("Could not read");
  });
});
