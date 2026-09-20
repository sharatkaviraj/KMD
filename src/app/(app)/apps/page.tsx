import { ExternalLink } from "lucide-react";

import { m } from "@/messages";
import { requirePermission } from "@/platform/auth/current-staff";
import {
  appsFor,
  crossEnvironmentNotice,
  environmentLabel,
} from "@/platform/config/apps";
import { getVppsOneEnvironment } from "@/platform/env";
import { flat, primary, secondary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { Badge, Card, Notice, Section } from "@/ui/primitives";
import { buttonClasses } from "@/ui/primitives/button";
import { EmptyState } from "@/ui/states";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.appsTitle) };
}

/**
 * The way to the other two applications.
 *
 * Ordinary links, opening in the same tab, so Back works (PLAN §2 rules out
 * iframes and a reverse proxy in front of another Next.js app). Two things
 * every card says out loud:
 *
 *  - **which data it opens.** This app's badge says "test"; both siblings are
 *    pointed at the school's live records. A reader who takes one badge to
 *    cover all three would be wrong about the two that matter.
 *  - **that it is a separate sign-in.** Same Supabase project does not mean a
 *    shared cookie, and SamPark is not even the same auth stack. Promising
 *    seamless single sign-on and then asking for a password is worse than
 *    saying so.
 */
export default async function AppsPage() {
  const staff = await requirePermission("apps:view", "/apps");
  const language = staff.language;
  const here = getVppsOneEnvironment();
  const apps = appsFor(staff.role);

  return (
    <>
      <PageHeader eyebrow={m.eyebrowAdministration} title={m.appsTitle} language={language} />

      <Notice tone="neutral" text={m.appsIntro} language={language} />

      <Section className="mt-6" title={m.navApps} language={language}>
        {apps.length === 0 ? (
          <EmptyState title={m.openToYou} language={language} />
        ) : (
          <ul className="space-y-3">
            {apps.map((app) => {
              const under = secondary(app.name, language);
              const warning = crossEnvironmentNotice(here, app);

              return (
                <li key={app.id}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-[16px] font-semibold text-foreground">
                          {primary(app.name, language)}
                        </h3>
                        {under ? (
                          <p className="text-[13px] text-subtle-foreground">{under}</p>
                        ) : null}
                        <p className="mt-1 text-[14px] leading-6 text-muted-foreground">
                          {primary(app.purpose, language)}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {app.isExternal ? (
                          <Badge tone="neutral">
                            {flat(m.appExternal, language)}
                          </Badge>
                        ) : null}
                        {/* The destination's own environment, never this
                            app's. PLAN §2 is explicit that the test badge must
                            not be read as covering a linked application. */}
                        <Badge tone={app.environment === "live" ? "warning" : "success"}>
                          {flat(environmentLabel(app.environment), language)}
                        </Badge>
                      </div>
                    </div>

                    {warning ? (
                      <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
                        {primary(warning, language)}
                      </p>
                    ) : null}

                    <p className="mt-1 text-[13px] leading-5 text-subtle-foreground">
                      {primary(m.appSignInAgain, language)}
                    </p>

                    <a
                      href={app.home.href}
                      className={buttonClasses({ className: "mt-4 w-full" })}
                    >
                      {primary(m.appOpenApp, language)}
                      <ExternalLink aria-hidden />
                    </a>

                    {/* The host, in full and unlinked. Two of the three
                        hostnames a reader would guess belong to somebody else
                        (B-15), so the one being opened is worth reading. */}
                    <p className="mt-2 text-center font-mono text-[12px] text-subtle-foreground">
                      {new URL(app.home.href).host}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
