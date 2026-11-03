import type { Metadata } from "next";
import { publicCertificateCheck, type PublicCheck } from "@/modules/certificates/data/repo";
import { maskName, verifyCodePattern } from "@/modules/certificates/domain/certificate";
import { dateLong } from "@/modules/certificates/domain/date-words";
import { schoolProfile } from "@/platform/config/school";
import { p, type Pair } from "@/vx/text";

/**
 * The page behind the QR on a school certificate. Anyone holding the paper can
 * confirm it is genuine and still current. Open by design: the code is 64
 * random bits frozen into one issue, and the database function returns only
 * status, number, kind, date and the name this page masks. No class,
 * parentage, birth date or profile. TEST documents are never vouched for.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Certificate verification", robots: { index: false, follow: false } };

const T = {
  title: p("Certificate verification", "प्रमाण पत्र सत्यापन"),
  valid: p("Genuine and current", "मान्य एवं वर्तमान"),
  handed: p("Genuine, signed and handed over", "मान्य, हस्ताक्षरित व सौंपा गया"),
  superseded: p("Replaced by a corrected copy", "सुधारी प्रति से प्रतिस्थापित"),
  cancelled: p("Cancelled by the school", "विद्यालय द्वारा रद्द"),
  unknown: p("Not a recognised certificate", "यह प्रमाण पत्र हमारे रिकॉर्ड में नहीं है"),
  unknownSub: p("Check the code, or contact the school office with the printed copy.", "कोड जाँचें या छपी प्रति के साथ विद्यालय कार्यालय से संपर्क करें।"),
  unavailable: p("Couldn't check right now", "अभी जाँच नहीं हो सकी"),
  unavailableSub: p("Try again in a few minutes, or contact the school office.", "कुछ देर बाद फिर कोशिश करें या विद्यालय कार्यालय से संपर्क करें।"),
  number: p("Certificate no.", "प्रमाण पत्र संख्या"), kind: p("Document", "प्रमाण पत्र"), date: p("Issued on", "जारी तिथि"), name: p("Issued to", "किसे जारी"),
  replacement: p("Current copy", "वर्तमान प्रति"), foot: p("This page shows only whether the document is genuine. It shows no other details about the student.", "यह पेज केवल दस्तावेज़ की प्रामाणिकता बताता है, विद्यार्थी का कोई अन्य विवरण नहीं।"),
};
const KINDS: Record<string, Pair> = { study: p("Study certificate", "अध्ययन प्रमाण पत्र"), character: p("Character certificate", "चरित्र प्रमाण पत्र"), dob: p("Date of birth certificate", "जन्म तिथि प्रमाण पत्र"), tc: p("Transfer certificate", "स्थानांतरण प्रमाण पत्र") };
const both = (pair: Pair) => `${pair.en} · ${pair.hi}`;

export default async function CertificateVerifyPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  let result: PublicCheck | null = null, failed = false;
  if (verifyCodePattern.test(code)) { try { result = await publicCertificateCheck(code); } catch { failed = true; } }
  const tone = !result ? (failed ? "warning" : "destructive") : result.status === "prepared" || result.status === "issued" ? "success" : "warning";
  const headline = failed ? T.unavailable : !result ? T.unknown : result.status === "issued" ? T.handed : result.status === "prepared" ? T.valid : result.status === "superseded" ? T.superseded : T.cancelled;
  return <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-4 py-10">
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">{result?.school || schoolProfile.name}</p>
      <h1 className="mt-1 text-lg font-semibold text-foreground">{both(T.title)}</h1>
      <div className={`mt-4 rounded-xl border px-4 py-3 ${tone === "success" ? "border-success/30 bg-success-soft" : tone === "warning" ? "border-warning/30 bg-warning-soft" : "border-destructive/30 bg-destructive-soft"}`}>
        <p className={`text-sm font-semibold ${tone === "success" ? "text-success-soft-foreground" : tone === "warning" ? "text-warning-soft-foreground" : "text-destructive-soft-foreground"}`}>{tone === "success" ? "✓ " : ""}{headline.en}</p>
        <p className="mt-0.5 text-sm" lang="hi">{headline.hi}</p>
        {!result ? <p className="mt-2 text-xs opacity-80">{both(failed ? T.unavailableSub : T.unknownSub)}</p> : null}
      </div>
      {result ? <dl className="mt-4 space-y-2 text-sm">
        {[[T.kind, both(KINDS[result.kind] ?? KINDS.study)], [T.number, result.serial], [T.date, dateLong(result.issuedOn, "en") ?? result.issuedOn], [T.name, maskName(result.studentName)], ...(result.supersededBy ? [[T.replacement, result.supersededBy] as const] : [])].map(([label, value]) =>
          <div key={(label as Pair).en} className="flex items-baseline justify-between gap-4"><dt className="text-muted-foreground">{both(label as Pair)}</dt><dd className="text-right font-semibold tabular-nums text-foreground">{value as string}</dd></div>)}
      </dl> : null}
      <p className="mt-5 text-[11px] leading-4 text-muted-foreground">{both(T.foot)}</p>
    </div>
  </main>;
}
