import "server-only";

import { lastBuiltinAiSmoke, mayChangeBuiltinAiLimit, mayCheckBuiltinAiKeys } from "@/lib/ai/admin";
import { builtinAiMode, builtinAiPilot } from "@/lib/ai/config";
import { readKeyStatuses } from "@/lib/ai/provider-status";
import type { CurrentStaff } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";

import { aiLanes, type BuiltinRoute, type Lane } from "../domain/ai-map";
import { monthStartIst } from "../domain/cost";
import { buildOverview, EMPTY_RAW, readRaw, type Overview } from "../domain/overview";
import { usageSince, type FeatureUsage } from "./log";
import { availableKeys } from "./run";
import { getAssistSettings, isAssistConfigured, type AssistSettings } from "./settings";

/** What one key last did, for the Cost view (`builtin_ai_provider_status`). */
export type KeyLine = { provider: string; state: "ok" | "quota" | "failing"; problem: string | null; model: string | null; checkedAt: string; blockedUntil: string | null };

/**
 * Settings → AI helper (D-501): everything the one AI page shows. The written
 * drafts' switch, budget and limits (D-324), the photo and voice jobs' mode
 * and daily limit (built-in AI), this month's jobs of both kinds, the route
 * each kind takes, and what every key last did.
 */
export type AiPageData = {
  /** A paid provider's key is in this deployment's environment. Its value is never read here. */
  configured: boolean;
  settings: AssistSettings | null;
  features: FeatureUsage[];
  people: { name: string; uses: number; costInr: number }[];
  overview: Overview | null;
  lanes: Lane[];
  builtin: {
    mode: "off" | "test" | "live";
    dailyLimit: number | null;
    mayChange: boolean;
    mayCheck: boolean;
    keys: KeyLine[];
    lastCheckAt: string | null;
    missing: string[];
  };
  /** Rupees to the dollar, as the deployment prices AI (`GEMINI_INR_PER_USD`, ₹90 unless set). */
  inrPerUsd: number;
  /** The first school day of the month the numbers count from (YYYY-MM-DD). */
  from: string;
  today: string;
  /** Why the numbers could not be read, when they could not. */
  error: string | null;
};

const ist = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

export function inrPerUsd(env: Readonly<Record<string, string | undefined>> = process.env): number {
  const rate = Number(env.GEMINI_INR_PER_USD?.trim() || "90");
  return Number.isFinite(rate) && rate > 0 && rate <= 1_000 ? rate : 90;
}

/** The photo and voice route on this deployment, without reading a key's value. */
function builtinRoute(): BuiltinRoute {
  const mode = builtinAiMode();
  const pilot = builtinAiPilot();
  if (!pilot) return { mode: "off", claudeImageModel: null, claudeVoiceModel: null, openAiListenModel: null, geminiPaidModel: null, geminiFreeModel: null };
  return {
    mode,
    claudeImageModel: pilot.anthropicApiKey ? pilot.claudeImageModel : null,
    claudeVoiceModel: pilot.anthropicApiKey ? pilot.claudeVoiceModel : null,
    openAiListenModel: pilot.openAiApiKey ? pilot.openAiTranscriptionModel : null,
    geminiPaidModel: pilot.paidApiKey ? pilot.paidModel : null,
    geminiFreeModel: pilot.freeApiKey ? pilot.model : null,
  };
}

async function builtinLimit(): Promise<number | null> {
  const { data, error } = await createAdminClient().from("builtin_ai_settings").select("daily_limit").eq("id", 1).maybeSingle<{ daily_limit: number }>();
  return error || !data ? null : data.daily_limit;
}

async function overviewSince(since: Date): Promise<unknown> {
  const { data, error } = await createAdminClient().rpc("ai_overview", { p_since: since.toISOString() });
  if (error) throw new Error(error.message);
  return data;
}

export async function loadAiPage(staff: Pick<CurrentStaff, "role" | "isTestAccount">, now = new Date()): Promise<AiPageData> {
  const rate = inrPerUsd();
  const since = monthStartIst(now);
  const from = ist.format(since);
  const today = ist.format(now);
  const keys = availableKeys();
  const route = builtinRoute();
  const lanes = aiLanes(keys, process.env, route);
  const base = {
    configured: isAssistConfigured(),
    lanes,
    inrPerUsd: rate,
    from,
    today,
  };

  const [settings, usage, raw, limit, statuses, smoke] = await Promise.all([
    getAssistSettings().catch(() => null),
    usageSince(since).catch(() => null),
    overviewSince(since).then(readRaw).catch((error: unknown) => (error instanceof Error ? error : new Error("unknown"))),
    builtinLimit().catch(() => null),
    readKeyStatuses().catch(() => []),
    lastBuiltinAiSmoke().catch(() => null),
  ]);

  const names = new Map<string, string>();
  const ids = usage?.staff.map((s) => s.staffProfileId) ?? [];
  if (ids.length) {
    const { data } = await createAdminClient().from("staff_profiles").select("id, display_name").in("id", ids.slice(0, 200));
    for (const row of (data ?? []) as { id: string; display_name: string }[]) names.set(row.id, row.display_name);
  }

  const failedRead = raw instanceof Error ? raw.message : null;
  const overview = buildOverview(raw instanceof Error ? EMPTY_RAW : raw, { inrPerUsd: rate, from, today, env: process.env });

  return {
    ...base,
    settings,
    features: usage?.features ?? [],
    people: (usage?.staff ?? [])
      .map((s) => ({ name: names.get(s.staffProfileId) ?? "—", uses: s.uses, costInr: Math.round(s.costUsd * rate * 100) / 100 }))
      .sort((a, b) => b.uses - a.uses)
      .slice(0, 6),
    overview: failedRead ? null : overview,
    builtin: {
      mode: route.mode,
      dailyLimit: limit,
      mayChange: mayChangeBuiltinAiLimit(staff),
      mayCheck: mayCheckBuiltinAiKeys(staff),
      keys: statuses.map((s) => ({ provider: s.provider, state: s.state, problem: s.problem, model: s.model, checkedAt: s.checked_at, blockedUntil: s.blocked_until && Date.parse(s.blocked_until) > now.getTime() ? s.blocked_until : null })),
      lastCheckAt: smoke?.at ?? null,
      missing: smoke?.missing ?? [],
    },
    error: failedRead ?? (settings ? null : "settings"),
  };
}
