import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";
import type { BridgeHealthStatus } from "./state";
import { PhotoCatchUp } from "./photo-catch-up";
import { RefreshRosterButton } from "./refresh-roster-button";

export function RosterStatusView({ language, status, checkedAt, canRefresh = false, catchUpPhotos = false }: { language: Language; status: BridgeHealthStatus; checkedAt?: string | null; canRefresh?: boolean; catchUpPhotos?: boolean }) {
  const refresh = canRefresh ? <RefreshRosterButton language={language} /> : null;
  // A real admin's open of One carries the teachers' photo copy on (8 Nov 2026).
  const catchUp = catchUpPhotos ? <PhotoCatchUp /> : null;
  const checkedTime = checkedAt && Number.isFinite(Date.parse(checkedAt))
    ? <time dateTime={checkedAt}>{new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }).format(new Date(checkedAt))}</time>
    : null;
  if (status === "ready") {
    return <>{catchUp}<details className="vx-roster">
      <summary><Ic n="checkCircle" size={15} /><span>{flat({ en: "Roster updated", hi: "सूची अपडेट है" }, language)}</span><Ic n="chevDown" size={12} /></summary>
      <div className="vx-roster-detail"><p>{flat(ms.bridgeRosterReady, language)}</p>{checkedTime}{refresh}</div>
    </details></>;
  }
  return <>{catchUp}<div role="status" className="vx-roster-warning">
    <Ic n="alert" size={16} />
    <span>{flat(status === "stale" ? ms.bridgeRosterStale : status === "error" ? ms.bridgeRosterError : ms.bridgeRosterPending, language)}{checkedTime}</span>
    {status === "not_ready" ? null : refresh}
  </div></>;
}
