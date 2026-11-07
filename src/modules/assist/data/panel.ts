import "server-only";

import { createAdminClient } from "@/platform/supabase/admin";

import { monthStartIst } from "../domain/cost";
import { freeUsageOf, type FreeUsage } from "../domain/free-usage";
import { describeChains, type AssistStage, type ChainRow } from "../domain/routes";
import { usageByProvider, usageSince, type FeatureUsage } from "./log";
import { availableKeys } from "./run";
import { getAssistSettings, isAssistConfigured, type AssistSettings } from "./settings";

export type AssistPanelData = {
  /** The Claude Console key is in this deployment's environment. Its value is never read here. */
  configured: boolean;
  /** Which model writes each kind of draft, in order, on this deployment (D-416, D-496). */
  chains: Record<ChainRow, AssistStage[]>;
  settings: AssistSettings | null;
  month: {
    spentUsd: number;
    features: FeatureUsage[];
    staff: { name: string; uses: number; costUsd: number }[];
    free: FreeUsage;
  } | null;
  /** Why the numbers could not be read, when they could not. */
  error: string | null;
};

/** Settings → AI helper: the switch, the limits and this month's use, for the admin. */
export async function loadAssistPanel(now = new Date()): Promise<AssistPanelData> {
  const configured = isAssistConfigured();
  const chains = describeChains(availableKeys(), process.env);
  try {
    const since = monthStartIst(now);
    // The free share is a nicety: without it (an older database) the rest of the page still shows.
    const [settings, usage, providers] = await Promise.all([getAssistSettings(), usageSince(since), usageByProvider(since).catch(() => [])]);
    const ids = usage.staff.map((s) => s.staffProfileId);
    const names = new Map<string, string>();
    if (ids.length) {
      const { data } = await createAdminClient().from("staff_profiles").select("id, display_name").in("id", ids);
      for (const row of (data ?? []) as { id: string; display_name: string }[]) names.set(row.id, row.display_name);
    }
    return {
      configured,
      chains,
      settings,
      month: {
        spentUsd: usage.features.reduce((sum, f) => sum + f.costUsd, 0),
        features: usage.features,
        staff: usage.staff.map((s) => ({ name: names.get(s.staffProfileId) ?? "—", uses: s.uses, costUsd: s.costUsd })),
        free: freeUsageOf(providers, process.env),
      },
      error: null,
    };
  } catch (error) {
    return { configured, chains, settings: null, month: null, error: error instanceof Error ? error.message : "unknown" };
  }
}
