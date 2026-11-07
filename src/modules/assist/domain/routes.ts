import type { FailureProblem } from "@/lib/ai/router";

import { ASSIST_MODELS, type AssistTier } from "./features";
import type { AssistTaskId } from "./tasks";

/**
 * Which model writes each draft, and who takes over when it cannot (D-416).
 * Pure: the data layer (`run.ts`) walks the chain; nothing here reads a key's
 * value or the network.
 *
 *   open     NVIDIA Free → OpenRouter Free → Gemini Free, then the task's paid chain
 *   quick    Claude Haiku 5.5 → OpenAI gpt-6-luna → Gemini Paid
 *   writing  Claude Sonnet 5.5 → OpenAI gpt-6.1-sol → Gemini Paid
 *   careful  Claude Opus 5.5 → OpenAI gpt-6.1-sol → Gemini Paid
 *            (reading a form photo: Opus 5.5 → Gemini Paid → OpenAI)
 *
 * Claude and OpenAI are paid from the plans' monthly API credits, which lapse
 * when unused, so the best model for the job goes first. Gemini Paid is the
 * last resort, on the model the key check proved (D-415).
 *
 * **The free models only ever see an open task, or TEST material** (D-401,
 * D-417, D-490, D-496): all three free tiers may keep what they are sent and
 * use it to improve their models, and their terms forbid personal
 * information. So a task whose input can carry a child, a family, a parent's
 * message or a note never goes to them, masked or not — unless it comes from
 * a test account, whose children are the masked replica's invented people.
 * A photograph never goes to them at all: it cannot be masked, and the form
 * someone photographs to try the reader is usually a real one.
 */

export type AssistProvider = "nvidia-free" | "openrouter-free" | "gemini-free" | "anthropic" | "openai" | "gemini-paid";

/** Providers that cost nothing: they skip the budget check, and see open tasks and TEST material only (D-417, D-490, D-496). */
export const FREE_PROVIDERS: ReadonlySet<AssistProvider> = new Set<AssistProvider>(["nvidia-free", "openrouter-free", "gemini-free"]);

export type AssistStage = { provider: AssistProvider; model: string; timeoutMs: number };

/** The tier of every task. A feature's tasks can differ: a template draft is quick, a parent notice is writing. */
export const TASK_TIER: Record<AssistTaskId, AssistTier> = {
  "note.polish": "quick",
  "note.sort": "quick",
  "text.translate": "quick",
  "ask.answer": "quick",
  "columns.match": "quick",
  "cover.plan": "quick",
  "template.draft": "quick",
  "message.write": "writing",
  "message.polish": "writing",
  "message.reply": "writing",
  "call.script": "writing",
  "child.summary": "writing",
  "class.digest": "writing",
  "brief.today": "writing",
  "remarks.class": "careful",
  "results.summary": "careful",
  "form.read": "careful",
};

/**
 * Tasks whose input names nobody and holds no school record: the app's own
 * page list, spreadsheet headings (never the rows), a class label and a
 * subject, a template brief with no family in it, a class's exam totals and
 * subject averages (never a child's mark), and a notice to all parents or all
 * staff. Only these may use the free models for everyone (D-417, D-496).
 *
 * The Today brief and call scripts name nobody either, but stay on the paid
 * models: on 7 Nov 2026 the free models broke their slot rules (a number
 * written out instead of `<<absent_today>>`, a made-up `[[P1]]`), and one
 * brief carried a line of its own instructions.
 */
export const OPEN_TASKS: ReadonlySet<AssistTaskId> = new Set<AssistTaskId>([
  "ask.answer",
  "columns.match",
  "cover.plan",
  "template.draft",
  "results.summary",
  "message.write",
  "message.polish",
]);

/** Tasks that send a photograph. Never a free model's, not even for a test account (D-496). */
const IMAGE_TASKS: ReadonlySet<AssistTaskId> = new Set<AssistTaskId>(["form.read"]);

export const OPENAI_MODELS: Record<AssistTier, string> = {
  quick: "gpt-6-luna",
  writing: "gpt-6.1-sol",
  careful: "gpt-6.1-sol",
};

/**
 * Seconds each stage may take. The browser gives up at 75 s and the route at
 * 90 s; the whole chain stops starting new stages at `CHAIN_DEADLINE_MS`.
 * Opus reading a dozen remarks or a photograph needs the longest.
 *
 * With thinking off, the free models answered One's tasks in 1-4 s (a class's
 * results or remarks in up to 6 s), so a free stage that has not answered by
 * its limit is unlikely to; the next stage starts instead.
 */
const TIMEOUT_MS: Record<AssistProvider, Record<AssistTier, number>> = {
  "nvidia-free": { quick: 9_000, writing: 10_000, careful: 12_000 },
  "openrouter-free": { quick: 8_000, writing: 9_000, careful: 10_000 },
  "gemini-free": { quick: 8_000, writing: 9_000, careful: 10_000 },
  anthropic: { quick: 22_000, writing: 24_000, careful: 34_000 },
  openai: { quick: 16_000, writing: 18_000, careful: 18_000 },
  "gemini-paid": { quick: 16_000, writing: 18_000, careful: 18_000 },
};

/**
 * The most the free stages may take together, whatever each one's own limit.
 * What is left of the browser's wait belongs to the paid models, so a draft
 * the free tiers cannot write still arrives.
 */
