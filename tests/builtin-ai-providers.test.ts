import type Anthropic from "@anthropic-ai/sdk";
import { FinishReason, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { builtinAiMode, builtinAiPilot, configForSession, providerConfig } from "@/lib/ai/config";
import type { AiMedia } from "@/lib/ai/gemini";
import { marksPhoto } from "@/lib/ai/photo-schema";
import { extractWithProviders } from "@/lib/ai/providers";
import { voiceSpec } from "@/lib/ai/voice-schema";

const env = {
  VPPSONE_BUILTIN_AI_TEST: "1", GEMINI_INR_PER_USD: "90",
  GEMINI_API_KEY_FREE: "test-free", GEMINI_API_KEY: "test-paid",
  ANTHROPIC_API_KEY: "test-claude", OPEN_AI_API_KEY: "test-transcription",
};
const config = builtinAiPilot(env)!;
const image: AiMedia = { mimeType: "image/jpeg", data: new Uint8Array([0xff, 0xd8]) };
const mp4: AiMedia = { mimeType: "audio/mp4", data: new Uint8Array([1, 2, 3]) };
const options = {
  config, task: "image" as const, media: [image], instructions: "Extract rows.",
  context: { fixture: "synthetic" }, ...marksPhoto,
};
const validOutput = '{"rows":[]}';

function geminiResponse(text = validOutput, finishReason = FinishReason.STOP) {
  return {
    text, candidates: [{ finishReason }], modelVersion: "gemini-test-pinned",
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
  } as GenerateContentResponse;
}

function claudeResponse(text = validOutput, stop_reason: Anthropic.Message["stop_reason"] = "end_turn") {
  return {
    stop_reason, model: "claude-test-pinned", content: [{ type: "text", text }],
    usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { thinking_tokens: 8 } },
  } as unknown as Anthropic.Message;
}

