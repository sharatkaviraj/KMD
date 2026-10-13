import { requireStaff } from "@/platform/auth/current-staff";
import { permissionsFor, roleLabel, staffPermissions, staffRoles, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { pageTitle } from "@/platform/i18n/page-title";
import { listStaff } from "@/modules/staff/data/staff-repo";
import { homeForRole } from "@/vx/nav";
import { lead } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";

import { DeniedScreen, type DeniedPerson } from "@/vx/screens/system/denied";
import { deniedPeople, requestAccessHref } from "@/vx/screens/system/logic";

export const runtime = "nodejs";

const TITLE = { en: "You can't open this page", hi: "यह पेज आपके लिए नहीं खुलता" };

export async function generateMetadata() {
  return { title: await pageTitle(TITLE) };
}

/**
 * Where `requirePermission()` sends somebody who reached a screen their role
 * does not open (P11 state `denied`).
 *
 * It names the roles that do open it and the people who hold them, rather
 * than saying "denied", because the useful next sentence is the one the staff
 * member says to one of them. The way back is this role's own Home.
 */
export default async function AccessDeniedPage(props: PageProps<"/access-denied">) {
  const staff = await requireStaff();
  const language = staff.language;
  const { permission } = await props.searchParams;
  const wanted = typeof permission === "string" ? permission : null;
  const home = homeForRole(staff.role);

  // Which roles hold it, by the built-in map (the matrix may differ; the
  // admin is always among them).
  const known = wanted && (staffPermissions as readonly string[]).includes(wanted) ? (wanted as StaffPermission) : null;
  const roles: StaffRole[] = known ? staffRoles.filter((r) => r !== "view_only" && permissionsFor(r).includes(known)) : ["admin"];
  const staffList = await listStaff().catch(() => []);
  const people: DeniedPerson[] = deniedPeople(staffList, roles, staff.id).map(({ roleKey, ...person }) => ({ ...person, role: roleLabel(roleKey) }));
  const requestHref = requestAccessHref(staffList, staff.displayName, wanted, staff.id);

  return (
    <VxPage>
      <TopBar crumb={lead({ en: "No access", hi: "अनुमति नहीं" }, language)} title={lead(TITLE, language)} mSub={lead({ en: "No access for this role", hi: "इस भूमिका को अनुमति नहीं" }, language)} mBack={home} />
      <main>
        <Section>
          <DeniedScreen
            language={language}
            me={{ name: staff.displayName, role: roleLabel(staff.role) }}
            roles={roles.map(roleLabel)}
            people={people}
            permission={wanted}
            home={home}
            requestHref={requestHref}
          />
        </Section>
      </main>
    </VxPage>
  );
}
