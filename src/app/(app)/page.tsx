import { redirect } from "next/navigation";

import { requirePermission } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { resolveStart } from "@/platform/config/start";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { pendingMoneyRequests, todayMoney } from "@/modules/dashboard/vx/admin-today";
import { longDay, schoolToday } from "@/vx/format";
import { MENU_HOME } from "@/vx/nav";
import { boardSummary, runningPeriod, schoolMinutes, sortInbox } from "@/vx/screens/admin/logic";
import { loadInbox, loadToday } from "@/vx/screens/admin/data";
import { T } from "@/vx/screens/admin/text";
import { TodayScreen, type TodayProps } from "@/vx/screens/admin/today";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { EmptyState } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

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

  if (menu !== "admin") {
    const chosen = previewing ? null : resolveStart(staff.role, staff.preferredStart)?.href;
    redirect(chosen && chosen !== "/" ? chosen : MENU_HOME[menu]);
  }

  await requirePermission("dashboard:view", "/");
  const language = staff.language;
  const today = schoolToday();
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
  const [facts, money, inbox] = await Promise.all([
    loadToday(staff, sessionLabel, today, schoolMinutes()),
    seesMoney ? todayMoney(today).catch(() => null) : Promise.resolve(null),
    can(staff, "attendance:correct")
      ? loadInbox(staff, sessionLabel, today, { refunds: seesMoney ? pendingMoneyRequests : undefined })
      : Promise.resolve(null),
  ]);

  const board = facts.board;
  const summary = board ? boardSummary(board.rows, board.halfDayCredit) : null;
  const running = board ? runningPeriod(board.bells, schoolMinutes()) : null;
  const firstStart = board?.bells.length ? [...board.bells].sort((a, b) => a.starts.localeCompare(b.starts))[0].starts : null;
  const status = !board
    ? null
    : !board.schoolOpen
      ? T.schoolClosed
      : running
        ? running.state === "running"
          ? T.periodRunning(running.number)
          : T.periodBreak(running.number)
        : firstStart && new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false }) < firstStart
          ? T.beforeSchool
          : T.dayOver;

  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).format(new Date()));
  const greeting = hour < 12 ? T.greetMorning : hour < 17 ? T.greetAfternoon : T.greetEvening;

  const actions: TodayProps["actions"] = [
    can(staff, "fees:collect") ? { key: "collect", label: T.qaCollect, icon: "rupee" as const, href: "/payments" } : null,
    can(staff, "attendance:mark_on_behalf") ? { key: "mark", label: T.qaMark, icon: "calCheck" as const, href: "/attendance" } : null,
    can(staff, "students:view") ? { key: "find", label: T.qaFind, icon: "search" as const, href: "/students" } : null,
    can(staff, "attendance:correct") ? { key: "inbox", label: T.qaInbox, icon: "inbox" as const, href: "/inbox" } : null,
    can(staff, "messages:send") ? { key: "notice", label: T.qaNotice, icon: "megaphone" as const, href: "/messages" } : null,
    can(staff, "substitutions:manage") ? { key: "cover", label: T.qaCover, icon: "swap" as const, href: "/substitutions" } : null,
  ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return (
    <VxPage label={lead(T.today, language)}>
      <TodayScreen
        firstName={staff.displayName.split(/\s+/)[0] ?? staff.displayName}
        greeting={greeting}
        dayLine={longDay(today)}
        status={status}
        today={today}
        money={money}
        moneyFailed={seesMoney && money === null}
        attendance={board && summary ? { marked: summary.marked, total: summary.total, percent: summary.percent, schoolOpen: board.schoolOpen } : null}
        staffAway={facts.staffAway}
        cover={facts.cover}
        inbox={inbox ? sortInbox(inbox.items) : null}
        timeline={facts.timeline}
        actions={actions}
        unavailable={facts.unavailable.length > 0 || (inbox?.unavailable.length ?? 0) > 0}
      />
    </VxPage>
  );
}
