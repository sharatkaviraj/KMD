import "server-only";

import { declaresProduction } from "@/platform/deployment/confinement";

/**
 * Gemini models the router may use, confirmed against Google's model and
 * pricing pages on 4 Nov 2026. `gemini-2.5-flash` is deprecated (existing
 * users only) and routes to 3.5 Flash-Lite from 1 Dec 2026.
 */
export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"] as const;
const MODELS = GEMINI_MODELS;
export type AiModel = (typeof MODELS)[number];
export const DEFAULT_MODEL: AiModel = "gemini-3.5-flash-lite";
export const DEFAULT_FALLBACK: AiModel = "gemini-3.8-flash";

export function aiModel(value: string): AiModel {
  if (!(MODELS as readonly string[]).includes(value)) throw new Error("Unsupported Gemini model");
  return value as AiModel;
}

type Env = Readonly<Record<string, string | undefined>>;

export const CLAUDE_IMAGE_MODEL = "claude-sonnet-5-5";
export const DEFAULT_CLAUDE_VOICE_MODEL = "claude-haiku-5-5";
export const OPENAI_TRANSCRIPTION_MODEL = "gpt-transcribe";

const CLAUDE_IMAGE_MODELS = [CLAUDE_IMAGE_MODEL, "claude-sonnet-5"] as const;
type ClaudeImageModel = (typeof CLAUDE_IMAGE_MODELS)[number];
function isClaudeImageModel(model: string): model is ClaudeImageModel {
  return (CLAUDE_IMAGE_MODELS as readonly string[]).includes(model);
}

function modelConfig(env: Env) {
  const model = aiModel(env.GEMINI_MODEL?.trim() || DEFAULT_MODEL);
  const vision = aiModel(env.GEMINI_MODEL_VISION?.trim() || model);
  const fallback = aiModel(env.GEMINI_MODEL_FALLBACK?.trim() || DEFAULT_FALLBACK);
  const thinkingBudget = Number(env.GEMINI_THINKING_BUDGET ?? "0");
  const thinkingLevel = env.GEMINI_THINKING_LEVEL?.trim() || "minimal";
  const inrPerUsd = Number(env.GEMINI_INR_PER_USD?.trim() || "90");
  if (!Number.isInteger(thinkingBudget) || thinkingBudget < 0 || thinkingBudget > 2048 ||
      !["minimal", "low"].includes(thinkingLevel) ||
      !Number.isFinite(inrPerUsd) || inrPerUsd <= 0 || inrPerUsd > 1_000) {
    throw new Error("Invalid Gemini configuration");
  }
  return { model, vision, fallback, thinkingBudget, thinkingLevel, inrPerUsd };
}

export function geminiConfig(env: Env = process.env) {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini is not configured");
  return { apiKey, ...modelConfig(env) };
}

export type GeminiConfig = ReturnType<typeof geminiConfig>;

export type AiPilotConfig = ReturnType<typeof modelConfig> & {
  freeApiKey?: string;
  paidApiKey?: string;
  paidModel: AiModel;
  anthropicApiKey?: string;
  openAiApiKey?: string;
  claudeImageModel: ClaudeImageModel;
  claudeVoiceModel: ClaudeImageModel | typeof DEFAULT_CLAUDE_VOICE_MODEL;
  openAiTranscriptionModel: typeof OPENAI_TRANSCRIPTION_MODEL;
};

/** An explicitly free credential must never be used through the legacy paid slot. */
export function paidGeminiKey(env: Env = process.env): string | undefined {
  const key = env.GEMINI_API_KEY_PAID?.trim() || env.GEMINI_API_KEY?.trim();
  return key && key !== env.GEMINI_API_KEY_FREE?.trim() ? key : undefined;
}

function paidGeminiModel(env: Env) {
  return aiModel(env.GEMINI_MODEL_PAID?.trim() || env.GEMINI_MODEL?.trim() || env.GEMINI_MODEL_FALLBACK?.trim() || DEFAULT_MODEL);
}

export function paidGeminiConfig(env: Env = process.env) {
  const apiKey = paidGeminiKey(env);
  if (!apiKey) return null;
  return { ...modelConfig(env), apiKey, model: paidGeminiModel(env) };
}

/**
 * The free AI Studio key, for material that names nobody (Assist's open tasks,
 * D-417; fictional TEST jobs, D-401). `null` when unset or invalid.
 */
export function freeGeminiConfig(env: Env = process.env) {
  const apiKey = env.GEMINI_API_KEY_FREE?.trim();
  if (!apiKey) return null;
  try {
    const models = modelConfig(env);
    return { ...models, apiKey, model: models.model };
  } catch {
    return null;
  }
}

