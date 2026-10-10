import { logoutAction } from "@/app/login/actions";
import { can, rolePermissions, type StaffPermission } from "@/platform/auth/permissions";
import { initials } from "@/vx/format";
import { Ic } from "@/vx/icons";
import { groupsFor, MENU_LABEL } from "@/vx/nav";
import { MenuPrefs } from "@/vx/shell/menu-prefs";
import { lead, under } from "@/vx/text";
import { VxPage, TopBar, Section } from "@/vx/ui/page";
import { Avatar, avatarColor, Card, IconTile, ListRow } from "@/vx/ui/primitives";
import { getViewer } from "@/vx/view-as";

export const runtime = "nodejs";

const PREVIEW_ROLE = { admin: "admin", teacher: "teacher", accountant: "accountant", academic: "academic_coordinator", exam: "exam_coordinator" } as const;

/** The phone Menu tab (F02-Menu): everything the bottom bar has no room for. */
export default async function MenuPage() {
  const { staff, menu, previewing } = await getViewer();
  const lang = staff.language;
  const perms = previewing ? new Set<StaffPermission>(rolePermissions[PREVIEW_ROLE[previewing]]) : null;
  const groups = groupsFor(menu, (p) => (perms ? perms.has(p) : can(staff, p)));

  return (
    <VxPage>
      <TopBar title="Menu" crumb={lead(MENU_LABEL[menu], lang)} />
      <main>
        <Section gap={18}>
          <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Avatar text={initials(staff.displayName)} bg={avatarColor(staff.displayName)} size={48} />
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <span className="clip" style={{ fontWeight: 700, fontSize: 17 }}>{staff.displayName}</span>
              <span className="clip" style={{ fontSize: 13, color: "var(--mut)" }}>{staff.email ?? lead(MENU_LABEL[menu], lang)}</span>
            </span>
          </Card>
          {groups.map((g, gi) => (
            <section key={g.title?.en ?? `g${gi}`} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {g.title ? <h2 className="sech">{lead(g.title, lang)}{under(g.title, lang) ? ` · ${under(g.title, lang)}` : ""}</h2> : null}
              <Card pad={false} style={{ overflow: "hidden" }}>
                {g.items.map((i, ii) => (
                  <ListRow
                    key={i.key}
                    href={i.href}
                    lead={<IconTile icon={i.icon} tone="pri" size={38} />}
                    title={lead(i.label, lang)}
                    sub={under(i.label, lang) ?? undefined}
                    trail={<Ic n="chevRight" size={18} style={{ color: "var(--sub)" }} />}
                    style={ii === 0 ? { borderTop: 0 } : undefined}
                  />
                ))}
              </Card>
            </section>
          ))}
          <MenuPrefs />
          <form action={logoutAction}>
            <button type="submit" className="btn sec tap" style={{ width: "100%", height: 48, color: "var(--bad)" }}>
              <Ic n="logout" size={18} /> Sign out
            </button>
          </form>
        </Section>
      </main>
    </VxPage>
  );
}
