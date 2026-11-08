import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import type { BridgeHealthStatus } from "./state";
import { LazyRefreshRosterButton } from "./lazy-refresh-roster-button";

export function RosterStatusView({ language, status, checkedAt, canRefresh = false, catchUpPhotos = false }: { language: Language; status: BridgeHealthStatus; checkedAt?: string | null; canRefresh?: boolean; catchUpPhotos?: boolean }) {
  // A real admin's open of One also carries the teachers' photo copy on (D-555):
  // whenever that is asked for, the button is drawn too.
  const refresh = canRefresh ? <LazyRefreshRosterButton language={language} catchUp={catchUpPhotos} /> : null;
  const checkedTime = checkedAt && Number.isFinite(Date.parse(checkedAt))
    ? <time dateTime={checkedAt}>{new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }).format(new Date(checkedAt))}</time>
    : null;
  if (status === "ready") {
    return <details className="vx-roster">
      <summary><Ic n="checkCircle" size={15} /><span>{flat({ en: "Roster updated", hi: "सूची अपडेट है" }, language)}</span><Ic n="chevDown" size={12} /></summary>
      <div className="vx-roster-detail"><p>{flat(ms.bridgeRosterReady, language)}</p>{checkedTime}{refresh}</div>
    </details>;
  }
  return <div role="status" className="vx-roster-warning">
    <Ic n="alert" size={16} />
    <span>{flat(status === "stale" ? ms.bridgeRosterStale : status === "error" ? ms.bridgeRosterError : ms.bridgeRosterPending, language)}{checkedTime}</span>
    {status === "not_ready" ? null : refresh}
  </div>;
}
