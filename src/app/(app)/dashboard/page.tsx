import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";

import { m } from "@/messages";
import { can } from "@/platform/auth/permissions";
import {
  getCurrentStaff,
  requirePermission,
} from "@/platform/auth/current-staff";
import { dayLabel, schoolToday, weekdayLabel } from "@/platform/dates";
import { pageTitle } from "@/platform/i18n/page-title";
import { navigationFor } from "@/platform/config/navigation";
import { appsFor, environmentLabel, schoolApp } from "@/platform/config/apps";
import { getVppsOneEnvironment } from "@/platform/env";
import { flat, primary, secondary, t } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { homeSummary, schoolOverview } from "@/modules/home/data/home-repo";
import {
  attentionFor,
  needsAttention,
} from "@/modules/home/domain/attention";
import { overviewRows } from "@/modules/home/domain/overview";
import {
  FeeLine,
  RoundProgress,
  SchoolWorkspaces,
  TodayAtSchool,
} from "@/modules/home/ui/overview-panels";
import { Card, DetailList, Notice, Section } from "@/ui/primitives";
import { PageHeader, StaffChip } from "@/ui/shell/app-shell";
import { HomeColumns, MetricCard, MetricGrid } from "@/ui/task-hero";

export const runtime = "nodejs";

export async function generateMetadata() {
  // `getCurrentStaff()` rather than `requirePermission()`: the page below does
  // the guarding, and a `redirect()` thrown from metadata generation would run
  // the same refusal twice for one request. Cached per request, so this is the
  // read the page has already made.
  const staff = await getCurrentStaff();
  return {
    title: await pageTitle(staff?.role === "admin" ? m.overviewTitle : m.welcome),
  };
}

/**
 * Home, for everybody whose home is not a classroom.
 *
 * **Exceptions with counts and owners** (PLAN §3), in the order each role
 * works. The owner is the load-bearing half: a number with no name beside it
 * is somebody else's problem to everybody who reads it, and the register that
 * has not come in belongs to a teacher rather than to whoever happens to have
 * the dashboard open.
 *
 * An administrator gets the same queue plus the **combined school overview**
 * the design package asks for: attendance, staff, cover, exams and the current
 * information round beside it, and the two other apps as workspaces rather
 * than as a launcher grid. It is one screen because the administrator's
 * question is "is the day going normally, and what needs me" — two screens
 * would make them ask it twice.
 *
 * Every count is real or absent. A read that failed renders a dash and says
 * so — a dashboard reporting a confident nought is the one wrong answer this
 * screen can give, and it is exactly the mistake D-93 records. The fee line is
 * the same rule applied to a source this app does not read yet: it carries no
 * amount at all rather than ₹0.
 */