export const FREE_SHARE_MS: Record<AssistTier, number> = { quick: 20_000, writing: 22_000, careful: 24_000 };

/** A free stage is not started with less than this left of its share. */
export const MIN_FREE_STAGE_MS = 3_000;

export const CHAIN_DEADLINE_MS = 68_000;

/**
 * How long a free provider is skipped after it fails, so the next person does
 * not wait for the same answer (D-496). A rate limit lifts within the minute;
 * a day's quota, a wrong key or a missing model does not. A reply that fails
 * the task's schema rests nothing: the next request may well be fine.
 */
export function restAfter(problem: FailureProblem): number {
  switch (problem) {
    case "quota":
      return 60_000;
    case "quota_daily":
      return 60 * 60_000;
    case "billing":
    case "credential":
    case "permission":
    case "model":
      return 30 * 60_000;
    case "server":
    case "network":
    case "timeout":
      return 2 * 60_000;
    default:
      return 0;
  }
}

/** What this deployment has: which keys are set, and the Gemini model each Gemini key answers on. */
export type AvailableKeys = {
  anthropic: boolean;
  openai: boolean;
  geminiPaidModel: string | null;
  geminiFreeModel: string | null;
  /** NVIDIA's free API model (Nemotron 3.5 Super VL by default), or null without the key. */
  nvidiaModel?: string | null;
  /** OpenRouter's first free model, or null without the key. */
  openRouterModel?: string | null;
};

type Env = Readonly<Record<string, string | undefined>>;

const MODEL_ID = /^[a-z][a-z0-9.-]{2,59}$/u;

function pick(value: string | undefined, fallback: string): string {
  const v = value?.trim().toLowerCase();
  return v && MODEL_ID.test(v) ? v : fallback;
}

/**
 * The Claude and OpenAI model per tier, with optional overrides in the
 * deployment's environment (`VPPSONE_ASSIST_CLAUDE_CAREFUL=claude-sonnet-5-5`,
 * `VPPSONE_ASSIST_OPENAI_QUICK=gpt-6.1-terra`…) so a model can be swapped
 * without a release. A malformed override is ignored.
 */
export function tierModels(env: Env = {}): Record<AssistTier, { claude: string; openai: string }> {
  const out = {} as Record<AssistTier, { claude: string; openai: string }>;
  for (const tier of ["quick", "writing", "careful"] as const) {
    const key = tier.toUpperCase();
    out[tier] = {
      claude: pick(env[`VPPSONE_ASSIST_CLAUDE_${key}`], ASSIST_MODELS[tier]),
      openai: pick(env[`VPPSONE_ASSIST_OPENAI_${key}`], OPENAI_MODELS[tier]),
    };
  }
  return out;
}

export type ChainOptions = {
  /**
   * The draft is about TEST material: a test account asked, or a draft is
   * being prepared for a TEST session. Every text task may then start on the
   * free models; a photograph still never does (D-401, D-496).
   */
  testMaterial?: boolean;
};

/** The ordered stages for one task on this deployment. Empty when no key can answer it. */
export function assistChain(task: AssistTaskId, keys: AvailableKeys, env: Env = {}, options: ChainOptions = {}): AssistStage[] {
  const tier = TASK_TIER[task];
  const models = tierModels(env)[tier];
  const stage = (provider: AssistProvider, model: string): AssistStage => ({ provider, model, timeoutMs: TIMEOUT_MS[provider][tier] });

  const claude = keys.anthropic ? [stage("anthropic", models.claude)] : [];
  const openai = keys.openai ? [stage("openai", models.openai)] : [];
  const paid = keys.geminiPaidModel ? [stage("gemini-paid", keys.geminiPaidModel)] : [];
  // Free tiers may keep what they are sent, so only an open task or TEST material reaches them, and
  // never a photograph (D-401, D-417, D-490, D-496): NVIDIA's Nemotron first, then OpenRouter's free
  // models, then Gemini Free.
  const mayUseFree = !IMAGE_TASKS.has(task) && (OPEN_TASKS.has(task) || options.testMaterial === true);
  const free = mayUseFree ? [
    ...(keys.nvidiaModel ? [stage("nvidia-free", keys.nvidiaModel)] : []),
    ...(keys.openRouterModel ? [stage("openrouter-free", keys.openRouterModel)] : []),
    ...(keys.geminiFreeModel ? [stage("gemini-free", keys.geminiFreeModel)] : []),
  ] : [];

  // Gemini reads handwritten Devanagari well; for a form photo it is the first fallback.
  if (task === "form.read") return [...claude, ...paid, ...openai];
  return [...free, ...claude, ...openai, ...paid];
}

/** True when this task, for this material, has a free stage on this deployment. */
export function hasFreeStage(task: AssistTaskId, keys: AvailableKeys, env: Env = {}, options: ChainOptions = {}): boolean {
  return assistChain(task, keys, env, options).some((s) => FREE_PROVIDERS.has(s.provider));
}

export type ChainRow = "open" | AssistTier;

/**
 * What the admin's settings page shows: the chain an open task uses, then the
 * paid chain of each tier for the tasks that carry a person's details.
 */
export function describeChains(keys: AvailableKeys, env: Env = {}): Record<ChainRow, AssistStage[]> {
  return {
    open: assistChain("ask.answer", keys, env),
    quick: assistChain("note.polish", keys, env),
    writing: assistChain("message.reply", keys, env),
    careful: assistChain("remarks.class", keys, env),
  };
}