describe("built-in AI provider routing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("uses distinct TEST-only Gemini slots and preserves the legacy paid key", () => {
    expect(config).toMatchObject({
      freeApiKey: "test-free", paidApiKey: "test-paid", paidModel: "gemini-3.5-flash-lite",
    });
    expect(builtinAiPilot({ ...env, GEMINI_API_KEY_PAID: "test-explicit-paid" })?.paidApiKey).toBe("test-explicit-paid");
    expect(builtinAiPilot({ ...env, GEMINI_API_KEY_FREE: env.GEMINI_API_KEY })?.freeApiKey).toBeUndefined();
    expect(builtinAiPilot({ ...env, GEMINI_API_KEY_FREE: "" })).toMatchObject({ paidApiKey: "test-paid" });
    expect(builtinAiPilot({ ...env, VERCEL_ENV: "production" })).toBeNull();
    expect(builtinAiPilot({ ...env, VPPSONE_ENV: "live" })).toBeNull();
  });

  it("is off on production until VPPSONE_BUILTIN_AI says test or live, and never live when confined", () => {
    const production = { ...env, VPPSONE_BUILTIN_AI_TEST: "", VERCEL_ENV: "production" };
    expect(builtinAiMode(production)).toBe("off");
    expect(builtinAiMode({ ...production, VPPSONE_BUILTIN_AI_TEST: "1" })).toBe("off");
    expect(builtinAiMode({ ...production, VPPSONE_BUILTIN_AI: "yes" })).toBe("off");
    expect(builtinAiMode({ ...production, VPPSONE_BUILTIN_AI: "test" })).toBe("test");
    expect(builtinAiMode({ ...production, VPPSONE_BUILTIN_AI: " Live " })).toBe("live");
    expect(builtinAiPilot({ ...production, VPPSONE_BUILTIN_AI: "live" })).toMatchObject({ anthropicApiKey: "test-claude" });
    expect(builtinAiMode({ ...env, VPPSONE_ENV: "live", VPPSONE_BUILTIN_AI: "live" })).toBe("live");
    // A Preview or local server shares the one database: TEST at most.
    expect(builtinAiMode({ VPPSONE_BUILTIN_AI: "live" })).toBe("test");
    expect(builtinAiMode({ VERCEL_ENV: "preview", VPPSONE_BUILTIN_AI_TEST: "1" })).toBe("test");
    expect(builtinAiMode({})).toBe("off");
  });

  it("never sends a real session's records to the Gemini free tier", async () => {
    expect(configForSession(config, "TEST-2026-27").freeApiKey).toBe("test-free");
    const real = configForSession(config, "2026-27");
    expect(real.freeApiKey).toBeUndefined();
    expect(real).toMatchObject({ paidApiKey: "test-paid", anthropicApiKey: "test-claude" });
    const gemini = vi.fn().mockResolvedValue(geminiResponse());
    const anthropic = vi.fn().mockResolvedValue(claudeResponse());
    const result = await extractWithProviders({ ...options, config: real }, { gemini, anthropic });
    expect(result.ok).toBe(true);
    expect(gemini).not.toHaveBeenCalled();
    expect(result.attempts.map((a) => a.provider)).toEqual(["anthropic"]);
  });

  it("validates model overrides against maintained compatible model IDs", async () => {
    const config = providerConfig({
      ...env, VPPSONE_BUILTIN_AI_TEST: "0", GEMINI_MODEL_PAID: "gemini-3.8-flash",
      VPPSONE_CLAUDE_IMAGE_MODEL: "claude-sonnet-5", VPPSONE_CLAUDE_VOICE_MODEL: "claude-sonnet-5-5",
      VPPSONE_OPENAI_TRANSCRIPTION_MODEL: "gpt-transcribe",
    });
    expect(config).toMatchObject({
      paidModel: "gemini-3.8-flash", claudeImageModel: "claude-sonnet-5",
      claudeVoiceModel: "claude-sonnet-5-5", openAiTranscriptionModel: "gpt-transcribe",
    });
    expect(builtinAiPilot({ ...env, VPPSONE_OPENAI_TRANSCRIPTION_MODEL: "gpt-live-transcribe" })).toBeNull();
    expect(builtinAiPilot({ ...env, VPPSONE_CLAUDE_IMAGE_MODEL: "claude-haiku-5-5" })).toBeNull();
    const anthropic = vi.fn().mockResolvedValue(claudeResponse());
    const result = await extractWithProviders({ ...options, config, providerOnly: "anthropic" }, { anthropic });
    expect(result.attempts[0]).toMatchObject({ model: "claude-sonnet-5", outcome: "ok" });
    expect(result.attempts[0].costInr).toBeGreaterThan(0);
  });

  it("uses the configured OPEN_AI_API_KEY ahead of the OpenAI compatibility name", () => {
    const both = { ...env, OPENAI_API_KEY: "legacy-transcription" };
    expect(providerConfig(both).openAiApiKey).toBe("test-transcription");
    expect(providerConfig({ ...both, OPEN_AI_API_KEY: "" }).openAiApiKey).toBe("legacy-transcription");
  });

  it("returns structured free Gemini output with zero estimated provider spend", async () => {
    const gemini = vi.fn().mockResolvedValue(geminiResponse());
    const anthropic = vi.fn();
    const result = await extractWithProviders(options, { gemini, anthropic });
    expect(result).toMatchObject({
      ok: true, value: { rows: [] }, attempts: [{
        provider: "gemini-free", model: "gemini-3.5-flash-lite", modelVersion: "gemini-test-pinned",
        input: 100, output: 20, thinking: 30, outcome: "ok", costInr: 0, usageReported: true,
      }],
    });
    expect(gemini).toHaveBeenCalledOnce();
    expect(gemini.mock.calls[0]).toEqual(["test-free", expect.objectContaining({
      config: expect.objectContaining({
        responseMimeType: "application/json", responseSchema: options.responseSchema,
        thinkingConfig: { thinkingLevel: "MINIMAL" }, httpOptions: expect.objectContaining({ retryOptions: { attempts: 1 } }),
      }),
    })]);
    expect(gemini.mock.calls[0][1].config.tools).toBeUndefined();
    expect(anthropic).not.toHaveBeenCalled();
  });

  it.each([403, 429])("moves directly from free Gemini HTTP %d to Claude Sonnet vision", async (status) => {
    const gemini = vi.fn().mockRejectedValue({ status });
    const anthropic = vi.fn().mockResolvedValue(claudeResponse());
    const result = await extractWithProviders(options, { gemini, anthropic });
    expect(gemini).toHaveBeenCalledOnce();
    expect(anthropic).toHaveBeenCalledOnce();
    expect(anthropic.mock.calls[0][0]).toBe("test-claude");
    expect(anthropic.mock.calls[0][1]).toMatchObject({
      model: "claude-sonnet-5-5", output_config: { effort: "low", format: { type: "json_schema" } },
      messages: [{ role: "user", content: [
        { type: "text", text: '{"fixture":"synthetic"}' },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9g=" } },
      ] }],
    });
    expect(anthropic.mock.calls[0][1].tools).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.attempts).toMatchObject([
      { provider: "gemini-free", outcome: "unavailable", usageReported: false },
      { provider: "anthropic", outcome: "ok", input: 100, output: 12, thinking: 8, usageReported: true },
    ]);
    expect(result.attempts[1].costInr).toBeCloseTo((100 * 2 + 20 * 10) / 1_000_000 * 90);
  });

  it("uses the installed SDKs against fixed provider URLs and passes quota failures through to the next provider", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({
        error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Synthetic quota" },
      }, { status: 429 }))
      .mockResolvedValueOnce(Response.json(claudeResponse()));
    vi.stubGlobal("fetch", fetch);
    const result = await extractWithProviders(options);
    expect(result.ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [[googleUrl, google], [claudeUrl, claude]] = fetch.mock.calls;
    expect(String(googleUrl)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    expect(new Headers(google?.headers).get("x-goog-api-key")).toBe("test-free");
    expect(String(claudeUrl)).toBe("https://api.anthropic.com/v1/messages");
    expect(new Headers(claude?.headers).get("authorization")).toBe("Bearer test-claude");
  });

  it("tries paid Gemini last after one Claude retry and rejects syntactically valid but unsafe drafts", async () => {
    const gemini = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce(geminiResponse('{"rows":[],"inventedId":"student"}'))
      .mockResolvedValueOnce(geminiResponse());
    const anthropic = vi.fn().mockResolvedValue(claudeResponse("not JSON"));
    const result = await extractWithProviders(options, { gemini, anthropic });
    expect(result.ok).toBe(true);
    expect(gemini.mock.calls.map(([key]) => key)).toEqual(["test-free", "test-paid", "test-paid"]);
    expect(result.attempts.map(({ provider, outcome }) => [provider, outcome])).toEqual([
      ["gemini-free", "unavailable"], ["anthropic", "invalid"], ["anthropic", "invalid"],
      ["gemini-paid", "invalid"], ["gemini-paid", "ok"],
    ]);
    expect(result.attempts[3].costInr).toBeCloseTo((100 * 0.3 + 50 * 2.5) / 1_000_000 * 90);
  });

  it("aborts timed out attempts and leaves time for the next provider", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const gemini = vi.fn<(key: string, request: GenerateContentParameters) => Promise<GenerateContentResponse>>(
      () => new Promise(() => {}),
    );
    const anthropic = vi.fn().mockResolvedValue(claudeResponse());
    const extracting = extractWithProviders(options, { gemini, anthropic });
    await vi.advanceTimersByTimeAsync(16_000);
    const result = await extracting;
    expect(gemini).toHaveBeenCalledTimes(2);
    expect(gemini.mock.calls.every(([, request]) => request.config?.abortSignal?.aborted)).toBe(true);
    expect(anthropic).toHaveBeenCalledOnce();
    expect(result.ok).toBe(true);
  });

  it("sends recorded voice to Gemini as M4A, then sends only the OpenAI transcript to Claude Haiku", async () => {
    const transcript = "Sample voice fixture.";
    const gemini = vi.fn().mockRejectedValue({ status: 429 });
    const fetch = vi.fn().mockResolvedValue(Response.json({
      text: transcript, usage: { type: "duration", seconds: 20 },
    }));
    const anthropic = vi.fn().mockResolvedValueOnce(claudeResponse("broken")).mockResolvedValueOnce(claudeResponse());
    const result = await extractWithProviders({ ...options, task: "voice", media: [mp4] }, { gemini, fetch, anthropic });
    expect(gemini.mock.calls[0][1].contents[0].parts[1]).toEqual({ inlineData: { mimeType: "audio/m4a", data: "AQID" } });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(request.body.get("model")).toBe("gpt-transcribe");
    expect(request.body.get("file")).toMatchObject({ type: "audio/mp4", name: "recording.m4a" });
    expect(request.body.get("prompt")).toBeNull();
    expect(anthropic.mock.calls[0][1]).toMatchObject({
      model: "claude-haiku-5-5",
      messages: [{ role: "user", content: [{ type: "text", text: JSON.stringify({ context: options.context, transcript }) }] }],
    });
    expect(result.ok).toBe(true);
    expect(result.attempts.map((a) => [a.provider, a.outcome])).toEqual([
      ["gemini-free", "unavailable"], ["openai", "ok"], ["anthropic", "invalid"], ["anthropic", "ok"],
    ]);
    expect(result.attempts[1].usageReported).toBe(true);
    expect(result.attempts[1].costInr).toBeCloseTo(20 / 60 * 0.0045 * 90);
  });

  it("moves from an OpenAI quota error to paid Gemini audio without calling Claude", async () => {
    const gemini = vi.fn().mockRejectedValueOnce({ status: 429 }).mockResolvedValueOnce(geminiResponse());
    const fetch = vi.fn().mockResolvedValue(new Response("error", { status: 429 }));
    const anthropic = vi.fn();
    const result = await extractWithProviders({ ...options, task: "voice", media: [mp4] }, { gemini, fetch, anthropic });
    expect(result.ok).toBe(true);
    expect(anthropic).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
    expect(gemini.mock.calls.map(([key]) => key)).toEqual(["test-free", "test-paid"]);
    expect(result.attempts.map((a) => a.provider)).toEqual(["gemini-free", "openai", "gemini-paid"]);
  });

  it("keeps missing duration and provider-only attempts visible in evaluation output", async () => {
    const gemini = vi.fn();
    const fetch = vi.fn().mockResolvedValue(Response.json({ text: "Synthetic transcript." }));
    const anthropic = vi.fn().mockResolvedValue(claudeResponse());
    const result = await extractWithProviders(
      { ...options, task: "voice", media: [mp4], providerOnly: "openai-claude" }, { gemini, fetch, anthropic },
    );
    expect(gemini).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.attempts).toMatchObject([
      { provider: "openai", costInr: 0, usageReported: false }, { provider: "anthropic", usageReported: true },
    ]);
  });

  it("requires Claude to keep the transcription used to verify spoken fields", async () => {
    const transcript = "Read attendance for class 7 B.";
    const claudeOutput = (text: string) => JSON.stringify({
      transcript: text, intent: "attendance_query", unclear: false, classLabel: "7 B",
    });
    const fetch = vi.fn().mockResolvedValue(Response.json({ text: transcript }));
    const anthropic = vi.fn()
      .mockResolvedValueOnce(claudeResponse(claudeOutput("Read attendance for class 7 A.")))
      .mockResolvedValueOnce(claudeResponse(claudeOutput(transcript)));
    const result = await extractWithProviders(
      { ...options, ...voiceSpec, task: "voice", media: [mp4], providerOnly: "openai-claude" }, { fetch, anthropic },
    );
    expect(result).toMatchObject({ ok: true, value: { transcript } });
    expect(result.attempts.map(({ outcome }) => outcome)).toEqual(["ok", "invalid", "ok"]);
  });

  it("stops after a Gemini safety block", async () => {
    const gemini = vi.fn().mockResolvedValue(geminiResponse(validOutput, FinishReason.SAFETY));
    const anthropic = vi.fn();
    const result = await extractWithProviders(options, { gemini, anthropic });
    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(gemini).toHaveBeenCalledOnce();
    expect(anthropic).not.toHaveBeenCalled();
  });
});
