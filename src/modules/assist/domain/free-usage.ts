import { costUsd } from "./cost";
import { FREE_PROVIDERS, TASK_TIER, tierModels, type AssistProvider } from "./routes";
import type { AssistTaskId } from "./tasks";

/** One month's drafts for one provider and task, as `assist_usage_by_provider` returns them. */
export type ProviderDrafts = {
  /** Null on rows written before the provider was logged (7 Nov 2026). */
  provider: AssistProvider | null;
  task: string;
  drafts: number;
  inputTokens: number;
  outputTokens: number;
};

export type FreeUsage = {
  /** Drafts the free models wrote this month. */
  drafts: number;
  /** Every draft this month, free or paid. */
  all: number;
  /** What the free drafts would have cost on the tier's Claude model, by their tokens: an estimate. */
  savedUsd: number;
  /** Drafts per provider, most first. */
  providers: { provider: AssistProvider; drafts: number }[];
};

/**
 * The free models' share of this month's drafts, and roughly what they saved
 * (D-496): each free draft's tokens priced at the Claude model its task would
 * otherwise have started on. Pure.
 */
export function freeUsageOf(rows: readonly ProviderDrafts[], env: Readonly<Record<string, string | undefined>> = {}): FreeUsage {
  const models = tierModels(env);
  const perProvider = new Map<AssistProvider, number>();
  let drafts = 0;
  let all = 0;
  let savedUsd = 0;
  for (const row of rows) {
    all += row.drafts;
    if (row.provider) perProvider.set(row.provider, (perProvider.get(row.provider) ?? 0) + row.drafts);
    if (!row.provider || !FREE_PROVIDERS.has(row.provider)) continue;
    drafts += row.drafts;
    const tier = TASK_TIER[row.task as AssistTaskId];
    if (tier) savedUsd += costUsd(models[tier].claude, { input_tokens: row.inputTokens, output_tokens: row.outputTokens });
  }
  return {
    drafts,
    all,
    savedUsd: Math.round(savedUsd * 1_000_000) / 1_000_000,
    providers: [...perProvider].map(([provider, n]) => ({ provider, drafts: n })).sort((a, b) => b.drafts - a.drafts),
  };
}