/**
 * OpenRouter, free models only (owner, 7 Nov 2026). The account holds $10 of
 * credit solely to lift the free-model limit to 1,000 requests a day; it must
 * never pay for a model. So every model named here must end in `:free` (or be
 * OpenRouter's own free router), and each request also carries a zero
 * `max_price` (`run.ts`). Up to three models, tried in order by OpenRouter.
 *
 * Nemotron 3.5 Super VL first: with thinking off it answered 10 of One's 11
 * real tasks in 1-4 s on NVIDIA's own API (D-496). OpenRouter's account has its
 * own limits with NVIDIA, so it still answers when ours are used up. Then
 * Gemma 4 31B, which Google AI Studio serves: a different company's servers
 * when NVIDIA's are down. Lightning is not here: it wrote Hinglish notes and
 * English when asked for Hindi.
 */
export const OPENROUTER_DEFAULT_MODELS = ["nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-31b-it:free", "openrouter/free"] as const;
const FREE_OPENROUTER_MODEL = /^(?:openrouter\/free|[a-z0-9][a-z0-9._-]{0,40}\/[a-z0-9][a-z0-9._-]{0,80}:free)$/u;

export function isFreeOpenRouterModel(id: string): boolean {
  return FREE_OPENROUTER_MODEL.test(id);
}

export function openRouterConfig(env: Env = process.env): { apiKey: string; models: string[] } | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  const listed = (env.VPPSONE_OPENROUTER_MODELS ?? "").split(",").map((m) => m.trim().toLowerCase()).filter(Boolean);
  const models = [...new Set(listed.length ? listed : OPENROUTER_DEFAULT_MODELS)].filter(isFreeOpenRouterModel).slice(0, 3);
  return models.length ? { apiKey, models } : null;
}

/**
 * NVIDIA's free API catalogue (build.nvidia.com), Nemotron 3.5 Super VL by default (Kimi K2.6 answers 404 for this account, 7 Nov 2026).
 * Vercel holds the key as `NVIDIA_KIMI_API_KEY`; `NVIDIA_API_KEY` is an alias.
 */
export const NVIDIA_DEFAULT_MODEL = "nvidia/nemotron-3.5-super-vl-120b-a12b";
const NVIDIA_MODEL = /^[a-z0-9][a-z0-9._-]{0,40}\/[a-z0-9][a-z0-9._-]{0,80}$/u;

/**
 * NVIDIA models that keep to a JSON schema when the request carries one
 * (guided decoding). Measured on One's own tasks, 7 Nov 2026 (D-496): Super VL
 * answered 10 of 11 with it, and its call scripts stopped coming back with a
 * paragraph where a list belongs. Nemotron 3 Ultra stalled with it until the
 * token limit, so any other model gets the schema in its instructions only.
 */
const NVIDIA_GUIDED = /^nvidia\/nemotron-3\.5-super-vl(?:-|$)/u;

export function nvidiaGuidedJson(model: string): boolean {
  return NVIDIA_GUIDED.test(model);
}

export function nvidiaConfig(env: Env = process.env): { apiKey: string; model: string } | null {
  const apiKey = env.NVIDIA_KIMI_API_KEY?.trim() || env.NVIDIA_API_KEY?.trim();
  if (!apiKey) return null;
  const model = env.VPPSONE_NVIDIA_MODEL?.trim().toLowerCase() || NVIDIA_DEFAULT_MODEL;
  return { apiKey, model: NVIDIA_MODEL.test(model) ? model : NVIDIA_DEFAULT_MODEL };
}

/**
 * APInex (api.apinex.bond), free models only (owner, 10 Nov 2026). An
 * OpenAI-compatible gateway whose `free/…` models cost nothing; the account
 * holds no credit, and One never names a model that is not `free/…`, so a
 * paid one can never be asked for. The key lives in the owner's vault as
 * `FREE_API_KEY` and in Vercel as `APINEX_API_KEY`; the vault's name is read
 * too, but only when the value has APInex's own shape, so another company's
 * "free" key is never sent here.
 *
 * Which free model writes which job is `APINEX_MODELS` in `assist/domain/routes.ts`;
 * `VPPSONE_APINEX_QUICK`, `…_WRITING` and `…_CAREFUL` override a job's list.
 */
export const APINEX_CHAT_URL = "https://api.apinex.bond/v1/chat/completions";
export const APINEX_MODELS_URL = "https://api.apinex.bond/v1/models";
/** APInex's public catalogue (no key): `allowFree` says whether a `free/…` model is really served free (D-568). */
export const APINEX_CATALOG_URL = "https://api.apinex.bond/api/public/models";
const APINEX_FREE_MODEL = /^free\/[a-z0-9][a-z0-9._-]{0,60}$/u;
const APINEX_KEY_SHAPE = /^sk-apx-[A-Za-z0-9_-]{8,200}$/u;

export function isFreeApinexModel(id: string): boolean {
  return APINEX_FREE_MODEL.test(id);
}

