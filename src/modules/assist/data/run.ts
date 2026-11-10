import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";

import { APINEX_CHAT_URL, apinexConfig, freeGeminiConfig, nvidiaConfig, nvidiaGuidedJson, openAiKey, openRouterConfig, paidGeminiConfig } from "@/lib/ai/config";
import { oneInstructions, type OneWorkflow } from "@/lib/ai/one-knowledge";
import { freeKeyBlocked, saveStatuses, statusRow } from "@/lib/ai/provider-status";
import { failureOf, type FailureProblem } from "@/lib/ai/router";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { can, canAny } from "@/platform/auth/permissions";
import { groupsFor } from "@/vx/nav";

import { costUsd } from "../domain/cost";
import { dailyCapFor, FEATURE_PERMISSIONS, type AssistOutcome, type AssistProblem } from "../domain/features";
import { readsAsHindi } from "../domain/hindi-check";
import { hasStrayToken, maskPersonal, restoreDeep } from "../domain/redact";
import {
  APINEX_MODELS,
  assistChain,
  CHAIN_DEADLINE_MS,
  FREE_PROVIDERS,
  FREE_SHARE_MS,
  hasFreeStage,
  MIN_FREE_STAGE_MS,
  restAfter,
  restsWholeProvider,
  TASK_TIER,
  type AssistStage,
  type AvailableKeys,
  type FreeJob,
} from "../domain/routes";
import {
  ASSIST_TASKS,
  SHARED_RULES,
  type AssistImage,
  type AssistTaskId,
  type TaskOutput,
  type TaskSpec,
} from "../domain/tasks";
import { chatDraft } from "./chat-draft";
import { isResting, rest } from "./free-rest";
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
    apinexModels: apinexModels(env),
  };
}

