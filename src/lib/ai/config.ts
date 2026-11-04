import "server-only";

import { declaresProduction } from "@/platform/deployment/confinement";

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-2.5-flash"] as const;
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

  const paidModel = aiModel(env.GEMINI_MODEL_PAID?.trim() || env.GEMINI_MODEL_FALLBACK?.trim() || DEFAULT_MODEL);
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

export function builtinAiPilot(env: Env = process.env): AiPilotConfig | null {
  if (env.VPPSONE_BUILTIN_AI_TEST !== "1" || declaresProduction(env)) return null;
  try {
    return providerConfig(env);
  } catch {
    return null;
  }
}
