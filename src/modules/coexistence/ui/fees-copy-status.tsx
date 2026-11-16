import "server-only";

import { ms } from "@/messages/setup";
import { readFeesCopyStatus } from "@/modules/coexistence/data/fees-copy";
import { flat, type Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";

/**
 * The shell's line while the Fees link is off (D-648): One's real year is a
 * copy of the Fees app taken each night, and a payment made in Fees today
 * shows here tomorrow. Says so, with when the last copy finished, in the
 * place the link's "roster updated" line used to sit, and in the same shape.
 * Informational only: it gates nothing.
 */
export async function FeesCopyStatus({ language }: { language: Language }) {
  const { freshness, finishedAt } = await readFeesCopyStatus();
  const when =
    finishedAt && Number.isFinite(Date.parse(finishedAt)) ? (
      <time dateTime={finishedAt}>
        {new Intl.DateTimeFormat(language === "hi" ? "hi-IN" : "en-IN", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "short" }).format(new Date(finishedAt))}
      </time>
    ) : null;
  if (freshness === "fresh") {
    return (
      <details className="vx-roster">
        <summary>
          <Ic n="checkCircle" size={15} />
          <span>{flat(ms.feesCopyFresh, language)}</span>
          <Ic n="chevDown" size={12} />
        </summary>
        <div className="vx-roster-detail">
          <p>{flat(ms.feesCopyFreshHelp, language)}</p>
          {when}
        </div>
      </details>
    );
  }
  return (
    <div role="status" className="vx-roster-warning">
      <Ic n="alert" size={16} />
      <span>
        {flat(freshness === "stale" ? ms.feesCopyStale : ms.feesCopyUnread, language)}
        {when}
      </span>
    </div>
  );
}
