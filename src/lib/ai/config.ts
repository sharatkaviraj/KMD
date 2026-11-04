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

export function geminiConfig(env: Env = process.env) {
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Gemini is not configured");
  const model = aiModel(env.GEMINI_MODEL?.trim() || DEFAULT_MODEL);
  const vision = aiModel(env.GEMINI_MODEL_VISION?.trim() || model);
  const fallback = aiModel(env.GEMINI_MODEL_FALLBACK?.trim() || DEFAULT_FALLBACK);
  const thinkingBudget = Number(env.GEMINI_THINKING_BUDGET ?? "0");
  const thinkingLevel = env.GEMINI_THINKING_LEVEL?.trim() || "minimal";
  const inrPerUsd = Number(env.GEMINI_INR_PER_USD);
  if (!Number.isInteger(thinkingBudget) || thinkingBudget < 0 || thinkingBudget > 2048 ||
      !["minimal", "low"].includes(thinkingLevel) ||
      !Number.isFinite(inrPerUsd) || inrPerUsd <= 0 || inrPerUsd > 1_000) {
    throw new Error("Invalid Gemini configuration");
  }
  return { apiKey, model, vision, fallback, thinkingBudget, thinkingLevel, inrPerUsd };
}

export type GeminiConfig = ReturnType<typeof geminiConfig>;

export function builtinAiPilot(env: Env = process.env): GeminiConfig | null {
  if (env.VPPSONE_BUILTIN_AI_TEST !== "1" || declaresProduction(env)) return null;
  try {
    return geminiConfig(env);
  } catch {
    return null;
  }
}
