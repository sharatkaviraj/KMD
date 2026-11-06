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

export type AiMedia = {
  mimeType: "image/jpeg" | "audio/webm" | "audio/aac" | "audio/wav" | "audio/mp4" | "audio/m4a" | "text/plain";
  data: Uint8Array;
};

export type ModelUsage = {
  modelVersion: string | null;
  input: number;
  output: number;
  thinking: number;
  costInr: number;
  usageReported: boolean;
};
type Usage = ModelUsage & { model: AiModel; outcome: "ok" | "invalid" | "unavailable" };
type Result<T> =
  | { ok: true; value: T; attempts: Usage[] }
  | { ok: false; error: "invalid" | "unavailable"; attempts: Usage[] };
export type Generate = (request: GenerateContentParameters) => Promise<GenerateContentResponse>;

export function validTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000;
}

export function tokens(value: unknown) {
  return validTokenCount(value) ? value : 0;
}

export function modelVersion(value: unknown) {
  return typeof value === "string" && /^[a-z0-9._:/-]{1,120}$/i.test(value) ? value : null;
}

/** USD per 1M tokens on the paid tier, https://aistudio.google.com/docs/pricing (4 Nov 2026). */
function rates(model: AiModel, audio: boolean, now: number) {
  const flash2027 = now >= Date.UTC(2027, 0, 1);
  switch (model) {
    case "gemini-3.8-flash":
    case "gemini-3.6-flash": return { input: flash2027 ? 1.5 : 0.75, output: flash2027 ? 7.5 : 3.75 };
    case "gemini-3.1-flash-lite": return { input: audio ? 0.5 : 0.25, output: 1.5 };
    // 2.5 Flash is billed as 3.5 Flash-Lite once Google reroutes it on 1 Dec 2026.
    case "gemini-2.5-flash": return now < Date.UTC(2026, 11, 1) ? { input: audio ? 1 : 0.3, output: 2.5 } : { input: 0.3, output: 2.5 };
    default: return { input: 0.3, output: 2.5 };
  }
}

function estimate(model: AiModel, audio: boolean, input: number, output: number, inrPerUsd: number) {
  // Ignore cache discounts; this is an estimate, not the provider bill. The free key's attempts are set to ₹0 by the caller.
  const rate = rates(model, audio, Date.now());
  return (input * rate.input + output * rate.output) / 1_000_000 * inrPerUsd;
}

export function geminiClient(apiKey: string): Generate {
  const client = new GoogleGenAI({
    apiKey, vertexai: false, httpOptions: { baseUrl: "https://generativelanguage.googleapis.com" },
  });
  return (request) => client.models.generateContent(request);
}

export function geminiParts(context: unknown, media: readonly AiMedia[]): Part[] {
  return [{ text: JSON.stringify(context ?? null) }, ...media.map(({ mimeType, data }) => mimeType === "text/plain" ? {
    // A typed Bolo request: the words are the transcript, not audio to listen to.
    text: `The member of staff typed this request instead of speaking. Copy it verbatim into \`transcript\`.\n${Buffer.from(data).toString("utf8")}`,
  } : ({
    inlineData: {
      // Safari records AAC in an audio-only MP4 container. Gemini names that format M4A.
      mimeType: mimeType === "audio/mp4" ? "audio/m4a" : mimeType,
      data: Buffer.from(data).toString("base64"),
    },
  }))];
}

function geminiJsonSchema(schema: Schema): Record<string, unknown> {
  const type = schema.type?.toLowerCase();
  return {
    type: type && schema.nullable ? [type, "null"] : type,
    required: schema.required,
    enum: schema.enum,
    minimum: schema.minimum,
    maximum: schema.maximum,
    items: schema.items && geminiJsonSchema(schema.items),
    properties: schema.properties && Object.fromEntries(
      Object.entries(schema.properties).map(([key, property]) => [key, geminiJsonSchema(property)]),
    ),
    // Keep row-count limits in Zod. The provider schema stays small for generation.
  };
}

export function geminiRequest(opts: {
  config: Pick<GeminiConfig, "thinkingBudget" | "thinkingLevel">;
  model: AiModel;
  instructions: string;
  parts: Part[];
  responseSchema?: Schema;
  responseJsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  timeout: number;
  signal: AbortSignal;
}): GenerateContentParameters {
  const { config, model, instructions, parts, responseSchema, timeout, signal } = opts;
  return {
    model,
    contents: [{ role: "user", parts }],
    config: {
      systemInstruction: instructions,
      responseMimeType: "application/json",
      responseJsonSchema: opts.responseJsonSchema ?? (responseSchema && geminiJsonSchema(responseSchema)),
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
      thinkingConfig: model === "gemini-2.5-flash" && Date.now() < Date.UTC(2026, 11, 1)
        ? { thinkingBudget: config.thinkingBudget }
        // Gemini 3 Flash models take "low" as their lightest level; Flash-Lite accepts "minimal".
        : { thinkingLevel: model === "gemini-3.8-flash" || model === "gemini-3.6-flash" || config.thinkingLevel === "low" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL },
      httpOptions: { timeout, retryOptions: { attempts: 1 } },
      abortSignal: signal,
    },
  };
}

export function geminiUsage(
  response: GenerateContentResponse, model: AiModel, audio: boolean, inrPerUsd: number,
): ModelUsage {
  const usage = response.usageMetadata;
  const input = tokens(usage?.promptTokenCount);
  const output = tokens(usage?.candidatesTokenCount);
  const thinking = tokens(usage?.thoughtsTokenCount);
  return {
    modelVersion: modelVersion(response.modelVersion),
    input, output, thinking,
    costInr: estimate(model, audio, input, output + thinking, inrPerUsd),
    usageReported: validTokenCount(usage?.promptTokenCount),
  };
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
  const invoke = generate ?? geminiClient(config.apiKey);
  const models = opts.useFallback && opts.primary !== config.fallback ? [opts.primary, config.fallback] : [opts.primary];
  const attempts: Usage[] = [];
  const parts = geminiParts(opts.context, opts.media);
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
      const response = await invoke(geminiRequest({
        config, model, instructions: opts.instructions, parts, responseSchema: opts.responseSchema,
        timeout: attemptTimeout, signal: AbortSignal.timeout(attemptTimeout),
      }));
      Object.assign(usage, geminiUsage(response, model, audio, config.inrPerUsd));
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
