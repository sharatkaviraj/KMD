import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { dayBookClosure } from "@/modules/receipts/vx/domain/day-close";
import { getReportsPageData } from "@/modules/reports/vx/reports-page-data";
import type { CollectionPreset, ReportsSheet, ReportsView } from "@/modules/reports/vx/types";
import { requirePermission } from "@/platform/auth/current-staff";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { can } from "@/platform/auth/permissions";
import { schoolProfile } from "@/platform/config/school";
import { schoolToday } from "@/vx/format";
import { listCloseEvents } from "@/vx/screens/receipts/data";
import { Reports } from "@/vx/screens/reports/reports";
import { getViewer } from "@/vx/view-as";
import { usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { FeesScreenUnavailable, LiveFromFees } from "@/vx/ui/live-fees";
import { p } from "@/vx/text";

const TITLE = p("Reports", "रिपोर्ट");

export const runtime = "nodejs";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "");

/**
 * Reports: the hub (search + pins), daily collection, the printable defaulter
 * list and sending it to class teachers, pending by class with its cells,
 * the day book, export, and scheduled sends. Every state is a URL:
 * `?view=collection|defaulters|send|classwise|cell|daybook|export|schedule|newsch`.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("fees:reports", "/reports");
  const { previewing } = await getViewer();
  const sp = await searchParams;
  const session = await resolveViewSession({ searchParamSession: sp.session, cookieSession: await getViewSessionCookie() });

  const asked = one(sp.view);
  let sheet: ReportsSheet = (["send", "export", "newsch"] as const).find((s) => s === one(sp.sheet)) ?? "";
  let view: ReportsView = (["hub", "collection", "defaulters", "classwise", "daybook", "schedule"] as const).find((v) => v === asked) ?? "hub";
  // The design's start states that are a sheet or a panel over another view.
  if (asked === "send") [view, sheet] = ["defaulters", "send"];
  if (asked === "export") [view, sheet] = ["collection", "export"];
  if (asked === "newsch") [view, sheet] = ["schedule", "newsch"];
  if (asked === "cell") view = "classwise";

  const rangeAsked = one(sp.range);
  const preset: CollectionPreset = rangeAsked === "last" || rangeAsked === "session" || rangeAsked === "custom" ? rangeAsked : "month";
  const inst = Number.parseInt(one(sp.inst), 10);

  // Real staff on a real session read Fees itself (7 Nov 2026); TEST sessions
  // and test accounts keep One's fee copy. Never the copy's numbers instead.
  const live = /^\d{4}-\d{2}$/.test(session.sessionLabel) && usesCanonicalFees(staff, session.sessionLabel);
  const detailed = feePermissionsFor(staff.role).includes("reports:view");
  const data = await getReportsPageData({
    view,
    sheet,
    today: schoolToday(),
    sessionLabel: session.sessionLabel,
    schoolName: schoolProfile.name,
    preset,
    from: one(sp.from) || undefined,
    to: one(sp.to) || undefined,
    date: one(sp.date) || undefined,
    cellClass: one(sp.class) || (asked === "cell" ? "*" : undefined),
    cellInst: Number.isFinite(inst) && inst > 0 ? inst : undefined,
    live,
  }).catch((error: unknown) => {
    if (live) return null;
    throw error;
  });
  if (!data) return <FeesScreenUnavailable title={TITLE} crumb={session.sessionLabel} />;

  // The Day book says what Receipts says about the close (accountant B5).
  // From Fees, the close Fees reports is already the canonical one.
  if (data.daybook && !live) {
    const events = await listCloseEvents(data.daybook.date, data.daybook.date, { sessionLabel: session.sessionLabel }).catch(() => []);
    data.daybook = { ...data.daybook, closure: dayBookClosure(data.daybook.closure, events) };
  }

  return (
    <Reports
      data={data}
      initialSheet={sheet}
      initialLeft={one(sp.left) === "1"}
      readOnly={Boolean(previewing)}
      detailed={detailed}
      aiReport={can(staff, "reports:ai")}
      notice={data.liveAsOf ? <LiveFromFees asOf={data.liveAsOf} /> : null}
    />
  );
}