/** APInex's free models per kind of work: the deployment's overrides, else One's picks (D-567). Null without the key. */
export function apinexModels(env: Readonly<Record<string, string | undefined>> = process.env): Record<FreeJob, readonly string[]> | null {
  const config = apinexConfig(env);
  if (!config) return null;
  return {
    quick: config.overrides.quick ?? APINEX_MODELS.quick,
    writing: config.overrides.writing ?? APINEX_MODELS.writing,
    careful: config.overrides.careful ?? APINEX_MODELS.careful,
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
 *
 * A test account's drafts are TEST material: its children are the masked
 * replica's invented people, so every text task may start on the free models
 * (D-401, D-496). Once the month's budget is spent, a task that has a free
 * stage still runs, on the free models only.
 */
export async function runAssistTask<K extends AssistTaskId>(
  staff: CurrentStaff,
  taskId: K,
  rawInput: unknown,
): Promise<AssistOutcome<TaskOutput<K>>> {
  const spec = ASSIST_TASKS[taskId] as unknown as TaskSpec<unknown, TaskOutput<K>>;
  const feature = spec.feature;

  if (!isAssistConfigured()) return { ok: false, problem: "off" };
  // Never on somebody else's behalf: while an administrator sees One as a
  // chosen person (D-544) the helper would spend, log and draft as them.
  if (staff.viewedBy) return { ok: false, problem: "denied" };
  if (!canAny(staff, FEATURE_PERMISSIONS[feature])) return { ok: false, problem: "denied" };

  const settings = await getAssistSettings().catch(() => null);
  if (!settings?.enabled || settings.disabledFeatures.includes(feature)) return { ok: false, problem: "off" };

  const testMaterial = staff.isTestAccount === true;
  const budget = await budgetState(staff.id).catch(() => null);
  // A budget that cannot be read is treated as spent: the cap is the only thing between a loop and the bill.
  if (!budget) return { ok: false, problem: "failed" };
  // Spent: only a task with a free stage goes on, and `draftThroughChain` starts no paid one.
  if (budget.spentUsd >= settings.monthlyBudgetUsd && !hasFreeStage(taskId, availableKeys(), process.env, { testMaterial, freeCheck: settings.freeCheck })) {
    return { ok: false, problem: "budget" };
  }
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

  return draftThroughChain(staff.id, taskId, spec, input, settings, budget.spentUsd, { permittedHrefs, testMaterial });
}

/**
 * A draft the app prepares for someone before they ask (D-418): a cover plan
 * for a duty, a class's week of notes. The caller has already decided who it
 * is for and that they may see it; this keeps the admin's switches and the
 * month's budget, but not the person's daily cap — they did not press a button.
 * `testMaterial` is the caller's word that the draft is about a TEST session.
 */
export async function prepareAssistDraft<K extends AssistTaskId>(
  staffProfileId: string,
  taskId: K,
  rawInput: unknown,
  options: { testMaterial?: boolean } = {},
): Promise<AssistOutcome<TaskOutput<K>>> {
  const spec = ASSIST_TASKS[taskId] as unknown as TaskSpec<unknown, TaskOutput<K>>;
  const testMaterial = options.testMaterial === true;
  if (!isAssistConfigured()) return { ok: false, problem: "off" };
  const settings = await getAssistSettings().catch(() => null);
  if (!settings?.enabled || settings.disabledFeatures.includes(spec.feature)) return { ok: false, problem: "off" };
  const budget = await budgetState(staffProfileId).catch(() => null);
  if (!budget) return { ok: false, problem: "failed" };
  if (budget.spentUsd >= settings.monthlyBudgetUsd && !hasFreeStage(taskId, availableKeys(), process.env, { testMaterial, freeCheck: settings.freeCheck })) {
    return { ok: false, problem: "budget" };
  }
  const parsed = spec.input.safeParse(rawInput);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  return draftThroughChain(staffProfileId, taskId, spec, parsed.data, settings, budget.spentUsd, { testMaterial });
}

/** A task's whole system prompt: the shared rules, the task's own, and what One knows about that kind of work. */
export function taskInstructions(spec: Pick<TaskSpec<unknown, unknown>, "feature" | "instructions">, permittedHrefs?: string[]): string {
  const workflow = spec.feature as OneWorkflow;
  return oneInstructions(`${SHARED_RULES}\n\n${spec.instructions}`, GROUNDED_WORKFLOWS.has(workflow) ? workflow : undefined, permittedHrefs);
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
        jsonSchema: nvidiaGuidedJson(config.model),
        // Thinking off: Nemotron spent 9-12 s and sometimes every token thinking about a 40-minute cover plan (D-496).
        extra: { chat_template_kwargs: { enable_thinking: false, thinking: false } },
      });
    }
    case "openrouter-free": {
      const config = openRouterConfig();
      if (!config) throw Object.assign(new Error("OpenRouter key missing"), { status: 401 });
      return chatDraft({
        url: "https://openrouter.ai/api/v1/chat/completions", apiKey: config.apiKey, model: config.models[0], models: config.models,
        instructions: ask.instructions, text: ask.text, output: ask.spec.output, maxTokens: ask.spec.maxTokens, timeoutMs,
        jsonSchema: true, headers: { "X-Title": "VPPS One" },
        extra: {
          // Never a paid model: OpenRouter refuses any route that would charge (owner, 7 Nov 2026).
          provider: { max_price: { prompt: 0, completion: 0, request: 0, image: 0 } },
          // Thinking off, as for NVIDIA (D-496); none of the default models insists on it.
          reasoning: { effort: "none" },
        },
      });
    }
    case "apinex-free": {
      const config = apinexConfig();
      if (!config) throw Object.assign(new Error("APInex key missing"), { status: 401 });
      // The schema goes in the instructions only: whether APInex passes `response_format` on to
      // every model behind it is not known, and a refused option would fail the whole draft.
      const reply = await chatDraft({
        url: APINEX_CHAT_URL, apiKey: config.apiKey, model: stage.model,
        instructions: ask.instructions, text: ask.text, output: ask.spec.output, maxTokens: ask.spec.maxTokens, timeoutMs,
      });
      // The log keeps the `free/…` name One asked for, which the free models' check uses too.
      return { ...reply, model: stage.model };
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
  options: { permittedHrefs?: string[]; testMaterial?: boolean } = {},
): Promise<AssistOutcome<TaskOutput<K>>> {
  const { permittedHrefs, testMaterial = false } = options;
  const feature = spec.feature;
  const masked = maskPersonal(spec.prompt(input), spec.names?.(input) ?? []);
  const ask: Ask = {
    instructions: taskInstructions(spec, permittedHrefs),
    text: masked.text,
    image: spec.image?.(input) ?? null,
    spec: spec as TaskSpec<unknown, unknown>,
  };
  const stages = assistChain(taskId, availableKeys(), process.env, { testMaterial, freeCheck: settings.freeCheck });

  let model = stages[0]?.model ?? "none";
  let provider = stages[0]?.provider ?? null;
  let inputTokens = 0, outputTokens = 0, cacheReadTokens = 0, spend = 0;
  const log = (outcome: "drafted" | "refused" | "failed") =>
    writeLog({ staffProfileId, feature, task: taskId, model, provider, outcome, inputTokens, outputTokens, cacheReadTokens, costUsd: Math.round(spend * 1_000_000) / 1_000_000 });

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
  // The free stages share one allowance, so a paid model always has time left to answer (D-496).
  let freeLeft = FREE_SHARE_MS[TASK_TIER[taskId]];
  let busy = false;
  for (const stage of stages) {
    const left = CHAIN_DEADLINE_MS - (Date.now() - started);
    if (left < 6_000) break;
    const free = FREE_PROVIDERS.has(stage.provider);
    const geminiFree = stage.provider === "gemini-free";
    // Charge everything already spent to this draft, and start no further paid call once at the cap.
    if (!free && spentUsd + spend >= settings.monthlyBudgetUsd) return reject("budget");
    if (free && (freeLeft < MIN_FREE_STAGE_MS || isResting(stage.provider) || isResting(`${stage.provider}:${stage.model}`))) continue;
    if (geminiFree && (await freeKeyBlocked())) continue;
    const stageStarted = Date.now();
    const allowed = Math.min(stage.timeoutMs, left - 2_000, free ? freeLeft : Infinity);
    try {
      const reply = await runStage(stage, ask, allowed);
      // OpenRouter names the free model that actually answered; the log keeps it.
      model = reply.model ?? stage.model;
      provider = stage.provider;
      inputTokens += reply.input;
      outputTokens += reply.output;
      cacheReadTokens += reply.cacheRead;
      spend += reply.costUsd;
      if (geminiFree) void saveStatuses([statusRow("gemini-free", { outcome: "ok", model: stage.model }, new Date())]);
      if (reply.refused) return reject("refused");
      const finished = finish(reply.candidate);
      // A free model's Hindi is checked too: one answered a Hindi brief in English (D-496).
      if (finished && (!free || readsAsHindi(finished, input))) return { ok: true, value: finished, logId: await log("drafted") };
      // An answer that does not fit the task: the next model may do better.
    } catch (error) {
      const failure = failureOf(error);
      if (BUSY.includes(failure.problem) || error instanceof Anthropic.APIConnectionError) busy = true;
      // A stage cut short by the time left is not the provider's fault; a full-length timeout is.
      if (free && !(failure.problem === "timeout" && allowed < stage.timeoutMs)) {
        rest(restsWholeProvider(stage.provider, failure.problem) ? stage.provider : `${stage.provider}:${stage.model}`, restAfter(failure.problem));
      }
      // Fixed words only: which free stage failed and why, never the request or the provider's message.
      if (free) console.warn(`[assist] free stage failed provider=${stage.provider} model=${stage.model} problem=${(error as { firewall?: boolean } | null)?.firewall ? "firewall" : failure.problem} status=${failure.httpStatus ?? "-"}`);
      if (geminiFree) void saveStatuses([statusRow("gemini-free", { outcome: "unavailable", model: stage.model, ...failure }, new Date())]);
    } finally {
      if (free) freeLeft -= Date.now() - stageStarted;
    }
  }
  return reject(busy ? "busy" : "failed");
}
