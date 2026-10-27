import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { monthStartIst } from "../domain/cost";
import { ASSIST_MODELS } from "../domain/features";
import { usageSince, type FeatureUsage } from "./log";
import { getAssistSettings, isAssistConfigured, type AssistSettings } from "./settings";

export type AssistPanelData = {
  /** The Claude Console key is in this deployment's environment. Its value is never read here. */
  configured: boolean;
  models: { quick: string; careful: string };
  settings: AssistSettings | null;
  month: {
    spentUsd: number;
    features: FeatureUsage[];
    staff: { name: string; uses: number; costUsd: number }[];
  } | null;
  /** Why the numbers could not be read, when they could not. */
  error: string | null;
};

/** Settings → AI helper: the switch, the limits and this month's use, for the admin. */
export async function loadAssistPanel(now = new Date()): Promise<AssistPanelData> {
  const configured = isAssistConfigured();
  const models = { quick: ASSIST_MODELS.quick, careful: ASSIST_MODELS.careful };
  try {
    const [settings, usage] = await Promise.all([getAssistSettings(), usageSince(monthStartIst(now))]);
    const ids = usage.staff.map((s) => s.staffProfileId);
    const names = new Map<string, string>();
    if (ids.length) {
      const { data } = await createAdminClient().from("staff_profiles").select("id, display_name").in("id", ids);
      for (const row of (data ?? []) as { id: string; display_name: string }[]) names.set(row.id, row.display_name);
    }
    return {
      configured,
      models,
      settings,
      month: {
        spentUsd: usage.features.reduce((sum, f) => sum + f.costUsd, 0),
        features: usage.features,
        staff: usage.staff.map((s) => ({ name: names.get(s.staffProfileId) ?? "—", uses: s.uses, costUsd: s.costUsd })),
      },
      error: null,
    };
  } catch (error) {
    return { configured, models, settings: null, month: null, error: error instanceof Error ? error.message : "unknown" };
  }
}
