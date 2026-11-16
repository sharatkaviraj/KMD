import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { costUsd } from "@/modules/assist/domain/cost";
import { CLOSING_SYSTEM, closingUserText, closingVerdictSchema, type ClosingVerdict } from "@/modules/chats/domain/finish";
import { HELPER_MODELS } from "@/modules/whatsapp/domain/helper-ai";
import { hasClaudeKey } from "@/modules/whatsapp/data/helper-claude";

/**
 * Veer Patta AI's quick read of a parent's few words after the school's
 * answer (D-645): does the school still owe them anything? The same paid
 * Claude model that already reads parents' messages, never a free one. It
 * sees the school's last answer and the parent's message, nothing else.
 *
 * Six seconds at most, no retry: the chat waits for the school while it
 * reads (the first nudge is two minutes away), and anything but a clear
 * "not needed" leaves it waiting, as before.
 */

const TIMEOUT_MS = 6_000;

export type ClosingAsk = { verdict: ClosingVerdict | null; costUsd: number; problem: string | null };

export async function askClosingVerdict(input: { schoolAnswer: string | null; parentMessage: string }): Promise<ClosingAsk> {
  if (!hasClaudeKey()) return { verdict: null, costUsd: 0, problem: "no_key" };
  const model = HELPER_MODELS.quick;
  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
      baseURL: "https://api.anthropic.com",
      timeout: TIMEOUT_MS,
      maxRetries: 0,
      logLevel: "off",
    });
    const response = await client.beta.messages.parse(
      {
        model,
        max_tokens: 256,
        output_config: { effort: "low", format: betaZodOutputFormat(closingVerdictSchema) },
        system: [{ type: "text", text: CLOSING_SYSTEM }],
        messages: [{ role: "user", content: [{ type: "text", text: closingUserText(input) }] }],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const cost = response.usage ? costUsd(model, response.usage) : 0;
    if (response.stop_reason === "refusal") return { verdict: null, costUsd: cost, problem: "refused" };
    if (response.stop_reason !== "end_turn" || !response.parsed_output) return { verdict: null, costUsd: cost, problem: `stop_${response.stop_reason ?? "none"}` };
    return { verdict: response.parsed_output.reply, costUsd: cost, problem: null };
  } catch (caught) {
    const name = caught instanceof Error ? caught.name : "error";
    return { verdict: null, costUsd: 0, problem: name === "TimeoutError" || name === "AbortError" ? "timeout" : "call_failed" };
  }
}
