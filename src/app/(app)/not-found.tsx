import { getCurrentStaff } from "@/platform/auth/current-staff";
import { can } from "@/platform/auth/permissions";
import { SIGNED_OUT_LANGUAGE } from "@/platform/i18n/language";
import { designMenuFor, groupsFor, MENU_HOME } from "@/vx/nav";
import { lead } from "@/vx/text";
import { VxPage, Section, TopBar } from "@/vx/ui/page";

import { NotFoundScreen, type NotFoundLink } from "@/vx/screens/system/not-found";

/**
 * P11 state `notfound`, inside the signed-in shell.
 *
 * The cards and the search are this person's own pages, from the same nav
 * config the sidebar draws, so nothing offered here leads to "no access". The
 * profile is read best-effort: a not-found boundary must never itself fail,
 * so without one it offers Menu and both languages.
 */
export default async function NotFound() {
  const staff = await getCurrentStaff().catch(() => null);
  const language = staff?.language ?? SIGNED_OUT_LANGUAGE;
  const menu = staff ? designMenuFor(staff.role) : null;
  const home = menu ? MENU_HOME[menu] : "/";
  const links: NotFoundLink[] = staff && menu
    ? groupsFor(menu, (permission) => can(staff, permission))
        .flatMap((g) => g.items)
        .filter((i) => i.href !== home)
        .map((i) => ({ label: i.label, icon: i.icon, href: i.href }))
    : [{ label: { en: "Menu", hi: "मेनू" }, icon: "grid", href: "/menu" }];
  return (
    <VxPage>
      <TopBar title={lead({ en: "Page not found", hi: "पेज नहीं मिला" }, language)} mSub={lead({ en: "An old or broken link", hi: "पुराना या टूटा लिंक" }, language)} mBack={home} />
      <main>
        <Section>
          <NotFoundScreen language={language} links={links} home={home} />
        </Section>
      </main>
    </VxPage>
  );
}
