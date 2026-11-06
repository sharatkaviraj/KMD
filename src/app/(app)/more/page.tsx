import { SlidersHorizontal } from "lucide-react";

import * as m from "@/messages/pairs";
import { requireStaff } from "@/platform/auth/current-staff";
import { overflowFor } from "@/platform/config/navigation";
import { primary, secondary } from "@/platform/i18n/language";
import { pageTitle } from "@/platform/i18n/page-title";
import { EmptyState } from "@/ui/states";
import { Panel, PanelRow } from "@/ui/panel";
import { PageHeader } from "@/ui/page-header-localized";

export const runtime = "nodejs";

export async function generateMetadata() {
  return { title: await pageTitle(m.navMore) };
}

/**
 * What did not fit on the bar.
 *
 * The bar holds five tabs, which is what a thumb can hit on a 360px phone. A
 * role that may open more than five screens gets this as its fifth, rather
 * than the sixth screen quietly disappearing — which is exactly what a plain
 * `slice(0, 5)` did the day `/substitutions` was added, and what a test now
 * refuses.
 */
export default async function MorePage() {
  const staff = await requireStaff("/more");
  const language = staff.language;
  const items = overflowFor(staff.role);

  return (
    <>
      <PageHeader
        eyebrow={m.eyebrowPersonal}
        title={m.navMore}
        description={m.moreIntro}
        language={language}
      />

      {items.length === 0 ? (
        <EmptyState title={m.openToYou} language={language} />
      ) : (
        <Panel title={m.openToYou} description={m.openToYouHint} language={language}>
          {items.map((item) => (
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
      )}

      {/* The personal settings, which are not a role destination and so never
          appear in the overflow list. On a phone this hub and the top bar are
          the only two ways to reach them. */}
      <Panel
        className="mt-5"
        title={m.eyebrowPersonal}
        language={language}
      >
        <PanelRow
          href="/preferences"
          icon={SlidersHorizontal}
          title={primary(m.preferencesTitle, language)}
          detail={primary(m.preferencesLanguageHint, language)}
        />
      </Panel>
    </>
  );
}
