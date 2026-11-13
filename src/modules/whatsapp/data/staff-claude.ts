import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { costUsd } from "@/modules/assist/domain/cost";
import { HELPER_MODELS } from "@/modules/whatsapp/domain/helper-ai";
import {
  readUnderstanding,
  staffUnderstandingSchema,
  staffUnderstandSystemPrompt,
  staffUnderstandUserText,
  type Understood,
} from "@/modules/whatsapp/domain/staff-understand";
import type { StaffCommand } from "@/modules/whatsapp/domain/staff-words";
import type { StaffRole } from "@/platform/auth/permissions";

/**
 * Which of a desk's asks a member of staff's typed words are (D-607): one
 * small call to Haiku, the helper's quick model, with nothing but the words
 * and the names of the asks. Anthropic only, as for the parents' helper.
 * Null `understood` when it could not say; the keywords answer then.
 */

const TIMEOUT_MS = 8_000;
const MAX_TOKENS = 200;

export type StaffClaudeTurn = { understood: Understood | null; model: string; costUsd: number; problem: string | null };

export async function askStaffClaude(input: {
  helperName: string;
  role: StaffRole;
  commands: readonly StaffCommand[];
  owner: boolean;
  text: string;
}): Promise<StaffClaudeTurn> {
  const model = HELPER_MODELS.quick;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) return { understood: null, model, costUsd: 0, problem: "no_key" };
  try {
    const client = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", timeout: TIMEOUT_MS, maxRetries: 0, logLevel: "off" });
    const response = await client.beta.messages.parse(
      {
        model,
        max_tokens: MAX_TOKENS,
        output_config: { effort: "low", format: betaZodOutputFormat(staffUnderstandingSchema) },
        // The same instructions for every member of staff: read from Anthropic's cache after the first.
        system: [{ type: "text", text: staffUnderstandSystemPrompt(input.helperName), cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: [{ type: "text", text: staffUnderstandUserText(input) }] }],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    const cost = response.usage ? costUsd(model, response.usage) : 0;
    if (response.stop_reason === "refusal") return { understood: null, model, costUsd: cost, problem: "refused" };
    if (response.stop_reason !== "end_turn" || !response.parsed_output) {
      return { understood: null, model, costUsd: cost, problem: `stop_${response.stop_reason ?? "none"}` };
    }
    return { understood: readUnderstanding(response.parsed_output, input.text), model, costUsd: cost, problem: null };
  } catch (caught) {
    const name = caught instanceof Error ? caught.name : "error";
    return { understood: null, model, costUsd: 0, problem: name === "TimeoutError" || name === "AbortError" ? "timeout" : "call_failed" };
  }
}