export type ApinexJob = "quick" | "writing" | "careful";

export function apinexConfig(env: Env = process.env): { apiKey: string; overrides: Partial<Record<ApinexJob, string[]>> } | null {
  const named = env.APINEX_API_KEY?.trim();
  const vault = env.FREE_API_KEY?.trim();
  const apiKey = named || (vault && APINEX_KEY_SHAPE.test(vault) ? vault : "");
  if (!apiKey) return null;
  const overrides: Partial<Record<ApinexJob, string[]>> = {};
  for (const job of ["quick", "writing", "careful"] as const) {
    const listed = (env[`VPPSONE_APINEX_${job.toUpperCase()}`] ?? "").split(",").map((m) => m.trim().toLowerCase()).filter(isFreeApinexModel);
    if (listed.length) overrides[job] = [...new Set(listed)].slice(0, 3);
  }
  return { apiKey, overrides };
}

/** The OpenAI API Platform key (the plan's monthly credits). Vercel's name first, then the usual alias. */
export function openAiKey(env: Env = process.env): string | undefined {
  return env.OPEN_AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined;
}

export function providerConfig(env: Env = process.env): AiPilotConfig {
  const paidApiKey = paidGeminiKey(env);
  const freeApiKey = env.GEMINI_API_KEY_FREE?.trim() || undefined;
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const openAiApiKey = env.OPEN_AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined;
  if (!freeApiKey && !anthropicApiKey && !paidApiKey) throw new Error("No extraction provider is configured");

  // The paid key uses the same model as the free key unless told otherwise, so
  // an answer reads the same whichever key gave it.
  const paidModel = paidGeminiModel(env);
  const claudeImageModel = env.VPPSONE_CLAUDE_IMAGE_MODEL?.trim() || CLAUDE_IMAGE_MODEL;
  const claudeVoiceModel = env.VPPSONE_CLAUDE_VOICE_MODEL?.trim() || DEFAULT_CLAUDE_VOICE_MODEL;
  const openAiTranscriptionModel = env.VPPSONE_OPENAI_TRANSCRIPTION_MODEL?.trim() || OPENAI_TRANSCRIPTION_MODEL;
  if (!isClaudeImageModel(claudeImageModel)) throw new Error("Unsupported Claude image model");
  if (claudeVoiceModel !== DEFAULT_CLAUDE_VOICE_MODEL && !isClaudeImageModel(claudeVoiceModel)) {
    throw new Error("Unsupported Claude voice model");
  }
  if (openAiTranscriptionModel !== OPENAI_TRANSCRIPTION_MODEL) throw new Error("Unsupported OpenAI transcription model");
  return {
    ...modelConfig(env), freeApiKey, paidApiKey, paidModel, anthropicApiKey, openAiApiKey,
    claudeImageModel, claudeVoiceModel, openAiTranscriptionModel,
  };
}

/**
 * Who may use built-in AI on this deployment (owner direction, 4 Nov 2026).
 *
 *  - `live`: every member of staff whose permissions allow the action, in the
 *    session they are working in. Only a production deployment can be live.
 *  - `test`: TEST sessions only (test accounts, or a real admin who has
 *    switched to TEST). A confined deployment is never more than this: every
 *    user there is a test account anyway.
 *  - `off`: nothing appears and every AI route answers 404.
 *
 * Production reads `VPPSONE_BUILTIN_AI` (`live` or `test`). A confined
 * deployment also honours the pilot's `VPPSONE_BUILTIN_AI_TEST=1`.
 */
export type BuiltinAiMode = "off" | "test" | "live";

export function builtinAiMode(env: Env = process.env): BuiltinAiMode {
  const flag = env.VPPSONE_BUILTIN_AI?.trim().toLowerCase();
  if (!declaresProduction(env)) {
    return env.VPPSONE_BUILTIN_AI_TEST === "1" || flag === "test" || flag === "live" ? "test" : "off";
  }
  return flag === "live" ? "live" : flag === "test" ? "test" : "off";
}

export function builtinAiPilot(env: Env = process.env): AiPilotConfig | null {
  if (builtinAiMode(env) === "off") return null;
  try {
    return providerConfig(env);
  } catch {
    return null;
  }
}

const TEST_SESSION = /^(?:TEST|UAT|DEMO)-\d{4}-\d{2}$/u;

/**
 * Providers for one job's session. Real school records never go to Gemini's
 * unpaid tier: Google's unpaid-service terms forbid personal information and
 * allow the content to be used to improve its products. Only fictional TEST
 * material may use the free key; real sessions start at Claude, then Gemini Paid.
 */
export function configForSession(config: AiPilotConfig, session: string): AiPilotConfig {
  return TEST_SESSION.test(session) ? config : { ...config, freeApiKey: undefined };
}
