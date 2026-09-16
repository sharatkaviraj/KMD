import Link from "next/link";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { navigationFor } from "@/platform/config/navigation";
import { getVppsOneEnvironment } from "@/platform/env";
import { flat, primary, secondary } from "@/platform/i18n/language";
import { Card, DetailList, Notice, Section } from "@/ui/primitives";
import { PageHeader, StaffChip } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.welcome) };
}

/**
 * The landing screen.
 *
 * Still deliberately thin — the numbers that belong here (today's registers,
 * missing marks, who is absent) are Phase 3 and Phase 6, and inventing
 * placeholders for them would be inventing a design for data nobody has
 * looked at yet. What it does do is show the staff member what they are and
 * where they can go, which is what makes a role change visible.
 */
export default async function DashboardPage() {
  const staff = await requirePermission("dashboard:view", "/dashboard");
  const language = staff.language;
  const destinations = navigationFor(staff.role).filter(
    (item) => item.href !== "/dashboard",
  );

  return (
    <>
      <PageHeader title={m.welcome} language={language} />

      <Card className="p-5">
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
