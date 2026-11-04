import { beforeEach, describe, expect, it, vi } from "vitest";

const scene = vi.hoisted(() => ({
  extract: vi.fn(), blocked: vi.fn(), record: vi.fn(), owned: vi.fn(), update: vi.fn(), download: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/providers", () => ({ extractWithProviders: scene.extract }));
vi.mock("@/lib/ai/provider-status", async (original) => ({
  ...(await original<typeof import("@/lib/ai/provider-status")>()), freeKeyBlocked: scene.blocked, recordAttempts: scene.record,
}));
vi.mock("@/lib/ai/jobs", () => ({
  ownedAiJob: scene.owned, updateAiJob: scene.update, reserveAiJob: vi.fn(),
  inputBucket: () => ({ download: scene.download }),
}));

import { providerConfig } from "@/lib/ai/config";
import { readOrParseAiJob } from "@/lib/ai/feature-jobs";
import { statusRow } from "@/lib/ai/provider-status";
import { failureOf, keyState, leaveStageAt, nextPacificMidnight } from "@/lib/ai/router";

const geminiError = (status: number, body: string) => Object.assign(new Error(body), { status });

describe("router failure rules", () => {
  it("reads provider errors as fixed categories", () => {
    expect(failureOf(geminiError(429, '{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}')))
      .toEqual({ httpStatus: 429, problem: "quota_daily" });
    expect(failureOf(geminiError(429, '{"error":{"status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}}')))
      .toEqual({ httpStatus: 429, problem: "quota" });
    expect(failureOf(geminiError(403, '{"error":{"status":"PERMISSION_DENIED"}}'))).toEqual({ httpStatus: 403, problem: "permission" });
    expect(failureOf(geminiError(400, "API key not valid. API_KEY_INVALID"))).toEqual({ httpStatus: 400, problem: "credential" });
    expect(failureOf(geminiError(402, "Payment Required"))).toEqual({ httpStatus: 402, problem: "billing" });
    expect(failureOf(geminiError(429, "Transcription unavailable insufficient_quota"))).toEqual({ httpStatus: 429, problem: "billing" });
    expect(failureOf(geminiError(400, "Your credit balance is too low to access the Anthropic API"))).toEqual({ httpStatus: 400, problem: "billing" });
    expect(failureOf(new Error("Provider timed out"))).toEqual({ problem: "timeout" });
    expect(failureOf(new SyntaxError("Unexpected token"))).toEqual({ problem: "schema" });
    expect(failureOf(geminiError(503, "Service Unavailable"))).toEqual({ httpStatus: 503, problem: "server" });
  });

  it("leaves a stage at once for quota, billing and access errors, and retries timeouts and bad answers once", () => {
    for (const problem of ["quota_daily", "quota", "billing", "credential", "permission"] as const) expect(leaveStageAt(problem)).toBe(true);
    expect(leaveStageAt("timeout")).toBe(false);
    expect(leaveStageAt("schema")).toBe(false);
    expect(leaveStageAt("server", 503)).toBe(false);
    expect(keyState("quota_daily")).toBe("quota");
    expect(keyState("permission")).toBe("failing");
    expect(keyState(null)).toBe("ok");
  });

  it("blocks the free key until the next midnight Pacific, in summer and winter time", () => {
    // 4 Nov 2026 (PST, UTC-8): 14:00 IST is 00:30 PST; the next midnight is 5 Nov 08:00 UTC.
    expect(nextPacificMidnight(new Date("2026-11-04T08:30:00Z")).toISOString()).toBe("2026-11-05T08:00:00.000Z");
    // 1 Jul 2026 (PDT, UTC-7): midnight Pacific is 07:00 UTC.
    expect(nextPacificMidnight(new Date("2026-07-01T12:00:00Z")).toISOString()).toBe("2026-07-02T07:00:00.000Z");
    // The day daylight saving ends (1 Nov 2026): midnight on 2 Nov is 08:00 UTC.
    expect(nextPacificMidnight(new Date("2026-11-01T10:00:00Z")).toISOString()).toBe("2026-11-02T08:00:00.000Z");
    const now = new Date("2026-11-04T08:30:00Z");
    expect(statusRow("gemini-free", { outcome: "unavailable", problem: "quota_daily", httpStatus: 429, model: "gemini-3.8-flash" }, now))
      .toMatchObject({ state: "quota", blocked_until: "2026-11-05T08:00:00.000Z" });
    expect(statusRow("gemini-free", { outcome: "unavailable", problem: "quota", model: "m" }, now).blocked_until).toBe("2026-11-04T08:31:00.000Z");
    expect(statusRow("gemini-free", { outcome: "unavailable", problem: "permission", httpStatus: 403, model: "m" }, now).blocked_until).toBe("2026-11-04T08:40:00.000Z");
    expect(statusRow("gemini-paid", { outcome: "unavailable", problem: "quota_daily", model: "m" }, now).blocked_until).toBeNull();
    expect(statusRow("anthropic", { outcome: "ok", model: "m" }, now)).toMatchObject({ state: "ok", problem: null, blocked_until: null });
  });

  it("uses the same Gemini model on the paid key unless one is set for it", () => {
    const keys = { GEMINI_API_KEY_FREE: "free", GEMINI_API_KEY: "paid", GEMINI_INR_PER_USD: "90" };
    expect(providerConfig({ ...keys, GEMINI_MODEL: "gemini-3.8-flash" })).toMatchObject({ model: "gemini-3.8-flash", vision: "gemini-3.8-flash", paidModel: "gemini-3.8-flash" });
    expect(providerConfig({ ...keys, GEMINI_MODEL: "gemini-3.6-flash", GEMINI_MODEL_PAID: "gemini-3.1-flash-lite" }).paidModel).toBe("gemini-3.1-flash-lite");
    expect(() => providerConfig({ ...keys, GEMINI_MODEL: "gemini-flash-latest" })).toThrow();
  });
});

describe("the job runner and the free key", () => {
  const scope = { staffId: "staff", action: "voice", session: "TEST-2026-27", targetId: "staff", revision: 0 };
  const config = providerConfig({ GEMINI_API_KEY_FREE: "free", GEMINI_API_KEY: "paid", ANTHROPIC_API_KEY: "claude", GEMINI_INR_PER_USD: "90" });
  const spec = { task: "voice" as const, instructions: "x", context: {}, responseSchema: {}, validate: { safeParse: () => ({ success: true, data: {} }) } as never };
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(20)]);

  beforeEach(() => {
    vi.resetAllMocks();
    scene.owned.mockResolvedValue({ id: "job", status: "draft", parsed_at: null, parse_started_at: null, purged_at: null,
      target_revision: 0, created_at: new Date().toISOString(), input_paths: ["job/1.wav"], model: "m" });
    scene.update.mockImplementation(async (_owner, changes) => ({ id: "job", status: "draft", ...changes }));
    scene.download.mockResolvedValue({ data: new Blob([wav]), error: null });
    scene.extract.mockResolvedValue({ ok: true, value: { transcript: "x" }, attempts: [
      { provider: "anthropic", keyType: "credits", model: "claude-haiku-5-5", outcome: "ok", input: 1, output: 1, thinking: 0, costInr: 0.01, modelVersion: null, usageReported: true },
    ] });
  });

  it("skips a blocked free key, records each key's outcome, and saves the answering key's type", async () => {
    scene.blocked.mockResolvedValue(true);
    const result = await readOrParseAiJob(scope, config, "job", spec);
    expect(result.ok).toBe(true);
    expect(scene.extract.mock.calls[0][0].config.freeApiKey).toBeUndefined();
    expect(scene.record).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ provider: "anthropic" })]));
    expect(scene.update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ key_type: "credits", provider: "anthropic" }), "complete-parse");
  });

  it("offers TEST material to the free key when it is available", async () => {
    scene.blocked.mockResolvedValue(false);
    await readOrParseAiJob(scope, config, "job", spec);
    expect(scene.extract.mock.calls[0][0].config.freeApiKey).toBe("free");
    // Real records never reach the free key, blocked or not (D-401).
    await readOrParseAiJob({ ...scope, session: "2026-27" }, config, "job", spec);
    expect(scene.extract.mock.calls[1][0].config.freeApiKey).toBeUndefined();
  });
});
