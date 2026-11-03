import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import type { BridgeHealthStatus } from "./state";

export function RosterStatusView({ language, status, checkedAt }: { language: Language; status: BridgeHealthStatus; checkedAt?: string | null }) {
  const checkedTime = checkedAt && Number.isFinite(Date.parse(checkedAt))
    ? <time dateTime={checkedAt}>{new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }).format(new Date(checkedAt))}</time>
    : null;
  if (status === "ready") {
    return <details className="vx-roster">
      <summary><Ic n="checkCircle" size={15} /><span>{flat({ en: "Roster updated", hi: "सूची अपडेट है" }, language)}</span><Ic n="chevDown" size={12} /></summary>
      <div className="vx-roster-detail"><p>{flat(ms.bridgeRosterReady, language)}</p>{checkedTime}</div>
    </details>;
  }
  return <div role="status" className="vx-roster-warning">
    <Ic n="alert" size={16} />
    <span>{flat(status === "stale" ? ms.bridgeRosterStale : status === "error" ? ms.bridgeRosterError : ms.bridgeRosterPending, language)}{checkedTime}</span>
  </div>;
}
