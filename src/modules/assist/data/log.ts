import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { dayStartIst, monthStartIst } from "../domain/cost";
import type { AssistDecision, AssistFeature } from "../domain/features";
import {
  ASSIST_LOG_PURGE_BATCH,
  ASSIST_LOG_PURGE_MAX_BATCHES,
  assistLogCutoff,
} from "../domain/retention";

export type LogRow = {
  staffProfileId: string;
  feature: AssistFeature;
  task: string;
  model: string;
  outcome: "drafted" | "refused" | "failed";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
};

/** This month's estimated spend (school-wide) and this person's drafts today, both on the IST calendar. */
export async function budgetState(staffProfileId: string, now = new Date()): Promise<{ spentUsd: number; staffToday: number }> {
  const { data, error } = await createAdminClient()
    .rpc("assist_budget_state", {
      p_staff: staffProfileId,
      p_month_start: monthStartIst(now).toISOString(),
      p_day_start: dayStartIst(now).toISOString(),
    })
    .single<{ spent_usd: number | string; staff_today: number }>();
  if (error) throw new Error(error.message);
  return { spentUsd: Number(data?.spent_usd ?? 0), staffToday: Number(data?.staff_today ?? 0) };
}

/** The id lets the screen report what the person did with the draft. Null when the row could not be written. */
export async function writeLog(row: LogRow): Promise<string | null> {
  const { data, error } = await createAdminClient()
    .from("assist_log")
    .insert({
      staff_profile_id: row.staffProfileId,
      feature: row.feature,
      task: row.task,
      model: row.model,
      outcome: row.outcome,
      input_tokens: row.inputTokens,
      output_tokens: row.outputTokens,
      cache_read_tokens: row.cacheReadTokens,
      cost_usd: row.costUsd,
    })
    .select("id")
    .single<{ id: string }>();
  if (error) {
    console.error("[assist] log write failed", error.message);
    return null;
  }
  return data.id;
}

/** Once per draft, and only by the person it was made for. */
export async function recordDecision(logId: string, staffProfileId: string, decision: AssistDecision): Promise<void> {
  const { error } = await createAdminClient()
    .from("assist_log")
    .update({ decision, decided_at: new Date().toISOString() })
    .eq("id", logId)
    .eq("staff_profile_id", staffProfileId)
    .is("decision", null);
  if (error) throw new Error(error.message);
}

/** Counts only: no id, member of staff or feature leaves the purge. */
export type AssistLogPurge = { deleted: number; batches: number; more: boolean };

/**
 * Delete log rows past retention (`domain/retention.ts`), oldest first, in
 * bounded batches: at most `batch` rows per delete and `maxBatches` deletes
 * per run, so one night never holds a long transaction and a backlog finishes
 * on the nights after. The delete repeats the age filter, so a row is never
 * removed only because its id was picked.
 *
 * Read or fail loudly, as every job does: a failed read is thrown, never a
 * confident "nothing to delete", and rows past retention that a delete did
 * not remove are a failure rather than a quiet zero.
 */
export async function purgeAssistLog(
  now: Date = new Date(),
  limits: { batch: number; maxBatches: number } = {
    batch: ASSIST_LOG_PURGE_BATCH,
    maxBatches: ASSIST_LOG_PURGE_MAX_BATCHES,
  },
): Promise<AssistLogPurge> {
  const cutoff = assistLogCutoff(now).toISOString();
  const client = createAdminClient();
  let deleted = 0;

  for (let batch = 0; batch < limits.maxBatches; batch += 1) {
    const { data, error } = await client
      .from("assist_log")
      .select("id")
      .lt("created_at", cutoff)
      .order("created_at", { ascending: true })
      .limit(limits.batch);
    if (error) throw new Error(`Could not read the AI helper log: ${error.message}`);
    const ids = ((data ?? []) as { id: string }[]).map((row) => row.id);
    if (ids.length === 0) return { deleted, batches: batch, more: false };

    const { count, error: deleteError } = await client
      .from("assist_log")
      .delete({ count: "exact" })
      .in("id", ids)
      .lt("created_at", cutoff);
    if (deleteError) throw new Error(`Could not purge the AI helper log: ${deleteError.message}`);
    if (!count) throw new Error("AI helper log rows past retention were found, but none was deleted.");
    deleted += count;

    if (ids.length < limits.batch) return { deleted, batches: batch + 1, more: false };
  }

  const { count, error } = await client
    .from("assist_log")
    .select("id", { count: "exact", head: true })
    .lt("created_at", cutoff);
  if (error) throw new Error(`Could not count the AI helper log: ${error.message}`);
  return { deleted, batches: limits.maxBatches, more: (count ?? 0) > 0 };
}

export type FeatureUsage = {
  feature: string;
  uses: number;
  costUsd: number;
  kept: number;
  edited: number;
  discarded: number;
  refused: number;
  failed: number;
};

export type StaffUsage = { staffProfileId: string; uses: number; costUsd: number };

export async function usageSince(since: Date): Promise<{ features: FeatureUsage[]; staff: StaffUsage[] }> {
  const client = createAdminClient();
  const [features, staff] = await Promise.all([
    client.rpc("assist_usage_summary", { p_since: since.toISOString() }),
    client.rpc("assist_usage_by_staff", { p_since: since.toISOString() }),
  ]);
  if (features.error) throw new Error(features.error.message);
  if (staff.error) throw new Error(staff.error.message);
  type F = { feature: string; uses: number; cost_usd: number | string; kept: number; edited: number; discarded: number; refused: number; failed: number };
  type S = { staff_profile_id: string; uses: number; cost_usd: number | string };
  return {
    features: ((features.data ?? []) as F[]).map((r) => ({
      feature: r.feature,
      uses: r.uses,
      costUsd: Number(r.cost_usd),
      kept: r.kept,
      edited: r.edited,
      discarded: r.discarded,
      refused: r.refused,
      failed: r.failed,
    })),
    staff: ((staff.data ?? []) as S[]).map((r) => ({ staffProfileId: r.staff_profile_id, uses: r.uses, costUsd: Number(r.cost_usd) })),
  };
}
