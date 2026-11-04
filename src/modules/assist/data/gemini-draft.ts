import "server-only";

import type { Part } from "@google/genai";
import { z } from "zod";

import { paidGeminiConfig } from "@/lib/ai/config";
import { geminiClient, geminiRequest, geminiUsage } from "@/lib/ai/gemini";

import type { AssistImage } from "../domain/tasks";

/** Drafts can contain private material even after masking, so this accepts only the paid key. */
export async function geminiDraft(
  config: NonNullable<ReturnType<typeof paidGeminiConfig>>,
  instructions: string,
  text: string,
  image: AssistImage | null,
  output: z.ZodType,
  maxOutputTokens: number,
) {
  const timeout = 24_000;
  const parts: Part[] = [{ text }];
  if (image) parts.push({ inlineData: { mimeType: image.mediaType, data: image.data } });
  // Gemini supports a subset of JSON Schema; the task's Zod schema still validates the answer locally.
  const responseJsonSchema: Record<string, unknown> = { ...z.toJSONSchema(output) };
  delete responseJsonSchema.$schema;
  const response = await geminiClient(config.apiKey)(geminiRequest({
    config, model: config.model, instructions, parts, responseJsonSchema, maxOutputTokens,
    timeout, signal: AbortSignal.timeout(timeout),
  }));
  const usage = geminiUsage(response, config.model, false, config.inrPerUsd);
  const finish = response.candidates?.[0]?.finishReason;
  const refused = Boolean(response.promptFeedback?.blockReason || finish === "SAFETY" ||
    finish === "BLOCKLIST" || finish === "PROHIBITED_CONTENT" || finish === "SPII" || finish === "IMAGE_SAFETY");
  let candidate: unknown;
  if (!refused && (!finish || finish === "STOP")) {
    try { candidate = JSON.parse(response.text ?? ""); } catch { /* No usable draft. */ }
  }
  return { candidate, refused, input: usage.input, output: usage.output + usage.thinking, costUsd: usage.costInr / config.inrPerUsd };
}
