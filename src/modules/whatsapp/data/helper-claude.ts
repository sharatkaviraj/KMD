import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { costUsd } from "@/modules/assist/domain/cost";
import {
  HELPER_MODELS,
  helperAnswerSchema,
  helperSystemPrompt,
  helperUserText,
  type HelperAnswer,
  type HelperModel,
} from "@/modules/whatsapp/domain/helper-ai";
import type { SchoolKnowledge } from "@/modules/whatsapp/domain/helper-lessons";
import type { Family } from "@/modules/whatsapp/domain/helper-replies";
import type { HelperLanguage } from "@/modules/whatsapp/domain/helper-text";

/**
 * The Claude call behind Veer Patta AI (D-574). Anthropic only: the free
 * models One uses elsewhere never see a child's record. Haiku answers first;
 * when it marks the message as needing care, Opus answers instead, and if
 * Opus cannot, Haiku's answer stands.
 */

const TIMEOUT_MS = { quick: 12_000, careful: 20_000 } as const;
const MAX_TOKENS = { quick: 900, careful: 1_400 } as const;

export type ClaudeTurn = {
  answer: HelperAnswer | null;
  /** The model whose answer is used, or the last one tried. */
  model: HelperModel | null;
  careful: boolean;
  costUsd: number;
  problem: string | null;
};

type Stage = { answer: HelperAnswer | null; costUsd: number; problem: string | null };

async function ask(model: HelperModel, system: string, user: string, careful: boolean): Promise<Stage> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const timeoutMs = careful ? TIMEOUT_MS.careful : TIMEOUT_MS.quick;
  try {
    const client = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", timeout: timeoutMs, maxRetries: 0, logLevel: "off" });
    const response = await client.beta.messages.parse(
      {
        model,
        max_tokens: careful ? MAX_TOKENS.careful : MAX_TOKENS.quick,
        // Opus keeps Anthropic's server-side fallback for a false-positive decline, as One's AI helper does.
        ...(careful ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
        output_config: { effort: careful ? "medium" : "low", format: betaZodOutputFormat(helperAnswerSchema) },
        system,
        messages: [{ role: "user", content: [{ type: "text", text: user }] }],
      },
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    const cost = response.usage ? costUsd(model, response.usage) : 0;
    if (response.stop_reason === "refusal") return { answer: null, costUsd: cost, problem: "refused" };
    if (response.stop_reason !== "end_turn" || !response.parsed_output) return { answer: null, costUsd: cost, problem: `stop_${response.stop_reason ?? "none"}` };
    return { answer: response.parsed_output, costUsd: cost, problem: null };
  } catch (caught) {
    const name = caught instanceof Error ? caught.name : "error";
    return { answer: null, costUsd: 0, problem: name === "TimeoutError" || name === "AbortError" ? "timeout" : "call_failed" };
  }
}

export function hasClaudeKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export async function askHelperClaude(input: {
  helperName: string;
  family: Family;
  text: string;
  language: HelperLanguage;
  firstContact: boolean;
  now: Date;
  /** The school's answers and the questions it leaves to people (D-589). */
  knowledge?: SchoolKnowledge;
}): Promise<ClaudeTurn> {
  if (!hasClaudeKey()) return { answer: null, model: null, careful: false, costUsd: 0, problem: "no_key" };
  const system = helperSystemPrompt(input.helperName);
  const user = helperUserText(input);

  const quick = await ask(HELPER_MODELS.quick, system, user, false);
  if (quick.answer && !quick.answer.needs_care) {
    return { answer: quick.answer, model: HELPER_MODELS.quick, careful: false, costUsd: quick.costUsd, problem: null };
  }

  const careful = await ask(HELPER_MODELS.careful, system, user, true);
  const spent = quick.costUsd + careful.costUsd;
  if (careful.answer) return { answer: careful.answer, model: HELPER_MODELS.careful, careful: true, costUsd: spent, problem: null };
  if (quick.answer) return { answer: quick.answer, model: HELPER_MODELS.quick, careful: false, costUsd: spent, problem: careful.problem };
  return { answer: null, model: HELPER_MODELS.careful, careful: true, costUsd: spent, problem: careful.problem ?? quick.problem };
}
