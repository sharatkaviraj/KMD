import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { freeGeminiConfig, nvidiaConfig, openAiKey, openRouterConfig, paidGeminiConfig } from "@/lib/ai/config";
import { oneInstructions, type OneWorkflow } from "@/lib/ai/one-knowledge";
import { freeKeyBlocked, saveStatuses, statusRow } from "@/lib/ai/provider-status";
import { failureOf, type FailureProblem } from "@/lib/ai/router";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can, canAny } from "@/platform/auth/permissions";
import { groupsFor } from "@/vx/nav";

import { costUsd } from "../domain/cost";
import { dailyCapFor, FEATURE_PERMISSIONS, type AssistOutcome, type AssistProblem } from "../domain/features";
import { hasStrayToken, maskPersonal, restoreDeep } from "../domain/redact";
import { assistChain, CHAIN_DEADLINE_MS, FREE_PROVIDERS, type AssistStage, type AvailableKeys } from "../domain/routes";
import {
  ASSIST_TASKS,
  SHARED_RULES,
  type AssistImage,
  type AssistTaskId,
  type TaskOutput,
  type TaskSpec,
} from "../domain/tasks";
import { chatDraft } from "./chat-draft";
import { geminiDraft } from "./gemini-draft";
import { budgetState, writeLog } from "./log";
import { openaiDraft, type StageReply } from "./openai-draft";
import { getAssistSettings, isAssistConfigured, type AssistSettings } from "./settings";

const GROUNDED_WORKFLOWS = new Set<OneWorkflow>(["brief", "cover", "form", "note", "calls", "message"]);

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Which keys this deployment has. Values are read here and handed only to the provider they belong to. */
export function availableKeys(env: Readonly<Record<string, string | undefined>> = process.env): AvailableKeys {
  return {
    anthropic: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    openai: Boolean(openAiKey(env)),
    geminiPaidModel: paidGeminiConfig(env)?.model ?? null,
    geminiFreeModel: freeGeminiConfig(env)?.model ?? null,
    nvidiaModel: nvidiaConfig(env)?.model ?? null,
    openRouterModel: openRouterConfig(env)?.models[0] ?? null,
  };
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

  return draftThroughChain(staff.id, taskId, spec, input, settings, budget.spentUsd, permittedHrefs);
}

/**
 * A draft the app prepares for someone before they ask (D-418): a cover plan
 * for a duty, a class's week of notes. The caller has already decided who it
 * is for and that they may see it; this keeps the admin's switches and the
 * month's budget, but not the person's daily cap — they did not press a button.
 */
export async function prepareAssistDraft<K extends AssistTaskId>(
  staffProfileId: string,
  taskId: K,
  rawInput: unknown,
): Promise<AssistOutcome<TaskOutput<K>>> {
  const spec = ASSIST_TASKS[taskId] as unknown as TaskSpec<unknown, TaskOutput<K>>;
  if (!isAssistConfigured()) return { ok: false, problem: "off" };
  const settings = await getAssistSettings().catch(() => null);
  if (!settings?.enabled || settings.disabledFeatures.includes(spec.feature)) return { ok: false, problem: "off" };
  const budget = await budgetState(staffProfileId).catch(() => null);
  if (!budget) return { ok: false, problem: "failed" };
  if (budget.spentUsd >= settings.monthlyBudgetUsd) return { ok: false, problem: "budget" };
  const parsed = spec.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  return draftThroughChain(staffProfileId, taskId, spec, parsed.data, settings, budget.spentUsd);
}

type Ask = {
  instructions: string;
  text: string;
  image: AssistImage | null;
  spec: TaskSpec<unknown, unknown>;
};

/** Claude, with structured outputs; Sonnet and Opus keep Anthropic's server-side fallback for a false-positive decline. */
async function claudeStage(stage: AssistStage, ask: Ask, timeoutMs: number): Promise<StageReply> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (ask.image) content.push({ type: "image", source: { type: "base64", media_type: ask.image.mediaType, data: ask.image.data } });
  content.push({ type: "text", text: ask.text });
  const client = new Anthropic({ apiKey, baseURL: "https://api.anthropic.com", timeout: timeoutMs, maxRetries: 0, logLevel: "off" });
  const fallback = stage.model.startsWith("claude-sonnet") || stage.model.startsWith("claude-opus");
  const response = await client.beta.messages.parse({
    model: stage.model,
    max_tokens: ask.spec.maxTokens,
    ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    // Opus 5.5 defaults to "medium" and Haiku 5.5 too; the task sets it every time.
    output_config: { effort: ask.spec.effort, format: betaZodOutputFormat(ask.spec.output) },
    system: ask.instructions,
    messages: [{ role: "user", content }],
  }, { signal: AbortSignal.timeout(timeoutMs) });
  const usage = response.usage;
  return {
    candidate: response.stop_reason === "end_turn" ? response.parsed_output : undefined,
    refused: response.stop_reason === "refusal",
    input: usage?.input_tokens ?? 0,
    output: usage?.output_tokens ?? 0,
    cacheRead: usage?.cache_read_input_tokens ?? 0,
    costUsd: usage ? costUsd(stage.model, usage) : 0,
  };
}

