import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { paidGeminiConfig } from "@/lib/ai/config";
import { oneInstructions, type OneWorkflow } from "@/lib/ai/one-knowledge";
import { failureOf } from "@/lib/ai/router";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can, canAny } from "@/platform/auth/permissions";
import { groupsFor } from "@/vx/nav";

import { costUsd } from "../domain/cost";
import {
  ASSIST_MODELS,
  dailyCapFor,
  FEATURE_PERMISSIONS,
  featureTier,
  type AssistOutcome,
  type AssistProblem,
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
import { geminiDraft } from "./gemini-draft";
import { getAssistSettings, isAssistConfigured } from "./settings";

const GROUNDED_WORKFLOWS = new Set<OneWorkflow>(["brief", "cover", "form", "note", "calls", "message"]);

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
  if (budget.staffToday >= dailyCapFor(settings.dailyCapPerStaff, staff)) return { ok: false, problem: "daily_cap" };

  const parsed = spec.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  let input = parsed.data;
  let permittedHrefs: string[] | undefined;
  if (taskId === "ask.answer") {
    try {
      const { getViewer, previewPermissions, PREVIEW_ROLE } = await import("@/vx/view-as");
      const viewer = await getViewer();
      if (viewer.staff.id !== staff.id) return { ok: false, problem: "denied" };
      const preview = viewer.previewing ? await previewPermissions(viewer.previewing) : null;
      const pages = groupsFor(viewer.menu, (permission) => can(staff, permission) && (!preview || preview.has(permission)))
        .flatMap((group) => group.items.map(({ href, label }) => ({ href, label: [label.en, label.hi].filter(Boolean).join(" / ").slice(0, 80) })));
      permittedHrefs = pages.map(({ href }) => href);
      // The browser can supply a question, but it cannot decide which pages or role the assistant sees.
      input = { ...ASSIST_TASKS["ask.answer"].input.parse(input), role: viewer.previewing ? PREVIEW_ROLE[viewer.previewing] : staff.role, pages };
    } catch {
      return { ok: false, problem: "failed" };
    }
  }

  const masked = maskPersonal(spec.prompt(input), spec.names?.(input) ?? []);
  const image = spec.image?.(input) ?? null;
  const claudeModel = ASSIST_MODELS[featureTier(feature)];
  const careful = featureTier(feature) === "careful";
  const workflow = feature as OneWorkflow;
  const instructions = oneInstructions(
    `${SHARED_RULES}\n\n${spec.instructions}`,
    GROUNDED_WORKFLOWS.has(workflow) ? workflow : undefined,
    permittedHrefs,
  );

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  content.push({ type: "text", text: masked.text });

  let model = claudeModel;
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, spend = 0;
  const log = (outcome: "drafted" | "refused" | "failed") =>
    writeLog({
      staffProfileId: staff.id,
      feature,
      task: taskId,
      model,
      outcome,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      costUsd: spend,
    });

  const finish = (candidate: unknown) => {
    const output = spec.output.safeParse(candidate);
    if (!output.success) return null;
    const restored = restoreDeep(output.data, masked.restore);
    const finished = spec.finish ? spec.finish(restored, input) : restored;
    return finished && !strings(finished).some(hasStrayToken) ? finished : null;
  };
  const reject = async (problem: AssistProblem) => {
    await log(problem === "refused" ? "refused" : "failed");
    return { ok: false as const, problem };
  };

  let primaryProblem: AssistProblem = "failed";
  const claudeKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (claudeKey) try {
    const client = new Anthropic({ apiKey: claudeKey, baseURL: "https://api.anthropic.com", timeout: 25_000, maxRetries: 0, logLevel: "off" });
    const response = await client.beta.messages.parse({
      model: claudeModel,
      max_tokens: spec.maxTokens,
      // Sonnet 5.5 on the Claude API: a policy decline in a category the
      // fallback covers is re-run server-side rather than returned empty.
      // Haiku 5.5 has no server-side fallback; a decline there is "refused".
      ...(careful ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      output_config: { effort: spec.effort, format: betaZodOutputFormat(spec.output) },
      system: instructions,
      messages: [{ role: "user", content }],
    }, { signal: AbortSignal.timeout(25_000) });
    if (response.usage) {
      inputTokens += response.usage.input_tokens;
      outputTokens += response.usage.output_tokens;
      cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
      spend += costUsd(claudeModel, response.usage);
    }
    if (response.stop_reason === "refusal") return reject("refused");
    const finished = response.stop_reason === "end_turn" ? finish(response.parsed_output) : null;
    if (finished) return { ok: true, value: finished, logId: await log("drafted") };
  } catch (error) {
    const { problem } = failureOf(error);
    primaryProblem = error instanceof Anthropic.APIConnectionError || ["quota", "quota_daily", "server", "network", "timeout"].includes(problem)
      ? "busy" : ["credential", "permission", "billing"].includes(problem) ? "off" : "failed";
  }

  // Charge all reported usage to this one draft, and do not start another paid call once at the cap.
  if (budget.spentUsd + spend >= settings.monthlyBudgetUsd) return reject("budget");
  try {
    const fallback = paidGeminiConfig();
    if (!fallback) return reject(primaryProblem);
    model = fallback.model;
    const reply = await geminiDraft(fallback, instructions, masked.text, image, spec.output, spec.maxTokens);
    inputTokens += reply.input;
    outputTokens += reply.output;
    spend += reply.costUsd;
    if (reply.refused) return reject("refused");
    const finished = finish(reply.candidate);
    if (finished) return { ok: true, value: finished, logId: await log("drafted") };
  } catch (error) {
    const { problem } = failureOf(error);
    if (["quota", "quota_daily", "server", "network", "timeout"].includes(problem)) return reject("busy");
  }
  return reject("failed");
}
