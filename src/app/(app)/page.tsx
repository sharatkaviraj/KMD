import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SchoolOfficeAttention } from "@/vx/screens/school-office/attention";

import { requirePermission } from "@/platform/auth/current-staff";
import { can, readsEveryClass } from "@/platform/auth/permissions";
import { schoolNow } from "@/platform/auth/qa-clock";
import { rootRedirectFor } from "@/vx/home-redirect";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { todayMoney } from "@/modules/dashboard/vx/admin-today";
import { initials, longDay, schoolToday } from "@/vx/format";
import { QUICK_ACTIONS } from "@/vx/nav";
import { boardSummary, runningPeriod, schoolMinutes, sortInbox } from "@/vx/screens/admin/logic";
import { loadInbox, loadToday, moneyRequestsFor, promisedToday, weekAttendance } from "@/vx/screens/admin/data";
import { T } from "@/vx/screens/admin/text";
import { TodayScreen, type TodayProps } from "@/vx/screens/admin/today";
import { dayPercent } from "@/vx/screens/admin/today-logic";
import { TD } from "@/vx/screens/admin/today-text";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { menuRoleLabel } from "@/vx/shell/role-line";
import { getViewer } from "@/vx/view-as";
import { feesBridgeOfficeReads, usesCanonicalFees } from "@/platform/fees-bridge/policy";
import { getBridgeTodaySummary } from "@/platform/fees-bridge/client";
import { FeesBridgeError } from "@/platform/fees-bridge/transport";
import { feePermissionsFor } from "@/platform/auth/fee-roles";
import { LedgerNotice } from "@/vx/shell/ledger-notice";
import { sessionText } from "@/platform/helpers/session-text";

export const runtime = "nodejs";

export const metadata = { title: "Today" };

/**
 * `/` — the admin's Today (P5, design F01/Desktop).
 *
 * Every other menu is sent to its own home, unless the person chose a start
 * screen — which is honoured here as it was by the old doorway, except while
 * an administrator is previewing another role. The office and the view-only
 * account share the admin menu and see this page filtered by permission:
 * money only with `fees:view`, the queue only with `attendance:correct`.
 */
