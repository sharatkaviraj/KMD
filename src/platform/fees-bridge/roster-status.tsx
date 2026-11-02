import "server-only";

import type { Language } from "@/platform/i18n/language";
import { RosterStatusView } from "./roster-status-view";
import { readFeesBridgeHealth } from "./state";

/** Informational only: each data reader still enforces current bridge readiness. */
export async function RosterStatus({ language }: { language: Language }) {
  const health = await readFeesBridgeHealth().catch(() => ({ state: null, status: "error" as const }));
  return <RosterStatusView language={language} status={health.status} checkedAt={health.state?.last_checked_at} />;
}
