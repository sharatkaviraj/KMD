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

export function providerConfig(env: Env = process.env): AiPilotConfig {
  const paidApiKey = env.GEMINI_API_KEY_PAID?.trim() || env.GEMINI_API_KEY?.trim() || undefined;
  const freeKey = env.GEMINI_API_KEY_FREE?.trim();
  const freeApiKey = freeKey && freeKey !== paidApiKey ? freeKey : undefined;
  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || undefined;
  const openAiApiKey = env.OPEN_AI_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || undefined;
  if (!freeApiKey && !anthropicApiKey && !paidApiKey) throw new Error("No extraction provider is configured");

  // The paid key uses the same model as the free key unless told otherwise, so
  // an answer reads the same whichever key gave it.
  const paidModel = aiModel(env.GEMINI_MODEL_PAID?.trim() || env.GEMINI_MODEL?.trim() || env.GEMINI_MODEL_FALLBACK?.trim() || DEFAULT_MODEL);
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
