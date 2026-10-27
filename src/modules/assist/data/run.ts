import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { canAny } from "@/platform/auth/permissions";

import { costUsd } from "../domain/cost";
import {
  ASSIST_MODELS,
  FEATURE_PERMISSIONS,
  featureTier,
  type AssistOutcome,
} from "../domain/features";
import { hasStrayToken, maskPersonal, restoreDeep } from "../domain/redact";
import {
  ASSIST_TASKS,
  SHARED_RULES,
  type AssistTaskId,
  type TaskOutput,
  type TaskSpec,
} from "../domain/tasks";
import { budgetState, writeLog } from "./log";
import { getAssistSettings, isAssistConfigured } from "./settings";

let client: Anthropic | null = null;

/**
 * One client per server instance. A minute is long enough for the slowest
 * draft here (a photograph, or twelve remarks on Sonnet) and short enough
 * that a stuck request gives the person their screen back. One retry: the
 * SDK retries 429, 5xx and dropped connections, and a second wait on a busy
 * API is worse than "try again in a minute".
 */
function claude(): Anthropic {
  client ??= new Anthropic({ timeout: 60_000, maxRetries: 1 });
  return client;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/**
 * Run one task for one person: every check, the request, and the log.
 *
 * The order is the point. The cheap refusals (not configured, no permission,
 * switched off, over budget, over the daily cap, bad input) all come before
 * a token is spent. The request then carries only what the task builds from
 * its validated input, with personal details masked, and the answer is
 * parsed against the task's schema and cleaned against the input before the
 * screen sees it.
 */
export async function runAssistTask<K extends AssistTaskId>(
  staff: CurrentStaff,
  taskId: K,
  rawInput: unknown,
): Promise<AssistOutcome<TaskOutput<K>>> {
  const spec = ASSIST_TASKS[taskId] as unknown as TaskSpec<unknown, TaskOutput<K>>;
  const feature = spec.feature;

  if (!isAssistConfigured()) return { ok: false, problem: "off" };
  if (!canAny(staff, FEATURE_PERMISSIONS[feature])) return { ok: false, problem: "denied" };

  const settings = await getAssistSettings().catch(() => null);
  if (!settings?.enabled || settings.disabledFeatures.includes(feature)) return { ok: false, problem: "off" };

  const budget = await budgetState(staff.id).catch(() => null);
  // A budget that cannot be read is treated as spent: the cap is the only thing between a loop and the bill.
  if (!budget) return { ok: false, problem: "failed" };
  if (budget.spentUsd >= settings.monthlyBudgetUsd) return { ok: false, problem: "budget" };
  if (budget.staffToday >= settings.dailyCapPerStaff) return { ok: false, problem: "daily_cap" };

  const parsed = spec.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const input = parsed.data;

  const masked = maskPersonal(spec.prompt(input), spec.names?.(input) ?? []);
  const image = spec.image?.(input) ?? null;
  const model = ASSIST_MODELS[featureTier(feature)];
  const careful = featureTier(feature) === "careful";

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  content.push({ type: "text", text: masked.text });

  const log = (outcome: "drafted" | "refused" | "failed", usage?: Anthropic.Beta.BetaUsage | null) =>
    writeLog({
      staffProfileId: staff.id,
      feature,
      task: taskId,
      model,
      outcome,
      inputTokens: usage?.input_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      cacheReadTokens: usage?.cache_read_input_tokens ?? 0,
      costUsd: usage ? costUsd(model, usage) : 0,
    });

  let response;
  try {
    response = await claude().beta.messages.parse({
      model,
      max_tokens: spec.maxTokens,
      // Sonnet 5.5 on the Claude API: a policy decline in a category the
      // fallback covers is re-run server-side rather than returned empty.
      // Haiku 5.5 has no server-side fallback; a decline there is "refused".
      ...(careful ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: spec.effort, format: betaZodOutputFormat(spec.output) },
      system: [
        { type: "text", text: SHARED_RULES },
        { type: "text", text: spec.instructions },
      ],
      messages: [{ role: "user", content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError || error instanceof Anthropic.APIConnectionError) {
      await log("failed");
      return { ok: false, problem: "busy" };
    }
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      console.error("[assist] the Claude Console key was refused", error.status);
      return { ok: false, problem: "off" };
    }
    console.error("[assist] request failed", taskId, error instanceof Anthropic.APIError ? error.status : error);
    await log("failed");
    return { ok: false, problem: "failed" };
  }

  if (response.stop_reason === "refusal") {
    await log("refused", response.usage);
    return { ok: false, problem: "refused" };
  }
  if (!response.parsed_output || response.stop_reason === "max_tokens") {
    await log("failed", response.usage);
    return { ok: false, problem: "failed" };
  }

  const restored = restoreDeep(response.parsed_output, masked.restore);
  const finished = spec.finish ? spec.finish(restored, input) : restored;
  // A placeholder the model invented is never put in front of a parent.
  if (!finished || strings(finished).some(hasStrayToken)) {
    await log("failed", response.usage);
    return { ok: false, problem: "failed" };
  }

  const logId = await log("drafted", response.usage);
  return { ok: true, value: finished, logId };
}
