import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import type { ReactNode } from "react";

import { findGaps, isMonday, recentWeeks, uploadableWeek, weekDays } from "@/modules/toilets/domain/checks";
import { readToilets, type ToiletData } from "@/modules/toilets/data/read";
import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { schoolNow } from "@/platform/auth/qa-clock";
import { isTestSessionLabel } from "@/platform/auth/test-session-policy";
import { schoolToday } from "@/vx/format";
import { lead } from "@/vx/text";
import { ToiletsScreen } from "@/vx/screens/toilets/toilets-screen";
import { W } from "@/vx/screens/toilets/words";
import { Section, TopBar, VxPage } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";

export const runtime = "nodejs";

export const metadata = { title: "Toilet checks" };

type SP = Record<string, string | string[] | undefined>;

/**
 * Toilet checks (owner, 17 Nov 2026, D-652): every toilet checked twice a
 * day on a printed weekly chart, the filled chart photographed and uploaded
 * here, and what never came in shown first. `toilets:view` opens it;
 * `toilets:upload` adds Upload photo; `toilets:manage` the list of toilets,
 * the check times and the tick list.
 *
 * `?week=<Monday>` opens that week; `?upload=<toilet>&week=<Monday>` (the QR
 * code printed on every chart) opens the upload straight away.
 */
export default async function ToiletsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requirePermission("toilets:view", "/toilets");
  const sp = await searchParams;
  const session = await resolveSessionLabel();
  const language = staff.language;

  const shell = (body: ReactNode) => (
    <VxPage label={lead(W.title, language)}>
      <TopBar title={lead(W.title, language)} mBack="/menu" />
      <Section>{body}</Section>
    </VxPage>
  );

  if (!session) return shell(<EmptyState icon="calendar" title={lead(W.noSession, language)} body={lead(W.noSessionBody, language)} />);

  const today = schoolToday(await schoolNow(staff));
  const data: ToiletData | null = await readToilets(session, today).catch(() => null);
  if (!data) return shell(<EmptyState icon="alert" title={lead(W.couldNotLoad, language)} />);
  if (!data.ready) return shell(<EmptyState icon="clock" title={lead(W.notSetUp, language)} />);

  const weeks = recentWeeks(today);
  const askedWeek = typeof sp.week === "string" && isMonday(sp.week) && uploadableWeek(sp.week, today) ? sp.week : null;
  if (askedWeek && !weeks.includes(askedWeek)) weeks.push(askedWeek);
  // The days the school is shut in the weeks shown, so the phone draws "Closed" without asking again.
  const closedDays = weeks.flatMap((w) => weekDays(w)).filter((d) => !data.isOpen(d));
  const gaps = findGaps({ toilets: data.toilets, charts: data.charts, today, isOpen: data.isOpen });
  const canUpload = can(staff, "toilets:upload");
  const uploadFor = typeof sp.upload === "string" && canUpload && data.toilets.some((t) => t.id === sp.upload && !t.removedAt) ? sp.upload : null;

  // On the Sunday and Monday after a week the week to act on is the one just over; otherwise this one.
  const defaultWeek = gaps.dueToday[0]?.weekStart ?? weeks[0];

  return (
    <ToiletsScreen
      sessionLabel={session}
      test={isTestSessionLabel(session)}
      today={today}
      weeks={weeks}
      initialWeek={askedWeek ?? defaultWeek}
      toilets={data.toilets}
      charts={data.charts}
      settings={data.settings}
      closedDays={closedDays}
      gaps={{
        late: gaps.late.map((g) => ({ toiletId: g.toilet.id, weekStart: g.weekStart })),
        dueToday: gaps.dueToday.map((g) => ({ toiletId: g.toilet.id, weekStart: g.weekStart })),
        missedLastWeek: gaps.missedLastWeek.map((g) => ({ toiletId: g.toilet.id, weekStart: g.weekStart, count: g.missed.length })),
      }}
      canUpload={canUpload}
      canManage={can(staff, "toilets:manage")}
      openUpload={uploadFor && askedWeek ? { toiletId: uploadFor, weekStart: askedWeek } : null}
    />
  );
}
