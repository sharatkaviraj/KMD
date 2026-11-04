import "server-only";

import {
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
  type Schema,
} from "@google/genai";
import type { ZodType } from "zod";

import type { AiModel, GeminiConfig } from "@/lib/ai/config";

export type AiMedia = { mimeType: "image/jpeg" | "audio/webm" | "audio/aac" | "audio/wav"; data: Uint8Array };

type Usage = {
  model: AiModel;
  modelVersion: string | null;
  input: number;
  output: number;
  thinking: number;
  costInr: number;
  usageReported: boolean;
  outcome: "ok" | "invalid" | "unavailable";
};
type Result<T> =
  | { ok: true; value: T; attempts: Usage[] }
  | { ok: false; error: "invalid" | "unavailable"; attempts: Usage[] };
type Generate = (request: GenerateContentParameters) => Promise<GenerateContentResponse>;

function tokens(value?: number) {
  return Number.isSafeInteger(value) && value! > 0 && value! <= 10_000_000 ? value! : 0;
}

function estimate(model: AiModel, audio: boolean, input: number, output: number, inrPerUsd: number) {
  // Standard tier, https://ai.google.dev/gemini-api/docs/pricing (2026-11-04).
  // Ignore cache discounts; this is an estimate, not the provider bill.
  const newerRate = Date.now() >= Date.UTC(2027, 0, 1);
  const inputRate = model === "gemini-3.8-flash" ? (newerRate ? 1.5 : 0.75)
    : model === "gemini-2.5-flash" && audio && Date.now() < Date.UTC(2026, 11, 1) ? 1 : 0.3;
  const outputRate = model === "gemini-3.8-flash" ? (newerRate ? 7.5 : 3.75) : 2.5;
  return (input * inputRate + output * outputRate) / 1_000_000 * inrPerUsd;
}

/** This gateway has no DB client, tools, URL inputs or side effects beyond its model request. */
export async function extractWithGemini<T>(opts: {
  config: GeminiConfig;
  primary: AiModel;
  useFallback: boolean;
  instructions: string;
  context: unknown;
  media: readonly AiMedia[];
  responseSchema: Schema;
  validate: ZodType<T>;
}, generate?: Generate): Promise<Result<T>> {
  const { config } = opts;
  const client = generate ? null : new GoogleGenAI({ apiKey: config.apiKey, vertexai: false });
  const invoke: Generate = generate ?? ((request) => client!.models.generateContent(request));
  const models = opts.useFallback && opts.primary !== config.fallback ? [opts.primary, config.fallback] : [opts.primary];
  const attempts: Usage[] = [];
  const parts: Part[] = [{ text: JSON.stringify(opts.context) }, ...opts.media.map(({ mimeType, data }) => ({
    inlineData: { mimeType, data: Buffer.from(data).toString("base64") },
  }))];
  for (const model of models) {
    const audio = opts.media.some((m) => m.mimeType.startsWith("audio/"));
    let retryable = true;
    const usage: Usage = {
      model, modelVersion: null, input: 0, output: 0, thinking: 0, costInr: 0,
      usageReported: false, outcome: "unavailable",
    };
    attempts.push(usage);
    const attemptTimeout = models.length === 1 ? 37_000 : 18_000;
    try {
      const response = await invoke({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: opts.instructions,
          responseMimeType: "application/json",
          responseSchema: opts.responseSchema,
          candidateCount: 1,
          maxOutputTokens: 8192,
          thinkingConfig: model === "gemini-2.5-flash" && Date.now() < Date.UTC(2026, 11, 1)
            ? { thinkingBudget: config.thinkingBudget }
            : { thinkingLevel: model === "gemini-3.8-flash" || config.thinkingLevel === "low" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL },
          httpOptions: { timeout: attemptTimeout, retryOptions: { attempts: 1 } },
          abortSignal: AbortSignal.timeout(attemptTimeout),
        },
      });
      usage.modelVersion = response.modelVersion?.slice(0, 120) ?? null;
      usage.input = tokens(response.usageMetadata?.promptTokenCount);
      usage.output = tokens(response.usageMetadata?.candidatesTokenCount);
      usage.thinking = tokens(response.usageMetadata?.thoughtsTokenCount);
      usage.usageReported = typeof response.usageMetadata?.promptTokenCount === "number";
      usage.costInr = estimate(model, audio, usage.input, usage.output + usage.thinking, config.inrPerUsd);
      usage.outcome = "invalid";
      const finish = response.candidates?.[0]?.finishReason;
      if (response.promptFeedback?.blockReason || (finish && finish !== "STOP" && finish !== "MAX_TOKENS")) {
        return { ok: false, error: "invalid", attempts };
      }
      if (finish !== "MAX_TOKENS" && response.text) {
        const value = opts.validate.safeParse(JSON.parse(response.text));
        if (value.success) {
          usage.outcome = "ok";
          return { ok: true, value: value.data, attempts };
        }
      }
    } catch (error) {
      // No upstream error body, text, API key or prompt is written to logs.
      const status = (error as { status?: number } | null)?.status;
      retryable = !status || [404, 408, 429].includes(status) || status >= 500;
    }
    if (!retryable) break;
  }
  return { ok: false, error: attempts.at(-1)?.outcome === "invalid" ? "invalid" : "unavailable", attempts };
}