export default async function DashboardPage() {
  const staff = await requirePermission("dashboard:view", "/dashboard");
  const language = staff.language;
  const destinations = navigationFor(staff.role).filter(
    (item) => item.href !== "/dashboard",
  );
  const apps = appsFor(staff.role);
  const isAdmin = staff.role === "admin";

  const today = schoolToday();
  const sessionLabel = await resolveSessionLabel();

  // Two reads rather than one: the overview is five more queries and only one
  // role renders it, so every other home stays the size it was.
  const [summary, overview] = await Promise.all([
    sessionLabel ? homeSummary(sessionLabel, today) : null,
    sessionLabel && isAdmin ? schoolOverview(sessionLabel, today) : null,
  ]);

  const attention = summary
    ? attentionFor(staff.role, summary.facts, {
        canMarkOnBehalf: can(staff, "attendance:mark_on_behalf"),
      })
    : [];

  const dayText = t(
    `${weekdayLabel(today).hi}, ${dayLabel(today).hi}`,
    `${weekdayLabel(today).en}, ${dayLabel(today).en}`,
  );

  /* -------------------------------------------------- needs attention */

  const attentionSection =
    attention.length > 0 ? (
      <Section title={m.homeNeedsAttention} language={language}>
        {needsAttention(attention) ? (
          <ul className="space-y-2">
            {attention.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className={
                    item.tone === "warning"
                      ? "focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 transition-colors hover:brightness-[0.98]"
                      : "focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                  }
                >
                  <span
                    aria-hidden
                    className="w-10 shrink-0 text-center text-[22px] font-semibold tabular-nums"
                  >
                    {/* A dash, never a nought: "nothing is outstanding" and
                        "the count could not be read" are different news. */}
                    {item.count ?? "—"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold text-foreground">
                      {primary(item.label, language)}
                      {item.detail ? (
                        <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">
                          {primary(item.detail, language)}
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-[12px] text-subtle-foreground">
                      {/* `primary`, not `flat`: a bilingual reader gets
                          one language on this line, because "Whose:
                          Academic coordinator" in two languages is wider
                          than a 360px phone and truncates to nothing
                          useful. */}
                      {item.count === null
                        ? primary(m.homeUnavailable, language)
                        : `${primary(m.homeOwner, language)}: ${primary(item.owner, language)}`}
                    </span>
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-5 shrink-0 text-subtle-foreground"
                  />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          // Five noughts is not an empty queue — it is five pieces of good
          // news, and the screen says so once rather than five times.
          <Notice tone="success" text={m.homeAllClear} language={language} />
        )}
      </Section>
    ) : null;

  /* ---------------------------------------------- the school, in figures */

  const viewerFigures =
    summary && staff.role === "view_only" ? (
      <Section className="mt-7" title={m.homeSchoolToday} language={language}>
        <MetricGrid>
          <MetricCard
            label={m.homeChildrenOnRoll}
            value={summary.school.childrenOnRoll?.toString() ?? "—"}
            language={language}
          />
          <MetricCard
            label={m.homeClasses}
            value={summary.school.classes?.toString() ?? "—"}
            language={language}
          />
          <MetricCard
            label={m.homeRegistersIn}
            value={summary.school.registersIn?.toString() ?? "—"}
            detail={
              summary.school.classes === null
                ? m.homeUnavailable
                : t(`${summary.school.classes} में से`, `of ${summary.school.classes}`)
            }
            language={language}
          />
        </MetricGrid>
      </Section>
    ) : null;

  /* ------------------------------------------------------ the workspaces */

  const workspaces =
    apps.length > 0 ? (
      <Section
        className="mt-7"
        title={isAdmin ? m.overviewWorkspaces : m.navApps}
        description={isAdmin ? m.overviewWorkspacesHint : m.appsIntro}
        language={language}
      >
        {isAdmin ? (
          <SchoolWorkspaces apps={apps} language={language} />
        ) : (
          // The other two apps, above the list of screens rather than inside
          // it. PLAN §5 R1: "put both original apps on office/admin home
          // immediately" — the office reaches for School Fees several times a
          // day. Each button says which host it opens; two of the three
          // hostnames a reader would guess belong to somebody else.
          <ul className="grid gap-2 sm:grid-cols-2">
            {apps.map((app) => (
              <li key={app.id}>
                <a
                  href={app.home.href}
                  className="focus-ring flex min-h-16 flex-col justify-center gap-0.5 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate text-[15px] font-semibold text-foreground">
                      {primary(app.name, language)}
                    </span>
                    <ExternalLink
                      aria-hidden
                      className="size-4 shrink-0 text-subtle-foreground"
                    />
                  </span>
                  <span className="truncate text-[12px] text-subtle-foreground">
                    {flat(environmentLabel(app.environment), language)} ·{" "}
                    {new URL(app.home.href).host}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Section>
    ) : null;

  /* ----------------------------------------------------- everything else */

  const openToYou =
    destinations.length > 0 ? (
      <Section
        className="mt-6"
        title={m.openToYou}
        description={m.openToYouHint}
        language={language}
      >
        <ul className="grid gap-2 sm:grid-cols-2">
          {destinations.map((item) => {
            const under = secondary(item.label, language);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="focus-ring flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 transition-colors hover:bg-surface-2"
                >
                  <span
                    aria-hidden
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-soft-foreground [&_svg]:size-5"
                  >
                    <item.icon />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-semibold text-foreground">
                      {primary(item.label, language)}
                    </span>
                    {under ? (
                      <span className="block truncate text-[12px] text-subtle-foreground">
                        {under}
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>
    ) : null;

  /**
   * Who is signed in.
   *
   * Kept for every role except the administrator, whose overview answers the
   * question this card was answering and whose name and role are now in the
   * top bar on a desk. A screen about the school should not open with a card
   * about the person reading it.
   */
  const whoCard = isAdmin ? null : (
    <Card className="mt-7 p-5">
      <StaffChip staff={staff} />
      <DetailList
        className="mt-4"
        language={language}
        items={[
          { label: m.email, value: staff.email ?? "—" },
          {
            label: m.shortName,
            value: <span className="font-mono text-[14px]">{staff.shortName}</span>,
          },
          {
            label: m.teaching,
            // flat(), not primary(): the label beside it shows both halves
            // for a bilingual reader, so the value would look truncated.
            value: flat(staff.isTeaching ? m.yes : m.no, language),
          },
        ]}
      />
    </Card>
  );

  const devNotice =
    getVppsOneEnvironment() === "dev" ? (
      <Notice
        className="mt-6"
        tone="warning"
        text={m.testDataNotice}
        language={language}
      />
    ) : null;

  /* ------------------------------------------------------------ the page */

  return (
    <>
      <PageHeader
        eyebrow={isAdmin ? m.overviewEyebrow : undefined}
        title={isAdmin ? m.overviewTitle : m.welcome}
        description={dayText}
        language={language}
      />

      <HomeColumns
        main={
          <>
            {attentionSection}
            {viewerFigures}
            {workspaces}
            {openToYou}
            {whoCard}
            {devNotice}
          </>
        }
        aside={
          // Only the administrator has a second column. Everybody else's home
          // is one list of their own work, and a supporting panel beside it
          // would be the school's business on somebody else's screen.
          overview ? (
            <>
              <TodayAtSchool
                rows={overviewRows(overview.facts)}
                day={flat(dayText, language)}
                language={language}
              />
              <RoundProgress
                round={overview.round}
                unavailable={overview.facts.roundUnavailable}
                language={language}
              />
              <FeeLine
                app={
                  apps.some((app) => app.id === "schoolfees")
                    ? schoolApp("schoolfees")
                    : null
                }
                language={language}
              />
            </>
          ) : undefined
        }
      />
    </>
  );
}
