import Link from "next/link";
import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { FEES_ORIGIN } from "@/platform/fees-bridge/policy";

/** The accountant stays in One; each current financial tool names its destination. */
export function LiveFinanceHub({language}:{language:Language}) {
  const links=[
    {label:ms.bridgeTitle,href:"/payments"},
    {label:ms.bridgeReceipts,href:`${FEES_ORIGIN}/protected/receipts`},
    {label:ms.bridgeReports,href:`${FEES_ORIGIN}/protected/reports`},
    {label:ms.bridgeDues,href:`${FEES_ORIGIN}/protected/defaulters`},
    {label:ms.bridgeBooks,href:`${FEES_ORIGIN}/protected/finance-controls`},
  ];
  return <section className="mx-auto max-w-3xl space-y-5 px-4 py-6"><h1 className="text-2xl font-semibold">{flat(ms.bridgeFinance,language)}</h1><p className="text-sm text-slate-600">{flat(ms.bridgeLedger,language)}</p><nav className="grid gap-3 sm:grid-cols-2">{links.map(link=><Link key={link.href} href={link.href} className="rounded-xl border border-slate-200 p-5 font-medium hover:bg-slate-50">{flat(link.label,language)}{link.href.startsWith(FEES_ORIGIN)&&<span className="mt-2 block text-xs font-normal text-slate-500">{flat(ms.bridgeOpenFees,language)}</span>}</Link>)}</nav></section>;
}
