import "server-only";

import type { Part } from "@google/genai";
import { z } from "zod";

import { aiModel, type GeminiConfig } from "@/lib/ai/config";
import { geminiClient, geminiRequest, geminiUsage } from "@/lib/ai/gemini";

import type { AssistImage } from "../domain/tasks";
import type { StageReply } from "./openai-draft";

/** A Gemini key and the model it answers on, with the shared thinking settings. */
export type GeminiDraftConfig = Pick<GeminiConfig, "thinkingBudget" | "thinkingLevel" | "inrPerUsd"> & { apiKey: string; model: string };

/**
 * One draft from Gemini. The paid key may receive any task; the free key is
 * handed only open tasks (`routes.ts`, D-417), and its answers cost nothing.
 */
export async function geminiDraft(
  config: GeminiDraftConfig,
  instructions: string,
  text: string,
  image: AssistImage | null,
  output: z.ZodType,
  maxOutputTokens: number,
  opts: { timeoutMs?: number; free?: boolean } = {},
): Promise<StageReply> {
  const timeout = opts.timeoutMs ?? 24_000;
  const model = aiModel(config.model);
  const parts: Part[] = [{ text }];
  if (image) parts.push({ inlineData: { mimeType: image.mediaType, data: image.data } });
  // Gemini supports a subset of JSON Schema; the task's Zod schema still validates the answer locally.
  const responseJsonSchema: Record<string, unknown> = { ...z.toJSONSchema(output) };
  delete responseJsonSchema.$schema;
  const response = await geminiClient(config.apiKey)(geminiRequest({
    config, model, instructions, parts, responseJsonSchema, maxOutputTokens,
    timeout, signal: AbortSignal.timeout(timeout),
  }));
  const usage = geminiUsage(response, model, false, config.inrPerUsd);
  const finish = response.candidates?.[0]?.finishReason;
  const refused = Boolean(response.promptFeedback?.blockReason || finish === "SAFETY" ||
    finish === "BLOCKLIST" || finish === "PROHIBITED_CONTENT" || finish === "SPII" || finish === "IMAGE_SAFETY");
  let candidate: unknown;
  if (!refused && (!finish || finish === "STOP")) {
    try { candidate = JSON.parse(response.text ?? ""); } catch { /* No usable draft. */ }
  }
  return {
    candidate,
    refused,
    input: usage.input,
    output: usage.output + usage.thinking,
    cacheRead: 0,
    costUsd: opts.free ? 0 : usage.costInr / config.inrPerUsd,
  };
}
