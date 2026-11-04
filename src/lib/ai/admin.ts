import "server-only";

import { z } from "zod";

import type { CurrentStaff } from "@/platform/auth/current-staff";
import { createAdminClient } from "@/platform/supabase/admin";

import { builtinAiMode } from "@/lib/ai/config";
import { saveStatuses, statusRow } from "@/lib/ai/provider-status";
import { runAiSmoke, smokeStatuses, type SmokeReport } from "@/lib/ai/smoke";

/**
 * The daily limit is one number for the whole school. When built-in AI is live
 * only a real admin may change it; a test account may change it only while
 * built-in AI is limited to TEST sessions.
 */
export function mayChangeBuiltinAiLimit(staff: Pick<CurrentStaff, "role" | "isTestAccount">) {
  const mode = builtinAiMode();
  return staff.role === "admin" && mode !== "off" && (mode === "test" || staff.isTestAccount !== true);
}

const report = z.object({
  actions: z.number(), handled: z.number(), applied: z.number(), edited: z.number(), costInr: z.number(),
  dailyLimit: z.number().int().min(0).max(200),
  providers: z.array(z.object({ provider: z.string(), handled: z.number(), attempts: z.number(), cost: z.number() })),
  failures: z.array(z.object({
    action: z.string(), provider: z.string().nullable(), error: z.string().nullable(), created_at: z.string(),
  })),
});

export async function getBuiltinAiReport() {
  const { data, error } = await createAdminClient().rpc("builtin_ai_usage");
  if (error) return null;
  const result = report.safeParse(data);
  return result.success ? result.data : null;
}

export async function setBuiltinAiDailyLimit(staffId: string, limit: number) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 200) return false;
  const { data, error } = await createAdminClient().from("builtin_ai_settings")
    .update({ daily_limit: limit, updated_by: staffId, updated_at: new Date().toISOString() })
    .eq("id", 1).select("id").maybeSingle();
  return !error && data?.id === 1;
}

/** Checking keys spends a fraction of a rupee and touches every key: a real admin only (a test admin while AI is TEST-only). */
export function mayCheckBuiltinAiKeys(staff: Pick<CurrentStaff, "role" | "isTestAccount">) {
  return staff.role === "admin" && (staff.isTestAccount !== true || builtinAiMode() === "test");
}

/** Run the key check on the server, where the production keys are, and keep its results. */
export async function checkBuiltinAiKeys(staffId: string): Promise<SmokeReport> {
  const report = await runAiSmoke();
  const now = new Date(report.at);
  await saveStatuses(smokeStatuses(report).map(({ key, result }) => statusRow(key, {
    outcome: result.ok ? "ok" : "unavailable", problem: result.problem, httpStatus: result.httpStatus, model: result.model,
  }, now)));
  await createAdminClient().from("builtin_ai_settings")
    .update({ last_smoke: report, last_smoke_at: report.at, updated_by: staffId }).eq("id", 1);
  return report;
}

const smokeReport = z.object({
  at: z.string(), configuredModel: z.string(), recommended: z.string().nullable(), missing: z.array(z.string()),
  results: z.array(z.object({
    key: z.string(), keyType: z.string(), model: z.string(), probe: z.string(), ok: z.boolean(), ms: z.number(),
    httpStatus: z.number().optional(), problem: z.string().optional(), note: z.string().optional(),
  })),
});

export async function lastBuiltinAiSmoke() {
  const { data, error } = await createAdminClient().from("builtin_ai_settings").select("last_smoke").eq("id", 1)
    .maybeSingle<{ last_smoke: unknown }>();
  if (error || !data?.last_smoke) return null;
  const parsed = smokeReport.safeParse(data.last_smoke);
  return parsed.success ? parsed.data : null;
}
