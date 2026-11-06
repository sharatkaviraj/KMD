import Link from "@/ui/link";

import { ms } from "@/messages/setup";
import { FEES_ORIGIN } from "@/platform/fees-bridge/policy";
import { flat, type Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";

export function LedgerNotice({ language }: { language: Language }) {
  return <details className="vx-ledger-notice">
    <summary><Ic n="info" size={16} /><span>{flat(ms.bridgeLedgerShort, language)}</span><Ic n="chevDown" size={14} /></summary>
    <div><p>{flat(ms.bridgeLedger, language)}</p><nav>
      <Link href="/payments" className="tap vx-lnk">{flat(ms.bridgeTitle, language)}<Ic n="chevRight" size={14} /></Link>
      <a href={`${FEES_ORIGIN}/protected/dashboard`} className="tap vx-lnk">{flat(ms.bridgeOpenFees, language)}<Ic n="chevRight" size={14} /></a>
    </nav></div>
  </details>;
}
