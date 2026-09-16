import Link from "next/link";

import { requirePermission } from "@/platform/auth/current-staff";
import { navigationFor } from "@/platform/config/navigation";
import { getVppsOneEnvironment } from "@/platform/env";
import { Card, DetailList, Notice, Section } from "@/ui/primitives";
import { PageHeader, StaffChip } from "@/ui/shell/app-shell";

export const runtime = "nodejs";

export const metadata = { title: "मुख्य · VPPS One" };

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
  const destinations = navigationFor(staff.role).filter(
    (item) => item.href !== "/dashboard",
  );

  return (
    <>
      <PageHeader title="नमस्ते" titleEn="Welcome" />

      <Card className="p-5">
        <StaffChip staff={staff} />
        <DetailList
          className="mt-4"
          items={[
            { label: "ईमेल · Email", value: staff.email ?? "—" },
            {
              label: "संक्षिप्त नाम · Short name",
              value: <span className="font-mono text-[14px]">{staff.shortName}</span>,
            },
            {
              label: "अध्यापन · Teaching",
              value: staff.isTeaching ? "हाँ · Yes" : "नहीं · No",
            },
          ]}
        />
      </Card>

      {destinations.length > 0 ? (
        <Section
          className="mt-6"
          title="आपके लिए"
          titleEn="Open to you"
          description="आपकी भूमिका के हिसाब से · What your role can open"
        >
          <ul className="grid gap-2 sm:grid-cols-2">
            {destinations.map((item) => (
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
                      {item.label}
                    </span>
                    <span className="block truncate text-[12px] text-subtle-foreground">
                      {item.labelEn}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {getVppsOneEnvironment() === "dev" ? (
        <Notice
          className="mt-6"
          tone="warning"
          hi="यह टेस्ट डेटा है। यहाँ किया गया कोई बदलाव असली रिकॉर्ड नहीं बदलता।"
          en="This runs on the test session in schoolfees-dev. Nothing here touches real student or fee records."
        />
      ) : null}
    </>
  );
}
