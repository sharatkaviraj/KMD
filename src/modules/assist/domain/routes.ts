import { ASSIST_MODELS, type AssistTier } from "./features";
import type { AssistTaskId } from "./tasks";

/**
 * Which model writes each draft, and who takes over when it cannot (D-416).
 * Pure: the data layer (`run.ts`) walks the chain; nothing here reads a key's
 * value or the network.
 *
 *   quick    Gemini Free (open tasks only) → Claude Haiku 5.5 → OpenAI gpt-6-luna → Gemini Paid
 *   writing  Claude Sonnet 5.5 → OpenAI gpt-6.1-sol → Gemini Paid
 *   careful  Claude Opus 5.5 → OpenAI gpt-6.1-sol → Gemini Paid
 *            (reading a form photo: Opus 5.5 → Gemini Paid → OpenAI)
 *
 * Claude and OpenAI are paid from the plans' monthly API credits, which lapse
 * when unused, so the best model for the job goes first. Gemini Paid is the
 * last resort, on the model the key check proved (D-415).
 *
 * **Gemini Free only ever sees an open task** (D-401, D-417): Google's
 * unpaid-service terms forbid submitting personal information, so a task
 * whose input can carry a child, a family, a parent's message, a note or a
 * photograph never goes to the free key, masked or not.
 */

export type AssistProvider = "nvidia-free" | "openrouter-free" | "gemini-free" | "anthropic" | "openai" | "gemini-paid";

/** Providers that cost nothing: they skip the budget check, and see open tasks only (D-417, D-490). */
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
 * subject, a template brief with no family in it. Only these may use the free key.
 */
export const OPEN_TASKS: ReadonlySet<AssistTaskId> = new Set<AssistTaskId>([
  "ask.answer",
  "columns.match",
  "cover.plan",
  "template.draft",
]);

export const OPENAI_MODELS: Record<AssistTier, string> = {
  quick: "gpt-6-luna",
  writing: "gpt-6.1-sol",
  careful: "gpt-6.1-sol",
};

/**
 * Seconds each stage may take. The browser gives up at 75 s and the route at
 * 90 s; the whole chain stops starting new stages at `CHAIN_DEADLINE_MS`.
 * Opus reading a dozen remarks or a photograph needs the longest.
 */
const TIMEOUT_MS: Record<AssistProvider, Record<AssistTier, number>> = {
  // The three free stages share the 21 s the paid chain leaves inside the browser's wait.
  "nvidia-free": { quick: 7_000, writing: 7_000, careful: 7_000 },
  "openrouter-free": { quick: 6_000, writing: 6_000, careful: 6_000 },
  "gemini-free": { quick: 8_000, writing: 8_000, careful: 8_000 },
  anthropic: { quick: 22_000, writing: 24_000, careful: 34_000 },
  openai: { quick: 16_000, writing: 18_000, careful: 18_000 },
  "gemini-paid": { quick: 16_000, writing: 18_000, careful: 18_000 },
};

export const CHAIN_DEADLINE_MS = 68_000;

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

/** The ordered stages for one task on this deployment. Empty when no key can answer it. */
export function assistChain(task: AssistTaskId, keys: AvailableKeys, env: Env = {}): AssistStage[] {
  const tier = TASK_TIER[task];
  const models = tierModels(env)[tier];
  const stage = (provider: AssistProvider, model: string): AssistStage => ({ provider, model, timeoutMs: TIMEOUT_MS[provider][tier] });

  const claude = keys.anthropic ? [stage("anthropic", models.claude)] : [];
  const openai = keys.openai ? [stage("openai", models.openai)] : [];
  const paid = keys.geminiPaidModel ? [stage("gemini-paid", keys.geminiPaidModel)] : [];
  // Free tiers may keep what they are sent, so only an open quick task reaches them (D-401, D-417, D-490):
  // NVIDIA's Nemotron first, then OpenRouter's free models, then Gemini Free.
  const open = tier === "quick" && OPEN_TASKS.has(task);
  const free = open ? [
    ...(keys.nvidiaModel ? [stage("nvidia-free", keys.nvidiaModel)] : []),
    ...(keys.openRouterModel ? [stage("openrouter-free", keys.openRouterModel)] : []),
    ...(keys.geminiFreeModel ? [stage("gemini-free", keys.geminiFreeModel)] : []),
  ] : [];

  // Gemini reads handwritten Devanagari well; for a form photo it is the first fallback.
  if (task === "form.read") return [...claude, ...paid, ...openai];
  return [...free, ...claude, ...openai, ...paid];
}

/** The chain each tier would use with every key present, for the admin's settings page. */
export function describeChains(keys: AvailableKeys, env: Env = {}): Record<AssistTier, AssistStage[]> {
  return {
    quick: assistChain("ask.answer", keys, env),
    writing: assistChain("message.write", keys, env),
    careful: assistChain("remarks.class", keys, env),
  };
}
