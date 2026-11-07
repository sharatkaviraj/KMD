import { approvedStaffPhotos } from "@/modules/collection/data/approved-photos";
import { can, type StaffPermission, type StaffRole } from "@/platform/auth/permissions";
import { initials } from "@/vx/format";
import { bottomFor, PREVIEW_LABEL, ROLE_PREVIEW_MENUS } from "@/vx/nav";
import { lead, type Pair } from "@/vx/text";
import { VxPage } from "@/vx/ui/page";
import { getViewer, previewPermissions, rolePreviewOf } from "@/vx/view-as";

import { menuGroups } from "./menu-items";
import { MenuScreen } from "./menu-screen";

export const runtime = "nodejs";

const PREVIEW_ICON = { teacher: "grad", accountant: "rupee", academic: "chart", exam: "clipboard" } as const;

/** The line under the person's name on the Menu (F13: "Admin · every workspace"). */
const ROLE_LINE: Record<StaffRole, Pair> = {
  admin: { en: "Admin · every workspace", hi: "प्रशासक · हर कार्यक्षेत्र" },
  office: { en: "Office", hi: "कार्यालय" },
  accountant: { en: "Accountant", hi: "लेखाकार" },
  fee_collector: { en: "Fee desk", hi: "फ़ीस काउंटर" },
  academic_coordinator: { en: "Academic coordinator", hi: "शैक्षणिक समन्वयक" },
  exam_coordinator: { en: "Exam coordinator", hi: "परीक्षा प्रभारी" },
  teacher: { en: "Teacher", hi: "अध्यापक" },
  view_only: { en: "View only", hi: "केवल देखना" },
};

/**
 * The phone Menu tab (F13-Menu, D-519): Settings first, then everything the
 * bottom bar has no room for, filtered by the same permissions as the nav —
 * or, while the admin sees the app as another role, by that role's (UI-12).
 */
export default async function MenuPage() {
  const viewer = await getViewer();
  const { staff, menu } = viewer;
  // Seeing One as a person shows their own Menu, with their real permissions (D-544).
  const previewing = rolePreviewOf(viewer);
  // The photo is the same one the sidebar shows; a failed read draws initials.
  const [perms, portraits] = await Promise.all([
    previewing ? previewPermissions(previewing) : Promise.resolve(null),
    approvedStaffPhotos([staff.id]).catch(() => new Map<string, string>()),
  ]);
  const allowed = (p: StaffPermission) => (perms ? perms.has(p) : can(staff, p));
  const groups = menuGroups(menu, allowed);
  const onBar = bottomFor(menu, allowed).map((t) => t.href);
  const previews =
    staff.role === "admin"
      ? ROLE_PREVIEW_MENUS.filter((m): m is Exclude<typeof m, "admin"> => m !== "admin").map((m) => ({ key: m, label: PREVIEW_LABEL[m], icon: PREVIEW_ICON[m] }))
      : [];

  return (
    <VxPage>
      <MenuScreen
        menu={menu}
        name={staff.displayName}
        initials={initials(staff.displayName)}
        photo={portraits.get(staff.id) ?? null}
        sub={lead(ROLE_LINE[staff.role], staff.language)}
        groups={groups}
        onBar={onBar}
        schoolSettings={allowed("settings:manage")}
        previews={previews}
        personPicker={staff.role === "admin" && !staff.smokeLab}
        previewing={previewing}
      />
    </VxPage>
  );
}
