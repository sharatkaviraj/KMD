import { ExternalLink } from "lucide-react";

import { m } from "@/messages";
import { can, type StaffRole } from "@/platform/auth/permissions";
import {
  getCurrentStaff,
  requirePermission,
} from "@/platform/auth/current-staff";
import { dayLabel, schoolToday, weekdayLabel } from "@/platform/dates";
import { pageTitle } from "@/platform/i18n/page-title";
import { allowedFor, navigationFor } from "@/platform/config/navigation";
import { schoolProfile } from "@/platform/config/school";
import { appsFor, environmentLabel } from "@/platform/config/apps";
import { getVppsOneEnvironment } from "@/platform/env";
import {
  flat,
  primary,
  secondary,
  t,
  type Localized,
} from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { homeSummary, schoolOverview } from "@/modules/home/data/home-repo";
import {
  attentionFor,
  needsAttention,
} from "@/modules/home/domain/attention";
import { overviewRows } from "@/modules/home/domain/overview";
import { AdminOverview } from "@/modules/home/ui/admin-overview";
import {
  FeeLine,
  RoundProgress,
  SchoolWorkspaces,
  TodayAtSchool,
} from "@/modules/home/ui/overview-panels";
import { Panel, PanelRow } from "@/ui/panel";
import { Card, DetailList, Notice, Section } from "@/ui/primitives";
import { PageHeader, StaffChip } from "@/ui/page-header-localized";
import { HomeColumns, MetricCard, MetricGrid } from "@/ui/task-hero";

export const runtime = "nodejs";

/**
 * What sits above the title on each role's home.
 *
 * One per role rather than one per screen: the atlas uses the eyebrow to say
 * which desk you are at, and a teacher who lands here (she may — it is simply
 * not where she starts) is still looking at her own day's context.
 */
const EYEBROW: Record<StaffRole, Localized> = {
  admin: m.overviewEyebrow,
  office: m.eyebrowSchoolOffice,
  accountant: m.eyebrowFees,
  fee_collector: m.eyebrowFees,
  academic_coordinator: m.eyebrowCover,
  exam_coordinator: m.eyebrowExams,
  teacher: m.eyebrowMyClass,
  view_only: m.overviewEyebrow,
};

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

  if (isAdmin) {
    return <AdminOverview attention={attention} overview={overview} apps={apps}
      overviewCounts={{ children: summary?.school.childrenOnRoll ?? null, classes: summary?.school.classes ?? null, registers: summary?.school.registersIn ?? null }}
      destinations={allowedFor(staff.role).filter(item => item.href !== "/dashboard")} day={dayText} language={language}
      testData={getVppsOneEnvironment() === "dev"} schoolName={schoolProfile.name} />;
  }

  /* -------------------------------------------------- needs attention */

  const attentionSection =
    attention.length > 0 ? (
      needsAttention(attention) ? (
        <Panel
          title={m.homeNeedsAttention}
          description={m.homeNeedsAttentionHint}
          language={language}
        >
          {attention.map((item) => (
            <PanelRow
              key={item.key}
              href={item.href}
              tone={item.tone === "warning" ? "warning" : "neutral"}
              // A dash, never a nought: "nothing is outstanding" and "the
              // count could not be read" are different news.
              lead={
                <span className="text-[17px] font-bold">{item.count ?? "—"}</span>
              }
              title={
                <>
                  {primary(item.label, language)}
                  {item.detail ? (
                    <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">
                      {primary(item.detail, language)}
                    </span>
                  ) : null}
                </>
              }
              detail={
                // `primary`, not `flat`: a bilingual reader gets one language
                // on this line, because "Whose: Academic coordinator" in two
                // languages is wider than a 360px phone and truncates to
                // nothing useful.
                item.count === null
                  ? primary(m.homeUnavailable, language)
                  : `${primary(m.homeOwner, language)}: ${primary(item.owner, language)}`
              }
            />
          ))}
        </Panel>
      ) : (
        <Section title={m.homeNeedsAttention} language={language}>
          {/* Five noughts is not an empty queue — it is five pieces of good
              news, and the screen says so once rather than five times. */}
          <Notice tone="success" text={m.homeAllClear} language={language} />
        </Section>
      )
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
      <Panel
        className="mt-6"
        title={m.openToYou}
        description={m.openToYouHint}
        language={language}
      >
        {destinations.map((item) => (
          <PanelRow
            key={item.href}
            href={item.href}
            icon={item.icon}
            tone="accent"
            title={primary(item.label, language)}
            detail={secondary(item.label, language)}
          />
        ))}
      </Panel>
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
        // The part of the school this home belongs to. The administrator's is
        // school operations; everybody else's is their own desk, which is what
        // the atlas's sidebar caption says above each role's navigation.
        eyebrow={EYEBROW[staff.role]}
        title={isAdmin ? m.overviewTitle : m.welcome}
        description={dayText}
        language={language}
      />

      <HomeColumns
        main={
          <>
            {viewerFigures}
            {attentionSection}
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
                language={language}
              />
            </>
          ) : undefined
        }
      />
    </>
  );
}
