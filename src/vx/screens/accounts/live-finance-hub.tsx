import Link from "@/ui/link";
import { ms } from "@/messages/setup";
import { flat, type Language } from "@/platform/i18n/language";
import { feesBridgeOfficeReads } from "@/platform/fees-bridge/policy";
import { notInOneHref } from "@/platform/fees-bridge/not-in-one";

/**
 * The accountant stays in One. Receipts, Dues & calls and Fee setup are One's
 * own screens, read live from Fees; a tool One does not have yet says so on
 * One's own page, never a link to the Fees app (owner, 6 Nov 2026).
 */
export function LiveFinanceHub({language,receiptsHere=feesBridgeOfficeReads(),reportsHere=true}:{language:Language;receiptsHere?:boolean;/** `fees:reports` (D-476): off, the Reports card is not drawn. */reportsHere?:boolean}) {
  const links=[
    {label:ms.bridgeTitle,href:"/payments",here:true},
    {label:ms.bridgeReceipts,href:receiptsHere?"/receipts":notInOneHref("/receipts"),here:receiptsHere},
    {label:ms.bridgeDuesOnly,href:"/dues",here:true},
    {label:ms.bridgeFeeSetup,href:"/fee-setup",here:true},
    ...(reportsHere?[{label:ms.bridgeReports,href:"/reports",here:true}]:[]),
    {label:ms.bridgeBooks,href:notInOneHref("/accounts/books"),here:false},
  ];
  return <section className="mx-auto max-w-3xl space-y-5 px-4 py-6"><h1 className="text-2xl font-semibold">{flat(ms.bridgeFinance,language)}</h1><p className="text-sm text-slate-600">{flat(ms.bridgeLedger,language)}</p><nav className="grid gap-3 sm:grid-cols-2">{links.map(link=><Link key={link.href} href={link.href} className="rounded-xl border border-slate-200 p-5 font-medium hover:bg-slate-50">{flat(link.label,language)}{!link.here&&<span className="mt-2 block text-xs font-normal text-slate-500">{flat(ms.bridgeNotYet,language)}</span>}</Link>)}</nav></section>;
}
