import Link from "@/ui/link";

import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { Ic } from "@/vx/icons";

export function LedgerNotice({ language }: { language: Language }) {
  return <details className="vx-ledger-notice">
    <summary><Ic n="info" size={16} /><span>{flat(ms.bridgeLedgerShort, language)}</span><Ic n="chevDown" size={14} /></summary>
    <div><p>{flat(ms.bridgeLedger, language)}</p><nav>
      <Link href="/payments" className="tap vx-lnk">{flat(ms.bridgeTitle, language)}<Ic n="chevRight" size={14} /></Link>
      <Link href="/dues" className="tap vx-lnk">{flat(ms.bridgeDuesOnly, language)}<Ic n="chevRight" size={14} /></Link>
    </nav></div>
  </details>;
}
