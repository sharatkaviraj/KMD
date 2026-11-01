import "server-only";

import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { readFeesBridgeHealth } from "./state";

/** Informational only: each data reader still enforces current bridge readiness. */
export async function RosterStatus({ language }: { language: Language }) {
  const health = await readFeesBridgeHealth().catch(() => ({ state: null, status: "error" as const }));
  return <div role="status" className={`mx-4 mt-3 rounded-lg px-3 py-2 text-xs ${health.status === "ready" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}>
    {flat(health.status === "ready" ? ms.bridgeRosterReady : health.status === "stale" ? ms.bridgeRosterStale : health.status === "error" ? ms.bridgeRosterError : ms.bridgeRosterPending, language)}
    {health.state?.last_checked_at && Number.isFinite(Date.parse(health.state.last_checked_at)) && <span className="ml-2">{new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }).format(new Date(health.state.last_checked_at))}</span>}
  </div>;
}