export default async function TodayPage() {
  const { staff, menu, previewing } = await getViewer();

  // The proxy usually does this before rendering, from the shell's home hint;
  // this is the same rule for the first open and for a fresh browser.
  const elsewhere = rootRedirectFor({ menu, previewing, staff });
  if (elsewhere) redirect(elsewhere);

  await requirePermission("dashboard:view", "/");
  const language = staff.language;
  // Real time for everyone; a QA account may be shown a set time (D-269).
  const now = await schoolNow(staff);
  const today = schoolToday(now);
  const minutes = schoolMinutes(now);
  const sessionLabel = await resolveSessionLabel();

  if (!sessionLabel) {
    return (
      <VxPage>
        <TopBar title={lead(T.today, language)} />
        <main>
          <Section>
            <EmptyState icon="calendar" title={lead(T.noSession, language)} />
          </Section>
        </main>
      </VxPage>
    );
  }

  const seesMoney = can(staff, "fees:view");
  const canonicalMoney = usesCanonicalFees(staff, sessionLabel);
  // Under the live connection, today's figures are Fees' own Dashboard numbers (review T02).
  // Only for a role whose Fees counterpart sees the Dashboard; a Fees refusal hides the card rather than failing it.
  const feesToday = seesMoney && canonicalMoney && feesBridgeOfficeReads() && feePermissionsFor(staff.role).includes("dashboard:view")
    ? getBridgeTodaySummary(sessionLabel).then(
        (s) => ({ total: s.totalCollected, count: s.receiptCount, byMode: s.byMode.map((m) => ({ label: m.paymentModeLabel, amount: m.amount, count: m.receiptCount })), asOf: s.asOf }),
        (error: unknown) => (error instanceof FeesBridgeError && error.code === "forbidden" ? null : ("failed" as const)),
      )
    : Promise.resolve(null);
  const [facts, fees, inbox, week, ledgerToday] = await Promise.all([
    loadToday(staff, sessionLabel, today, minutes),
    seesMoney && !canonicalMoney
      ? todayMoney(today)
          // Promises are counted in the fee session the money figures come from.
          .then(async (figures) => ({ figures, promised: await promisedToday(figures.sessionLabel, today).catch(() => null) }))
          .catch(() => null)
      : Promise.resolve(null),
    can(staff, "attendance:correct")
      ? loadInbox(staff, sessionLabel, today, { refunds: moneyRequestsFor(staff, sessionLabel), nowMinutes: minutes })
      : Promise.resolve(null),
    can(staff, "attendance:view") && readsEveryClass(staff) ? weekAttendance(sessionLabel, today).catch(() => null) : Promise.resolve(null),
    feesToday,
  ]);
  const money = fees?.figures ?? null;
  const promised = fees?.promised ?? null;

  const board = facts.board;
  const summary = board ? boardSummary(board.rows, board.halfDayCredit) : null;
  const running = board ? runningPeriod(board.bells, minutes) : null;
  const firstStart = board?.bells.length ? [...board.bells].sort((a, b) => a.starts.localeCompare(b.starts))[0].starts : null;
  const status = !board
    ? null
    : !board.schoolOpen
      ? T.schoolClosed
      : running
        ? running.state === "running"
          ? T.periodRunning(running.number)
          : T.periodBreak(running.number)
        : firstStart && now.toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }) < firstStart
          ? T.beforeSchool
          : T.dayOver;

  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(now));
  const greeting = hour < 12 ? T.greetMorning : hour < 17 ? T.greetAfternoon : T.greetEvening;

  // The design's "+ New" menu and the phone's quick actions: the shell's own
  // list (the bottom bar's centre button opens the same), each behind its permission.
  const actions: TodayProps["actions"] = QUICK_ACTIONS.filter((q) => can(staff, q.permission)).map((q) => ({
    key: q.key,
    label: q.label,
    icon: q.icon,
    href: q.href,
    tone: q.tone,
  }));
  const credit = board?.halfDayCredit ?? 0.5;
  const session = sessionText(sessionLabel);

  return (
    <VxPage label={lead(T.today, language)}>
      <TodayScreen
        notice={seesMoney && canonicalMoney ? <LedgerNotice language={language} /> : null}
        officeWork={<Suspense fallback={null}><SchoolOfficeAttention sessionLabel={sessionLabel} /></Suspense>}
        firstName={staff.displayName.split(/\s+/)[0] ?? staff.displayName}
        greeting={greeting}
        dayLine={longDay(today)}
        status={status}
        today={today}
        beforeNoon={minutes < 12 * 60}
        money={money}
        // Under the Fees connection the local money read is never attempted, so its
        // absence is not a failure (review T02): the ledger notice says where the figures live.
        moneyFailed={seesMoney && !canonicalMoney && money === null}
        ledgerToday={ledgerToday}
        attendance={board && summary ? { marked: summary.marked, total: summary.total, percent: summary.percent, schoolOpen: board.schoolOpen } : null}
        staffAway={facts.staffAway}
        cover={facts.cover}
        inbox={inbox ? sortInbox(inbox.items) : null}
        inboxMissing={inbox?.unavailable ?? []}
        todayMissing={facts.unavailable}
        timeline={facts.timeline}
        schedule={facts.schedule}
        scheduleFailed={facts.scheduleFailed}
        exceptions={facts.exceptions}
        support={facts.support}
        actions={actions}
        links={{
          collect: can(staff, "fees:collect"),
          reports: can(staff, "fees:reports"),
          attendance: can(staff, "attendance:mark_on_behalf"),
          substitutions: can(staff, "substitutions:view"),
          review: can(staff, "collection:manage"),
          timetable: can(staff, "timetable:view"),
        }}
        unavailable={facts.unavailable.length > 0 || (inbox?.unavailable.length ?? 0) > 0}
        roleLine={TD.sessionLine(menuRoleLabel(menu, staff.role, previewing), session)}
        me={{ initials: initials(staff.displayName), href: can(staff, "settings:manage") ? "/settings" : "/preferences" }}
        week={week ? week.map((row) => ({ day: row.day, percent: row.tally ? dayPercent(row.tally, credit) : null })) : null}
        promisedToday={promised}
      />
    </VxPage>
  );
}
