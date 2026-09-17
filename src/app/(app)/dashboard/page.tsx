import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";

import { m } from "@/messages";
import { can } from "@/platform/auth/permissions";
import { requirePermission } from "@/platform/auth/current-staff";
import { dayLabel, schoolToday, weekdayLabel } from "@/platform/dates";
import { pageTitle } from "@/platform/i18n/page-title";
import { navigationFor } from "@/platform/config/navigation";
import { appsFor, environmentLabel } from "@/platform/config/apps";
import { getVppsOneEnvironment } from "@/platform/env";
import { flat, primary, secondary, t } from "@/platform/i18n/language";
import { resolveSessionLabel } from "@/modules/academics/data/academics-repo";
import { homeSummary } from "@/modules/home/data/home-repo";
import {
  attentionFor,
  needsAttention,
} from "@/modules/home/domain/attention";
import { Card, DetailList, Notice, Section } from "@/ui/primitives";
import { PageHeader, StaffChip } from "@/ui/shell/app-shell";
import { MetricCard, MetricGrid } from "@/ui/task-hero";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.welcome) };
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
 * Every count is real or absent. A read that failed renders a dash and says
 * so — a dashboard reporting a confident nought is the one wrong answer this
 * screen can give, and it is exactly the mistake D-93 records.
 */
export default async function DashboardPage() {
  const staff = await requirePermission("dashboard:view", "/dashboard");
  const language = staff.language;
  const destinations = navigationFor(staff.role).filter(
    (item) => item.href !== "/dashboard",
  );
  const apps = appsFor(staff.role);

  const today = schoolToday();
  const sessionLabel = await resolveSessionLabel();

  const summary = sessionLabel
    ? await homeSummary(sessionLabel, today)
    : null;

  const attention = summary
    ? attentionFor(staff.role, summary.facts, {
        canMarkOnBehalf: can(staff, "attendance:mark_on_behalf"),
      })
    : [];

  const dayText = t(
    `${weekdayLabel(today).hi}, ${dayLabel(today).hi}`,
    `${weekdayLabel(today).en}, ${dayLabel(today).en}`,
  );

  return (
    <>
      <PageHeader title={m.welcome} description={dayText} language={language} />

      {/* ------------------------------------------------ needs attention */}

      {attention.length > 0 ? (
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
      ) : null}

      {/* --------------------------------------------- the school, in figures */}

      {summary && staff.role === "view_only" ? (
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
      ) : null}

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

      {/* The other two apps, above the list of screens rather than inside it.
          PLAN §5 R1: "put both original apps on office/admin home
          immediately" — the office reaches for School Fees several times a
          day, and until R2.2 gives this screen real work, this is the most
          useful thing on it. Each button says which host it opens; two of the
          three hostnames a reader would guess belong to somebody else. */}
      {apps.length > 0 ? (
        <Section
          className="mt-7"
          title={m.navApps}
          description={m.appsIntro}
          language={language}
        >
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
                    <ExternalLink aria-hidden className="size-4 shrink-0 text-subtle-foreground" />
                  </span>
                  <span className="truncate text-[12px] text-subtle-foreground">
                    {flat(environmentLabel(app.environment), language)} ·{" "}
                    {new URL(app.home.href).host}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {destinations.length > 0 ? (
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
      ) : null}

      {getVppsOneEnvironment() === "dev" ? (
        <Notice
          className="mt-6"
          tone="warning"
          text={m.testDataNotice}
          language={language}
        />
      ) : null}
    </>
  );
}
