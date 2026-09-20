import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { m } from "@/messages";
import { requireStaff } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { roleLabel } from "@/platform/auth/permissions";
import { homeFor } from "@/platform/config/navigation";
import { flat, primary } from "@/platform/i18n/language";
import { buttonClasses } from "@/ui/primitives/button";
import { Card, DetailList } from "@/ui/primitives";
import { StateCard } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.accessDenied) };
}

/**
 * Where `requirePermission()` sends somebody who reached a screen their role
 * does not open.
 *
 * It names the permission and the role rather than saying "denied", because
 * the useful next sentence is the one the staff member says to the admin —
 * "it wants marks:write and I am office" is a request that can be actioned;
 * "it says no" is not.
 */
export default async function AccessDeniedPage(props: PageProps<"/access-denied">) {
  const staff = await requireStaff();
  const language = staff.language;
  const { permission } = await props.searchParams;
  const wanted = typeof permission === "string" ? permission : null;

  return (
    <>
      <PageHeader title={m.accessDenied} language={language} />

      {/* The atlas's "Access unavailable": a symbol, what happened, and the
          way back — which is this role's own Home, not everybody's. Sending a
          teacher who mistyped a URL to a profile card is one more tap away
          from the thing she came for (PLAN §3). */}
      <StateCard
        icon={ShieldAlert}
        title={m.accessDeniedBody}
        language={language}
        tone="warning"
        action={
          <Link href={homeFor(staff.role)} className={buttonClasses({ variant: "outline" })}>
            {primary(m.goHome, language)}
          </Link>
        }
      />

      {/* The two facts that turn "it says no" into a sentence an admin can
          act on: "it wants marks:write and I am office". */}
      <Card className="mt-4 p-5">
        <DetailList
          language={language}
          items={[
            { label: m.role, value: flat(roleLabel(staff.role), language) },
            ...(wanted
              ? [
                  {
                    label: m.permissionNeeded,
                    value: (
                      <span className="font-mono text-[13px]">{wanted}</span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </Card>
    </>
  );
}
