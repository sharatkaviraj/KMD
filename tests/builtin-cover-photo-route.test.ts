import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AiPilotConfig } from "@/lib/ai/config";
import { runCoverPhotoRoute } from "@/lib/ai/cover-photo-service";
import type { CurrentStaff } from "@/platform/auth/current-staff";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), preview: vi.fn(), job: vi.fn(), cover: vi.fn(), parse: vi.fn(),
  review: vi.fn(), upload: vi.fn(), rpc: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/ai/feature-jobs", () => ({
  makeAiUpload: mocks.upload, readOrParseAiJob: mocks.parse,
  aiProblem: (code: string, status: number) => Response.json({ ok: false, code }, { status }),
  aiJson: (body: unknown) => Response.json(body),
}));
vi.mock("@/lib/ai/cover-photo-review", () => ({ reviewCoverPhoto: mocks.review }));
vi.mock("@/lib/ai/jobs", () => ({ ownedAiJob: mocks.job }));
vi.mock("@/lib/ai/read-prompt", () => ({ loadPhotoPrompt: async () => "synthetic prompt" }));
vi.mock("@/modules/academics/data/academics-repo", () => ({ resolveSessionLabel: mocks.session }));
vi.mock("@/modules/substitutions/data/arrange-day", () => ({ profilesFor: async () => ({}), readCoverDay: mocks.cover }));
vi.mock("@/modules/substitutions/data/cover-repo", () => ({ exclusionsFrom: () => new Map() }));
vi.mock("@/modules/substitutions/data/guided", () => ({ approvedLeaveOn: async () => ({}) }));
vi.mock("@/platform/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/vx/view-as", () => ({ assertNotPreviewing: mocks.preview }));

const actor: CurrentStaff = {
  id: "00000000-0000-4000-8000-000000000001", userId: "fixture-user",
  email: null, displayName: "Sample Coordinator", shortName: "SC",
  role: "academic_coordinator", isTeaching: true, isActive: true,
  language: "en", preferredStart: null, isTestAccount: true, permissions: ["substitutions:manage"],
};
const config = {} as AiPilotConfig;
const day = "2026-11-04";
const jobId = "00000000-0000-4000-8000-000000000002";
const assignment = { index: 0, absentId: "absent", coveringId: "available", classId: "one", period: 2, needKey: "lesson" };
const result = { jobId, review: { rows: [] }, applied: [0], undoUntil: "2026-11-04T02:02:00Z" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("VPPSONE_ENV", "");
  vi.stubEnv("VPPSONE_BUILTIN_AI", "");
  vi.stubEnv("VPPSONE_BUILTIN_AI_TEST", "1");
  vi.stubEnv("VPPSONE_BUILTIN_AI_COVER_AUTO_TEST", "1");
  mocks.session.mockResolvedValue("TEST-2026-27");
  mocks.job.mockResolvedValue({ status: "draft", target_revision: 1 });
  mocks.cover.mockResolvedValue({ versionId: "tt", header: "Wednesday", dayRevision: 1, slots: [{ period: 2 }], bells: { revision: 2 } });
  mocks.parse.mockResolvedValue({ ok: true, value: { rows: [] } });
  mocks.review.mockReturnValue({ review: { rows: [] }, assignments: [assignment] });
  mocks.rpc.mockResolvedValue({ data: { ok: true, result } });
});

describe("substitution photo route", () => {
  it("requires the scoped staff role and session and rejects role previews before privileged work", async () => {
    expect((await runCoverPhotoRoute({ ...actor, permissions: [] }, config, "parse", { day, jobId })).status).toBe(404);
    mocks.session.mockResolvedValueOnce("2026-27");
    expect((await runCoverPhotoRoute(actor, config, "parse", { day, jobId })).status).toBe(404);
    mocks.preview.mockRejectedValueOnce(new Error("preview"));
    expect((await runCoverPhotoRoute(actor, config, "parse", { day, jobId })).status).toBe(403);
    expect(mocks.job).not.toHaveBeenCalled();
  });

  it("auto-applies only server-validated rows and replays a committed receipt after a lost response", async () => {
    const response = await runCoverPhotoRoute(actor, config, "parse", { day, jobId });
    expect(await response.json()).toEqual({ ok: true, ...result });
    expect(mocks.parse).toHaveBeenCalledWith(
      expect.objectContaining({ session: "TEST-2026-27", targetId: "00000000-0000-4000-8000-000020261104" }),
      config, jobId, expect.objectContaining({ context: { date: day, periods: [3] }, stamp: "tt:2" }),
    );
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("apply_ai_cover_photo", expect.objectContaining({
      p_job: jobId, p_day: day, p_assignments: [assignment],
    }));
    mocks.job.mockResolvedValue({ status: "applied", final_applied_data: result });
    expect(await (await runCoverPhotoRoute(actor, config, "parse", { day, jobId })).json()).toEqual({ ok: true, ...result });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps auto-apply off by default and requires Undo to name an owned job", async () => {
    vi.stubEnv("VPPSONE_BUILTIN_AI_COVER_AUTO_TEST", "");
    expect(await (await runCoverPhotoRoute(actor, config, "parse", { day, jobId })).json())
      .toMatchObject({ applied: [], applyBlocked: "review_only" });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect((await runCoverPhotoRoute(actor, config, "apply", { day, jobId, mode: "undo", assignments: [assignment] })).status).toBe(400);
    mocks.job.mockResolvedValueOnce(null);
    expect((await runCoverPhotoRoute(actor, config, "apply", { day, jobId, mode: "undo" })).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: { ok: true, result: { ...result, undone: true } } });
    expect(await (await runCoverPhotoRoute(actor, config, "apply", { day, jobId, mode: "undo" })).json()).toMatchObject({ undone: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("undo_ai_cover_photo", { p_job: jobId, p_actor: actor.id, p_day: day });
  });

  it("goes live for a real coordinator in the real session and keeps test accounts in TEST", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VPPSONE_BUILTIN_AI_TEST", "");
    vi.stubEnv("VPPSONE_BUILTIN_AI_COVER_AUTO_TEST", "");
    const real = { ...actor, isTestAccount: false };
    mocks.session.mockResolvedValue("2026-27");
    // Production without the switch: nothing, for anybody.
    expect((await runCoverPhotoRoute(real, config, "parse", { day, jobId })).status).toBe(404);
    vi.stubEnv("VPPSONE_BUILTIN_AI", "test");
    expect((await runCoverPhotoRoute(real, config, "parse", { day, jobId })).status).toBe(404);
    vi.stubEnv("VPPSONE_BUILTIN_AI", "live");
    expect((await runCoverPhotoRoute(actor, config, "parse", { day, jobId })).status).toBe(404);
    expect(mocks.job).not.toHaveBeenCalled();

    expect(await (await runCoverPhotoRoute(real, config, "parse", { day, jobId })).json()).toEqual({ ok: true, ...result });
    expect(mocks.cover).toHaveBeenCalledWith("2026-27", day);
    expect(mocks.parse).toHaveBeenCalledWith(expect.objectContaining({ session: "2026-27" }), config, jobId, expect.anything());
    expect(mocks.rpc).toHaveBeenCalledOnce();

    mocks.rpc.mockClear();
    vi.stubEnv("VPPSONE_BUILTIN_AI_COVER_AUTO", "0");
    expect(await (await runCoverPhotoRoute(real, config, "parse", { day, jobId })).json()).toMatchObject({ applyBlocked: "review_only" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
