import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { requirePermission } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { AiReport, type AiReportPart } from "@/vx/screens/reports/ai-report";
import { p } from "@/vx/text";

export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;

/**
 * Reports → AI report: one file with everything One and Fees hold for the
 * viewed year, to give to ChatGPT (owner, 7 Nov 2026). `reports:ai` is the
 * administrator's alone until Staff → Roles gives it to someone else. The
 * page only explains and starts the download; the parts come from
 * `/api/reports/ai/{school,fees,photos}`, which check everything again.
 */
export default async function AiReportPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("reports:ai", "/reports/ai");
  const sp = await searchParams;
  const session = await resolveViewSession({ searchParamSession: sp.session, cookieSession: await getViewSessionCookie() });
  const live = /^\d{4}-\d{2}$/.test(session.sessionLabel) && usesCanonicalFees(staff, session.sessionLabel);

  const fees: AiReportPart = !can(staff, "fees:reports")
    ? { ok: false, reason: p("Not for this account: it needs \"See fee reports\" on Staff → Roles.", "इस खाते के लिए नहीं: इसके लिए स्टाफ़ → भूमिकाएँ में \"फीस रिपोर्ट देखें\" चाहिए।") }
    : live || isTestSessionLabel(session.sessionLabel)
      ? { ok: true }
      : { ok: false, reason: p("The Fees connection is not available for this year here.", "इस सत्र के लिए यहाँ फीस ऐप का कनेक्शन उपलब्ध नहीं है।") };
  const photos: AiReportPart = !can(staff, "students:view")
    ? { ok: false, reason: p("Not for this account: it cannot see students.", "इस खाते के लिए नहीं: यह विद्यार्थी नहीं देख सकता।") }
    : live
      ? { ok: true }
      : { ok: false, reason: p("Photographs are kept in the Fees app and come only with the real year.", "फ़ोटो फीस ऐप में रहती हैं और केवल असली सत्र के साथ आती हैं।") };

  return <AiReport sessionLabel={session.sessionLabel} madeBy={staff.displayName} schoolWide={readsEveryClass(staff)} fees={fees} photos={photos} />;
}
