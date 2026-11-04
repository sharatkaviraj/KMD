import { describe, expect, it, vi } from "vitest";
import { FinishReason, type GenerateContentResponse } from "@google/genai";

vi.mock("server-only", () => ({}));

import { builtinAiPilot, DEFAULT_MODEL, geminiConfig } from "@/lib/ai/config";
import { extractWithGemini } from "@/lib/ai/gemini";
import { marksPhoto } from "@/lib/ai/photo-schema";

const env = { VPPSONE_BUILTIN_AI_TEST: "1", GEMINI_API_KEY: "fake", GEMINI_INR_PER_USD: "90" };
const config = geminiConfig(env);
const options = {
  config, primary: DEFAULT_MODEL, useFallback: true, instructions: "Transcribe.", context: {},
  media: [{ mimeType: "image/jpeg" as const, data: new Uint8Array([1]) }], ...marksPhoto,
};
function response(text: string, finishReason = FinishReason.STOP) {
  return {
    text, candidates: [{ finishReason }], modelVersion: "gemini-test-pinned",
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
  } as GenerateContentResponse;
}

describe("the built-in Gemini boundary", () => {
  it("fails closed on missing pilot configuration, production and floating model aliases", () => {
    expect(builtinAiPilot({})).toBeNull();
    expect(builtinAiPilot({ ...env, VERCEL_ENV: "production" })).toBeNull();
    expect(builtinAiPilot({ ...env, VPPSONE_ENV: "live" })).toBeNull();
    expect(builtinAiPilot({ ...env, GEMINI_MODEL_VISION: "gemini-flash-latest" })).toBeNull();
    expect(builtinAiPilot(env)?.vision).toBe(DEFAULT_MODEL);
  });

  it("requests structured JSON, retries once with a distinct model, and counts thinking on both attempts", async () => {
    const generate = vi.fn()
      .mockResolvedValueOnce(response('{"rows":[{"fakeStudentId":"invented"}]}'))
      .mockResolvedValueOnce(response('{"rows":[]}'));
    const result = await extractWithGemini(options, generate);
    expect(result.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(2);
    for (const [request] of generate.mock.calls) {
      expect(request.config.responseMimeType).toBe("application/json");
      expect(request.config.responseSchema).toBeDefined();
      expect(request.config.tools).toBeUndefined();
      expect(request.config.httpOptions.retryOptions.attempts).toBe(1);
    }
    expect(generate.mock.calls.map(([r]) => r.model)).toEqual([DEFAULT_MODEL, config.fallback]);
    expect(result.attempts.map((a) => [a.outcome, a.input, a.output, a.thinking])).toEqual([
      ["invalid", 100, 20, 30], ["ok", 100, 20, 30],
    ]);
    expect(result.attempts[0].costInr).toBeCloseTo((100 * 0.3 + 50 * 2.5) / 1_000_000 * 90);
  });

  it("does not retry a safety block or authentication failure", async () => {
    const blocked = vi.fn().mockResolvedValue(response('{"rows":[]}', FinishReason.SAFETY));
    expect((await extractWithGemini(options, blocked)).ok).toBe(false);
    expect(blocked).toHaveBeenCalledTimes(1);
    const invalidKey = vi.fn().mockRejectedValue({ status: 403, message: "private text" });
    expect((await extractWithGemini(options, invalidKey)).ok).toBe(false);
    expect(invalidKey).toHaveBeenCalledTimes(1);
  });
});
