import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { m } from "@/messages";
import { requireStaff } from "@/platform/auth/current-staff";
import { pageTitle } from "@/platform/i18n/page-title";
import { roleLabel } from "@/platform/auth/permissions";
import { flat, primary } from "@/platform/i18n/language";
import { buttonClasses } from "@/ui/primitives/button";
import { Card, Notice } from "@/ui/primitives";
import { PageHeader } from "@/ui/shell/app-shell";

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

      <Notice tone="warning" text={m.accessDeniedBody} language={language} />

      <Card className="mt-4 p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert
            aria-hidden
            className="mt-0.5 size-5 shrink-0 text-warning-soft-foreground"
          />
          <div className="min-w-0 space-y-1 text-[14px]">
            <p className="text-muted-foreground">
              {flat(m.role, language)}{" "}
              <span className="font-medium text-foreground">
                {flat(roleLabel(staff.role), language)}
              </span>
            </p>
            {wanted ? (
              <p className="text-muted-foreground">
                {flat(m.permissionNeeded, language)}{" "}
                <span className="font-mono text-[13px] font-medium text-foreground">
                  {wanted}
                </span>
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Link
        href="/dashboard"
        className={buttonClasses({ variant: "outline", fullWidth: true, className: "mt-5" })}
      >
        {primary(m.goHome, language)}
      </Link>
    </>
  );
}
