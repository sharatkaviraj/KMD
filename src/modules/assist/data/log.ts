import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { dayStartIst, monthStartIst } from "../domain/cost";
import type { AssistDecision, AssistFeature } from "../domain/features";

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