async function runStage(stage: AssistStage, ask: Ask, timeoutMs: number): Promise<StageReply & { model?: string }> {
  switch (stage.provider) {
    case "nvidia-free": {
      const config = nvidiaConfig();
      if (!config) throw Object.assign(new Error("NVIDIA key missing"), { status: 401 });
      return chatDraft({
        url: "https://integrate.api.nvidia.com/v1/chat/completions", apiKey: config.apiKey, model: config.model,
        instructions: ask.instructions, text: ask.text, output: ask.spec.output, maxTokens: ask.spec.maxTokens, timeoutMs,
      });
    }
    case "openrouter-free": {
      const config = openRouterConfig();
      if (!config) throw Object.assign(new Error("OpenRouter key missing"), { status: 401 });
      return chatDraft({
        url: "https://openrouter.ai/api/v1/chat/completions", apiKey: config.apiKey, model: config.models[0], models: config.models,
        instructions: ask.instructions, text: ask.text, output: ask.spec.output, maxTokens: ask.spec.maxTokens, timeoutMs,
        jsonMode: true, headers: { "X-Title": "VPPS One" },
        // Never a paid model: OpenRouter refuses any route that would charge (owner, 7 Nov 2026).
        extra: { provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } } },
      });
    }
    case "anthropic":
      return claudeStage(stage, ask, timeoutMs);
    case "openai":
      return openaiDraft({
        apiKey: openAiKey() ?? "", model: stage.model, instructions: ask.instructions, text: ask.text,
        image: ask.image, output: ask.spec.output, maxTokens: ask.spec.maxTokens, timeoutMs,
      });
    case "gemini-paid":
    case "gemini-free": {
      const free = stage.provider === "gemini-free";
      const config = free ? freeGeminiConfig() : paidGeminiConfig();
      if (!config) throw Object.assign(new Error("Gemini key missing"), { status: 401 });
      return geminiDraft(config, ask.instructions, ask.text, ask.image, ask.spec.output, ask.spec.maxTokens, { timeoutMs, free });
    }
  }
}

const BUSY: readonly FailureProblem[] = ["quota", "quota_daily", "server", "network", "timeout"];

/**
 * Walk the task's chain (`routes.ts`) until one model gives a draft that passes
 * the task's schema, `finish()` and the placeholder check. One log row per
 * draft, naming the model that wrote it and carrying every stage's tokens and
 * cost, so the budget counts what was really spent.
 */
async function draftThroughChain<K extends AssistTaskId>(
  staffProfileId: string,
  taskId: K,
  spec: TaskSpec<unknown, TaskOutput<K>>,
  input: unknown,
  settings: AssistSettings,
  spentUsd: number,
  permittedHrefs?: string[],
): Promise<AssistOutcome<TaskOutput<K>>> {
  const feature = spec.feature;
  const masked = maskPersonal(spec.prompt(input), spec.names?.(input) ?? []);
  const workflow = feature as OneWorkflow;
  const ask: Ask = {
    instructions: oneInstructions(`${SHARED_RULES}\n\n${spec.instructions}`, GROUNDED_WORKFLOWS.has(workflow) ? workflow : undefined, permittedHrefs),
    text: masked.text,
    image: spec.image?.(input) ?? null,
    spec: spec as TaskSpec<unknown, unknown>,
  };
  const stages = assistChain(taskId, availableKeys(), process.env);

  let model = stages[0]?.model ?? "none";
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, spend = 0;
  const log = (outcome: "drafted" | "refused" | "failed") =>
    writeLog({ staffProfileId, feature, task: taskId, model, outcome, inputTokens, outputTokens, cacheReadTokens, costUsd: Math.round(spend * 1_000_000) / 1_000_000 });

  const finish = (candidate: unknown) => {
    const output = spec.output.safeParse(candidate);
    if (!output.success) return null;
    const restored = restoreDeep(output.data, masked.restore);
    const finished = spec.finish ? spec.finish(restored, input) : restored;
    return finished && !strings(finished).some(hasStrayToken) ? finished : null;
  };
  const reject = async (problem: AssistProblem) => {
    if (stages.length) await log(problem === "refused" ? "refused" : "failed");
    return { ok: false as const, problem };
  };

  if (!stages.length) return { ok: false, problem: "off" };
  const started = Date.now();
  let busy = false;
  for (const stage of stages) {
    const left = CHAIN_DEADLINE_MS - (Date.now() - started);
    if (left < 6_000) break;
    const free = stage.provider === "gemini-free";
    // Charge everything already spent to this draft, and start no further paid call once at the cap.
    if (!FREE_PROVIDERS.has(stage.provider) && spentUsd + spend >= settings.monthlyBudgetUsd) return reject("budget");
    if (free && (await freeKeyBlocked())) continue;
    try {
      const reply = await runStage(stage, ask, Math.min(stage.timeoutMs, left - 2_000));
      // OpenRouter names the free model that actually answered; the log keeps it.
      model = reply.model ?? stage.model;
      inputTokens += reply.input;
      outputTokens += reply.output;
      cacheReadTokens += reply.cacheRead;
      spend += reply.costUsd;
      if (free) void saveStatuses([statusRow("gemini-free", { outcome: "ok", model: stage.model }, new Date())]);
      if (reply.refused) return reject("refused");
      const finished = finish(reply.candidate);
      if (finished) return { ok: true, value: finished, logId: await log("drafted") };
      // An answer that does not fit the task: the next model may do better.
    } catch (error) {
      const failure = failureOf(error);
      if (BUSY.includes(failure.problem) || error instanceof Anthropic.APIConnectionError) busy = true;
      if (free) void saveStatuses([statusRow("gemini-free", { outcome: "unavailable", model: stage.model, ...failure }, new Date())]);
    }
  }
  return reject(busy ? "busy" : "failed");
}
