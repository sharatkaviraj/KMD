import "server-only";

import { canAny, type PermissionSubject, type StaffPermission } from "@/platform/auth/permissions";
import { CACHE_TAGS, expireTag, sharedCache } from "@/platform/performance/shared-cache";
import { createAdminClient } from "@/platform/supabase/admin";

import {
  assistFeatures,
  FEATURE_PERMISSIONS,
  isAssistFeature,
  type AssistFeature,
} from "../domain/features";

export type AssistSettings = {
  enabled: boolean;
  monthlyBudgetUsd: number;
  dailyCapPerStaff: number;
  disabledFeatures: AssistFeature[];
  updatedAt: string | null;
  updatedBy: string | null;
};

type SettingsRow = {
  enabled: boolean;
  monthly_budget_usd: number | string;
  daily_cap_per_staff: number;
  disabled_features: string[] | null;
  updated_at: string | null;
  updated_by: string | null;
};

/**
 * The helper exists only where the school has put its Claude Console key in
 * the deployment (`ANTHROPIC_API_KEY`). Without it every AI button is absent,
 * not broken: the screens are exactly what they were.
 */
export function isAssistConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

/**
 * One row, cached for five minutes across requests and expired by the
 * settings page. A failed read throws: the caller treats that as "off",
 * because a helper whose budget cannot be read cannot be held to it.
 */
export const getAssistSettings = sharedCache(
  async (): Promise<AssistSettings> => {
    const { data, error } = await createAdminClient()
      .from("assist_settings")
      .select("enabled, monthly_budget_usd, daily_cap_per_staff, disabled_features, updated_at, updated_by")
      .eq("id", 1)
      .maybeSingle<SettingsRow>();
    if (error) throw new Error(error.message);
    if (!data) throw new Error("assist_settings has no row");
    return {
      enabled: data.enabled,
      monthlyBudgetUsd: Number(data.monthly_budget_usd),
      dailyCapPerStaff: data.daily_cap_per_staff,
      disabledFeatures: (data.disabled_features ?? []).filter(isAssistFeature),
      updatedAt: data.updated_at,
      updatedBy: data.updated_by,
    };
  },
  ["vx-assist-settings"],
  { tags: [CACHE_TAGS.assist], revalidate: 300 },
);

/**
 * The features this person is offered: the key is set, the admin has the
 * helper on and has not switched the feature off, and the person may already
 * do the job by hand. `allowed` lets the shell pass the permissions of a
 * role an admin is previewing.
 */
export async function assistFeaturesFor(
  staff: PermissionSubject,
  allowed?: (permission: StaffPermission) => boolean,
): Promise<AssistFeature[]> {
  if (!isAssistConfigured()) return [];
  const settings = await getAssistSettings().catch(() => null);
  if (!settings?.enabled) return [];
  const off = new Set(settings.disabledFeatures);
  return assistFeatures.filter((feature) => {
    if (off.has(feature)) return false;
    const needs = FEATURE_PERMISSIONS[feature];
    return allowed ? needs.some(allowed) : canAny(staff, needs);
  });
}

export async function saveAssistSettings(
  input: Omit<AssistSettings, "updatedAt" | "updatedBy">,
  staffProfileId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("assist_settings")
    .update({
      enabled: input.enabled,
      monthly_budget_usd: input.monthlyBudgetUsd,
      daily_cap_per_staff: input.dailyCapPerStaff,
      disabled_features: input.disabledFeatures,
      updated_by: staffProfileId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  expireTag(CACHE_TAGS.assist);
}
