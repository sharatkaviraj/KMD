import { getViewSessionCookie } from "@/modules/fees/platform/session-context/cookie";
import { resolveViewSession } from "@/modules/fees/platform/session-context/resolver";
import { getReportsPageData } from "@/modules/reports/vx/reports-page-data";
import type { CollectionPreset, ReportsSheet, ReportsView } from "@/modules/reports/vx/types";
import { requirePermission } from "@/platform/auth/current-staff";
import { schoolProfile } from "@/platform/config/school";
import { schoolToday } from "@/vx/format";
import { Reports } from "@/vx/screens/reports/reports";
import { getViewer } from "@/vx/view-as";

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
  await requirePermission("fees:view", "/reports");
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
  });

  return <Reports data={data} initialSheet={sheet} initialLeft={one(sp.left) === "1"} readOnly={Boolean(previewing)} />;
}
