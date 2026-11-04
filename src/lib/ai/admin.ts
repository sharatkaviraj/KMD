import "server-only";

import { z } from "zod";

import { createAdminClient } from "@/platform/supabase/admin";

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
