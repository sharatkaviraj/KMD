import type { AiPageData } from "@/modules/assist/data/panel";
import { aiLanes } from "@/modules/assist/domain/ai-map";
import { buildOverview, type OverviewRaw } from "@/modules/assist/domain/overview";
import { freeCheckRows } from "@/modules/assist/domain/free-check";
import { APINEX_MODELS, type FreeCheck, type FreeCheckResult } from "@/modules/assist/domain/routes";

/*
 * Settings → AI helper on synthetic numbers (D-501): every kind of job, both
 * free and paid answers, a failed try, a test job. No person in it is real.
 */

const keys = { anthropic: true, openai: true, geminiPaidModel: "gemini-3.5-flash", geminiFreeModel: "gemini-3.5-flash-lite", nvidiaModel: "nvidia/nemotron-3.5-super-vl", openRouterModel: "openrouter/free", apinexModels: APINEX_MODELS };
const route = { mode: "live" as const, claudeImageModel: "claude-sonnet-5-5", claudeVoiceModel: "claude-haiku-5-5", openAiListenModel: "gpt-transcribe", geminiPaidModel: "gemini-3.5-flash", geminiFreeModel: "gemini-3.5-flash-lite" };

const day = (d: number) => `2026-11-0${d}`;
const raw: OverviewRaw = {
  helper: [
    { task: "note.sort", model: "claude-haiku-5-5", provider: "anthropic", outcome: "drafted", decision: "kept", test: false, n: 41, cost_usd: 0.41, input_tokens: 41000, output_tokens: 9000 },
    { task: "note.sort", model: "claude-haiku-5-5", provider: "anthropic", outcome: "drafted", decision: "edited", test: false, n: 9, cost_usd: 0.09, input_tokens: 9000, output_tokens: 2000 },
    { task: "note.polish", model: "claude-haiku-5-5", provider: null, outcome: "drafted", decision: "discarded", test: false, n: 6, cost_usd: 0.05, input_tokens: 6000, output_tokens: 1500 },
    { task: "ask.answer", model: "nvidia/nemotron-3.5-super-vl", provider: "nvidia-free", outcome: "drafted", decision: "kept", test: false, n: 13, cost_usd: 0, input_tokens: 26000, output_tokens: 5000 },
    { task: "message.write", model: "google/gemma-4-31b-it:free", provider: "openrouter-free", outcome: "drafted", decision: "edited", test: false, n: 4, cost_usd: 0, input_tokens: 4000, output_tokens: 2000 },
    { task: "message.reply", model: "claude-sonnet-5-5", provider: "anthropic", outcome: "drafted", decision: null, test: false, n: 3, cost_usd: 0.06, input_tokens: 3000, output_tokens: 900 },
    { task: "note.sort", model: "gemini-3.5-flash-lite", provider: "gemini-free", outcome: "drafted", decision: "kept", test: true, n: 7, cost_usd: 0, input_tokens: 7000, output_tokens: 1400 },
    { task: "remarks.class", model: "claude-opus-5-5", provider: "anthropic", outcome: "failed", decision: null, test: false, n: 1, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
  ],
  builtin: [
    { task: "voice", model: "claude-haiku-5-5", provider: "anthropic", status: "applied", edited: false, test: false, n: 14, cost_inr: 9.8 },
    { task: "substitution-photo", model: "claude-sonnet-5-5", provider: "anthropic", status: "applied", edited: true, test: false, n: 8, cost_inr: 22.4 },
    { task: "marks-photo", model: "claude-sonnet-5-5", provider: "anthropic", status: "discarded", edited: false, test: true, n: 3, cost_inr: 8.1 },
    { task: "voice", model: null, provider: null, status: "failed", edited: false, test: false, n: 2, cost_inr: 0 },
  ],
  tries: [
    { task: "voice", provider: "openai", model: "gpt-transcribe", outcome: "ok", n: 16, cost_inr: 3.2 },
    { task: "voice", provider: "anthropic", model: "claude-haiku-5-5", outcome: "ok", n: 14, cost_inr: 6.6 },
    { task: "substitution-photo", provider: "anthropic", model: "claude-sonnet-5-5", outcome: "ok", n: 8, cost_inr: 22.4 },
    { task: "marks-photo", provider: "anthropic", model: "claude-sonnet-5-5", outcome: "ok", n: 3, cost_inr: 8.1 },
  ],
  days: [1, 2, 3, 4, 5, 6, 7].flatMap((d) => [
    { day: day(d), kind: "helper", provider: "anthropic", model: "claude-haiku-5-5", zero_cost: false, n: (d * 7) % 13 + 2 },
    { day: day(d), kind: "helper", provider: "nvidia-free", model: "nvidia/nemotron-3.5-super-vl", zero_cost: true, n: (d * 5) % 4 },
  ]),
  recent: [
    { at: "2026-11-07T05:40:00Z", kind: "builtin", task: "voice", model: "claude-haiku-5-5", provider: "anthropic", outcome: null, decision: null, status: "applied", cost_usd: null, cost_inr: 0.7, test: false, who: "Teacher A",
      attempts: [{ provider: "openai", model: "gpt-transcribe", outcome: "ok", costInr: 0.2 }, { provider: "anthropic", model: "claude-haiku-5-5", outcome: "ok", costInr: 0.5 }] },
    { at: "2026-11-07T05:12:00Z", kind: "helper", task: "ask.answer", model: "nvidia/nemotron-3.5-super-vl", provider: "nvidia-free", outcome: "drafted", decision: "kept", status: null, cost_usd: 0, cost_inr: null, test: false, who: "Office B", attempts: null },
    { at: "2026-11-07T04:55:00Z", kind: "builtin", task: "substitution-photo", model: "claude-sonnet-5-5", provider: "anthropic", outcome: null, decision: null, status: "applied", cost_usd: null, cost_inr: 2.8, test: true, who: "QA Admin",
      attempts: [{ provider: "gemini-free", model: "gemini-3.5-flash-lite", outcome: "unavailable", problem: "quota_daily", costInr: 0 }, { provider: "anthropic", model: "claude-sonnet-5-5", outcome: "ok", costInr: 2.8 }] },
    { at: "2026-11-06T10:01:00Z", kind: "helper", task: "note.sort", model: "claude-haiku-5-5", provider: "anthropic", outcome: "drafted", decision: "edited", status: null, cost_usd: 0.012, cost_inr: null, test: false, who: "Teacher C", attempts: null },
  ],
};

const overview = buildOverview(raw, { inrPerUsd: 90, from: "2026-11-01", today: "2026-11-07" });

/**
 * APInex's free models as a made-up check found them (D-567, D-568): some
 * answer, one is slow, one writes no Hindi, and two that APInex lists as
 * free are billed on this account.
 */
const NOW = Date.parse("2026-11-07T06:00:00Z");
const result = (model: string, probe: "writing" | "quick", ms: number, problem?: string): FreeCheckResult =>
  problem ? { model, probe, ok: false, ms, problem } : { model, probe, ok: true, ms };
const freeCheck: FreeCheck = {
  at: "2026-11-07T05:30:00Z",
  blocked: false,
  models: ["free/claude-sonnet-4.6", "free/deepseek-v4-pro-0813", "free/deepseek-v4.1-flash", "free/gemini-3.8-flash", "free/glm-5.3", "free/glm-5.3-flash", "free/jev-1.13", "free/kimi-k2.8", "free/kimi-k3", "free/qwen-3.8-max"],
  results: [
    result("free/qwen-3.8-max", "writing", 6200), result("free/qwen-3.8-max", "quick", 4100),
    result("free/gemini-3.8-flash", "writing", 4400), result("free/gemini-3.8-flash", "quick", 2600),
    result("free/deepseek-v4.1-flash", "writing", 3900), result("free/deepseek-v4.1-flash", "quick", 2300),
    result("free/glm-5.3-flash", "writing", 3100), result("free/glm-5.3-flash", "quick", 1900),
    result("free/deepseek-v4-pro-0813", "writing", 11800), result("free/deepseek-v4-pro-0813", "quick", 18000, "timeout"),
    result("free/kimi-k3", "writing", 7100, "not_hindi"), result("free/kimi-k3", "quick", 6000),
    result("free/glm-5.3", "writing", 9300), result("free/glm-5.3", "quick", 5800),
    result("free/claude-sonnet-4.6", "writing", 210, "not_free"), result("free/claude-sonnet-4.6", "quick", 210, "not_free"),
    result("free/kimi-k2.8", "writing", 190, "not_free"), result("free/kimi-k2.8", "quick", 190, "not_free"),
    result("free/jev-1.13", "writing", 0, "decision"), result("free/jev-1.13", "quick", 0, "decision"),
  ],
};

export const aiSettingsData: AiPageData = {
  configured: true,
  settings: { enabled: true, monthlyBudgetUsd: 25, dailyCapPerStaff: 60, disabledFeatures: ["brief"], updatedAt: "2026-11-05T10:00:00Z", updatedBy: null, freeCheck },
  features: [
    { feature: "note", uses: 56, costUsd: 0.55, kept: 41, edited: 9, discarded: 6, refused: 0, failed: 0 },
    { feature: "ask", uses: 13, costUsd: 0, kept: 13, edited: 0, discarded: 0, refused: 0, failed: 0 },
    { feature: "message", uses: 7, costUsd: 0.06, kept: 0, edited: 4, discarded: 0, refused: 0, failed: 0 },
  ],
  people: [
    { name: "Teacher A", uses: 31, costInr: 18.2 },
    { name: "Office B", uses: 17, costInr: 4.1 },
    { name: "Teacher C", uses: 9, costInr: 6.6 },
  ],
  overview,
  lanes: aiLanes(keys, {}, route, { freeCheck, now: NOW }),
  freeModels: {
    available: true,
    mayCheck: true,
    checkedAt: freeCheck.at,
    blocked: false,
    listed: freeCheck.models.length,
    rows: freeCheckRows(freeCheck, APINEX_MODELS, NOW),
  },
  builtin: {
    mode: "live",
    dailyLimit: 40,
    mayChange: true,
    mayCheck: true,
    keys: [
      { provider: "anthropic", state: "ok", problem: null, model: "claude-sonnet-5-5", checkedAt: "2026-11-07T05:40:00Z", blockedUntil: null },
      { provider: "openai", state: "ok", problem: null, model: "gpt-transcribe", checkedAt: "2026-11-07T05:40:00Z", blockedUntil: null },
      { provider: "gemini-free", state: "quota", problem: "quota_daily", model: "gemini-3.5-flash-lite", checkedAt: "2026-11-07T04:55:00Z", blockedUntil: "2026-11-08T08:00:00Z" },
    ],
    lastCheckAt: "2026-11-06T09:00:00Z",
    missing: ["gemini-paid"],
  },
  inrPerUsd: 90,
  from: "2026-11-01",
  today: "2026-11-07",
  error: null,
};
