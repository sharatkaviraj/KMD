import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import type { ProviderAttempt } from "./providers";
import { keyState, nextPacificMidnight, type AiKey, type FailureProblem } from "./router";

/**
 * What each AI key last did, shared by every server instance through
 * `vppsone.builtin_ai_provider_status` (migration 20261104083132_builtin_ai_key_status),
 * with a one-minute memory in front of it. Bookkeeping never fails an AI job:
 * every read and write here swallows its own errors.
 */

export type KeyStatus = {
  provider: AiKey;
  state: "ok" | "quota" | "failing";
  problem: FailureProblem | null;
  http_status: number | null;
  model: string | null;
  blocked_until: string | null;
  checked_at: string;
};

const TABLE = "builtin_ai_provider_status";
let freeBlockedUntil = 0;
let freeReadAt = 0;

/**
 * Is the free key known to be unusable right now? A daily quota blocks it
 * until midnight Pacific; a rate limit for a minute; a refused key for ten
 * minutes (so a bad key costs one quick call every ten minutes, not one per request).
 */
export async function freeKeyBlocked(now = Date.now()): Promise<boolean> {
  if (freeBlockedUntil > now) return true;
  if (now - freeReadAt < 60_000) return false;
  freeReadAt = now;
  try {
    const { data, error } = await createAdminClient().from(TABLE).select("blocked_until")
      .eq("provider", "gemini-free").maybeSingle<{ blocked_until: string | null }>();
    if (error) return false;
    freeBlockedUntil = data?.blocked_until ? Date.parse(data.blocked_until) : 0;
    return freeBlockedUntil > now;
  } catch {
    return false;
  }
}

function blockFor(provider: AiKey, problem: FailureProblem | null, now: Date): string | null {
  if (provider !== "gemini-free" || !problem) return null;
  if (problem === "quota_daily") return nextPacificMidnight(now).toISOString();
  if (problem === "quota") return new Date(now.valueOf() + 60_000).toISOString();
  if (problem === "credential" || problem === "permission" || problem === "billing") return new Date(now.valueOf() + 10 * 60_000).toISOString();
  return null;
}

export function statusRow(provider: AiKey, attempt: { outcome: string; problem?: FailureProblem; httpStatus?: number; model: string }, now: Date): KeyStatus {
  const problem = attempt.outcome === "ok" ? null : attempt.problem ?? (attempt.outcome === "invalid" ? "schema" : "other");
  return {
    provider, state: keyState(problem), problem, http_status: attempt.httpStatus ?? null,
    model: attempt.model.slice(0, 80), blocked_until: blockFor(provider, problem, now), checked_at: now.toISOString(),
  };
}

/** Keep each key's last outcome from one job's attempts. */
export async function recordAttempts(attempts: readonly ProviderAttempt[], now = new Date()) {
  const last = new Map<AiKey, ProviderAttempt>();
  for (const attempt of attempts) last.set(attempt.provider, attempt);
  await saveStatuses([...last].map(([provider, attempt]) => statusRow(provider, attempt, now)));
}

export async function saveStatuses(rows: readonly KeyStatus[]) {
  if (!rows.length) return;
  const free = rows.find((row) => row.provider === "gemini-free");
  if (free) {
    freeBlockedUntil = free.blocked_until ? Date.parse(free.blocked_until) : 0;
    freeReadAt = Date.now();
  }
  try {
    await createAdminClient().from(TABLE).upsert([...rows], { onConflict: "provider" });
  } catch {
    // The admin page shows the last status it could store.
  }
}

export async function readKeyStatuses(): Promise<KeyStatus[]> {
  try {
    const { data, error } = await createAdminClient().from(TABLE)
      .select("provider, state, problem, http_status, model, blocked_until, checked_at").returns<KeyStatus[]>();
    return error || !data ? [] : data;
  } catch {
    return [];
  }
}
